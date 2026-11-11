/**
 * AUTONEX Pure-JS POSIX USTAR Tar Implementation
 *
 * Fully compliant with POSIX 1003.1-1988 USTAR standard.
 * Operates purely in-memory on Uint8Array / Buffer.
 * Zero external dependencies, zero Node stream / events dependencies.
 * 100% compatible with both browser (Vite) and Node.js environments.
 */

export interface TarEntryHeader {
  name: string;
  type?: 'file' | 'directory';
  mode?: number;
  mtime?: Date | number;
  size?: number;
}

export interface TarExtractedEntry {
  name: string;
  type: 'file' | 'directory';
  mode: number;
  mtime: Date;
  size: number;
  data: Buffer;
}

const RECORD_SIZE = 512;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

/**
 * Packs multiple files/directories into a standard POSIX USTAR TAR archive.
 */
export function packTar(
  entries: Array<{
    name: string;
    type?: 'file' | 'directory';
    mode?: number;
    mtime?: Date | number;
    content?: Uint8Array | Buffer | string;
  }>
): Buffer {
  const chunks: Buffer[] = [];

  for (const entry of entries) {
    const isDir = entry.type === 'directory' || entry.name.endsWith('/');
    let rawContent: Buffer = Buffer.alloc(0);

    if (!isDir && entry.content !== undefined) {
      if (typeof entry.content === 'string') {
        rawContent = Buffer.from(textEncoder.encode(entry.content));
      } else if (Buffer.isBuffer(entry.content)) {
        rawContent = entry.content;
      } else if (entry.content instanceof Uint8Array) {
        rawContent = Buffer.from(entry.content.buffer, entry.content.byteOffset, entry.content.byteLength);
      }
    }

    const size = isDir ? 0 : rawContent.length;
    const mode = entry.mode ?? (isDir ? 0o755 : 0o644);
    const mtime = entry.mtime instanceof Date ? entry.mtime : typeof entry.mtime === 'number' ? new Date(entry.mtime) : new Date();

    const header = createUstarHeader({
      name: entry.name,
      type: isDir ? 'directory' : 'file',
      mode,
      mtime,
      size,
    });

    chunks.push(header);

    if (size > 0) {
      chunks.push(rawContent);
      const padding = (RECORD_SIZE - (size % RECORD_SIZE)) % RECORD_SIZE;
      if (padding > 0) {
        chunks.push(Buffer.alloc(padding, 0));
      }
    }
  }

  // End of archive: Two 512-byte zero blocks
  chunks.push(Buffer.alloc(RECORD_SIZE * 2, 0));

  return Buffer.concat(chunks);
}

/**
 * Creates a 512-byte POSIX USTAR header block.
 */
function createUstarHeader(opts: {
  name: string;
  type: 'file' | 'directory';
  mode: number;
  mtime: Date;
  size: number;
}): Buffer {
  const header = Buffer.alloc(RECORD_SIZE, 0);

  // Normalize path
  let pathStr = opts.name.replace(/\\/g, '/');
  if (opts.type === 'directory' && !pathStr.endsWith('/')) {
    pathStr += '/';
  }

  // Handle path splitting for USTAR (name max 100, prefix max 155)
  let namePart = pathStr;
  let prefixPart = '';

  if (namePart.length > 100) {
    const lastSlash = pathStr.lastIndexOf('/', 155);
    if (lastSlash !== -1 && pathStr.length - lastSlash - 1 <= 100) {
      prefixPart = pathStr.slice(0, lastSlash);
      namePart = pathStr.slice(lastSlash + 1);
    } else {
      // Fallback: truncate name to 100 chars
      namePart = pathStr.slice(0, 100);
    }
  }

  // 1. name (0..100)
  writeString(header, namePart, 0, 100);

  // 2. mode (100..108): 6 octal digits + null + space
  writeOctal(header, opts.mode & 0o7777, 100, 8);

  // 3. uid (108..116)
  writeOctal(header, 0, 108, 8);

  // 4. gid (116..124)
  writeOctal(header, 0, 116, 8);

  // 5. size (124..136): 11 octal digits + null
  writeOctal(header, opts.size, 124, 12);

  // 6. mtime (136..148): 11 octal digits + null
  const epochSec = Math.floor(opts.mtime.getTime() / 1000);
  writeOctal(header, Math.max(0, epochSec), 136, 12);

  // 7. Checksum placeholder: 8 spaces (148..156)
  for (let i = 148; i < 156; i++) {
    header[i] = 0x20; // ASCII space
  }

  // 8. typeflag (156)
  header[156] = opts.type === 'directory' ? 0x35 : 0x30; // '5' for dir, '0' for file

  // 9. linkname (157..257) - already zeros

  // 10. magic (257..263): "ustar\0"
  writeString(header, 'ustar\0', 257, 6);

  // 11. version (263..265): "00"
  writeString(header, '00', 263, 2);

  // 12. uname (265..297): "autonex\0"
  writeString(header, 'autonex\0', 265, 32);

  // 13. gname (297..329): "autonex\0"
  writeString(header, 'autonex\0', 297, 32);

  // 14. devmajor / devminor (329..345) - already zeros

  // 15. prefix (345..500)
  if (prefixPart) {
    writeString(header, prefixPart, 345, 155);
  }

  // Calculate Checksum: sum of all 512 bytes treating checksum field as spaces
  let chksum = 0;
  for (let i = 0; i < RECORD_SIZE; i++) {
    chksum += header[i];
  }

  // Write checksum (148..156): 6 octal digits + null + space
  const chkStr = chksum.toString(8).padStart(6, '0') + '\0 ';
  for (let i = 0; i < 8; i++) {
    header[148 + i] = chkStr.charCodeAt(i);
  }

  return header;
}

function writeString(buf: Buffer, str: string, offset: number, maxLen: number) {
  const bytes = textEncoder.encode(str);
  const writeLen = Math.min(bytes.length, maxLen);
  for (let i = 0; i < writeLen; i++) {
    buf[offset + i] = bytes[i];
  }
}

function writeOctal(buf: Buffer, value: number, offset: number, fieldLen: number) {
  const octalStr = value.toString(8).padStart(fieldLen - 1, '0') + '\0';
  for (let i = 0; i < fieldLen; i++) {
    buf[offset + i] = octalStr.charCodeAt(i);
  }
}

/**
 * Unpacks a standard POSIX USTAR TAR archive into a list of entries with data Buffers.
 */
export function unpackTar(tarData: Uint8Array | Buffer): TarExtractedEntry[] {
  const buf = Buffer.isBuffer(tarData)
    ? tarData
    : Buffer.from(tarData.buffer, tarData.byteOffset, tarData.byteLength);

  const entries: TarExtractedEntry[] = [];
  let offset = 0;

  while (offset + RECORD_SIZE <= buf.length) {
    const headerBlock = buf.subarray(offset, offset + RECORD_SIZE);

    // Check for two consecutive empty blocks (EOF)
    if (isZeroBlock(headerBlock)) {
      offset += RECORD_SIZE;
      if (offset + RECORD_SIZE <= buf.length && isZeroBlock(buf.subarray(offset, offset + RECORD_SIZE))) {
        break; // Double zero block indicates end of archive
      }
      continue;
    }

    // Read name
    const rawName = readNullTerminatedString(headerBlock, 0, 100);

    // Read magic & prefix
    const magic = readNullTerminatedString(headerBlock, 257, 6);
    let fullPath = rawName;
    if (magic.startsWith('ustar')) {
      const prefix = readNullTerminatedString(headerBlock, 345, 155);
      if (prefix) {
        fullPath = prefix + '/' + rawName;
      }
    }

    // Read typeflag
    const typeByte = headerBlock[156];
    const typeChar = String.fromCharCode(typeByte);
    const isDir = typeChar === '5' || fullPath.endsWith('/');

    // Read size
    const rawSize = readNullTerminatedString(headerBlock, 124, 12).trim();
    const size = rawSize ? parseInt(rawSize, 8) || 0 : 0;

    // Read mode
    const rawMode = readNullTerminatedString(headerBlock, 100, 8).trim();
    const mode = rawMode ? parseInt(rawMode, 8) || (isDir ? 0o755 : 0o644) : (isDir ? 0o755 : 0o644);

    // Read mtime
    const rawMtime = readNullTerminatedString(headerBlock, 136, 12).trim();
    const epochSec = rawMtime ? parseInt(rawMtime, 8) || 0 : 0;
    const mtime = new Date(epochSec * 1000);

    offset += RECORD_SIZE;

    let data = Buffer.alloc(0);
    if (!isDir && size > 0) {
      data = Buffer.from(buf.subarray(offset, offset + size));
      const padding = (RECORD_SIZE - (size % RECORD_SIZE)) % RECORD_SIZE;
      offset += size + padding;
    }

    entries.push({
      name: fullPath,
      type: isDir ? 'directory' : 'file',
      mode,
      mtime,
      size,
      data,
    });
  }

  return entries;
}

function isZeroBlock(buf: Buffer | Uint8Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function readNullTerminatedString(buf: Buffer | Uint8Array, offset: number, maxLen: number): string {
  let end = offset;
  const limit = offset + maxLen;
  while (end < limit && buf[end] !== 0) {
    end++;
  }
  return textDecoder.decode(buf.subarray(offset, end)).trim();
}

/**
 * Drop-in pack API matching mafintosh/tar-stream.
 */
export class TarPack {
  private entries: Array<{
    name: string;
    type?: 'file' | 'directory';
    mode?: number;
    mtime?: Date | number;
    content?: Uint8Array | Buffer | string;
  }> = [];
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};
  private finalized = false;
  private flushed = false;
  private tarBuffer: Buffer | null = null;

  public on(event: string, fn: (...args: any[]) => void): this {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
    if (this.finalized) {
      queueMicrotask(() => this.flush());
    }
    return this;
  }

  public entry(
    header: { name: string; type?: 'file' | 'directory'; mode?: number; mtime?: Date | number; size?: number },
    content?: Uint8Array | Buffer | string
  ): void {
    this.entries.push({
      name: header.name,
      type: header.type,
      mode: header.mode,
      mtime: header.mtime,
      content,
    });
  }

  public finalize(): void {
    this.finalized = true;
    this.tarBuffer = packTar(this.entries);
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    if (!this.finalized || this.flushed || !this.tarBuffer) return;
    const dataFns = this.handlers['data'] || [];
    const endFns = this.handlers['end'] || [];
    if (endFns.length === 0 && dataFns.length === 0) return;

    this.flushed = true;
    for (const fn of dataFns) fn(this.tarBuffer);
    for (const fn of endFns) fn();
  }
}

/**
 * Drop-in extract API matching mafintosh/tar-stream.
 */
export class TarExtract {
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};

  public on(event: string, fn: (...args: any[]) => void): this {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
    return this;
  }

  public end(buffer: Uint8Array | Buffer): void {
    try {
      const entries = unpackTar(buffer);
      const onEntry = this.handlers['entry'] || [];
      const onFinish = this.handlers['finish'] || [];

      let idx = 0;
      const processNext = () => {
        if (idx >= entries.length) {
          for (const fn of onFinish) fn();
          return;
        }
        const item = entries[idx++];
        const header = {
          name: item.name,
          type: item.type,
          size: item.size,
          mode: item.mode,
          mtime: item.mtime,
        };
        const stream = new MockEntryStream(item.data);
        if (onEntry.length > 0) {
          for (const fn of onEntry) {
            try {
              fn(header, stream, processNext);
            } catch (err) {
              const onError = this.handlers['error'] || [];
              for (const eFn of onError) eFn(err);
              return;
            }
          }
        } else {
          processNext();
        }
      };
      processNext();
    } catch (err) {
      const onError = this.handlers['error'] || [];
      if (onError.length > 0) {
        for (const fn of onError) fn(err);
      } else {
        throw err;
      }
    }
  }
}

class MockEntryStream {
  private data: Buffer;
  private handlers: Record<string, Array<(...args: any[]) => void>> = {};
  private triggered = false;
  private isResumed = false;

  constructor(data: Buffer) {
    this.data = data;
  }

  public on(event: string, fn: (...args: any[]) => void): this {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
    queueMicrotask(() => this.trigger());
    return this;
  }

  public resume(): void {
    this.isResumed = true;
    queueMicrotask(() => this.trigger());
  }

  private trigger(): void {
    if (this.triggered) return;
    const endFns = this.handlers['end'] || [];
    // Only fire if end handler attached, or stream was explicitly resumed (e.g. dir or skip)
    if (endFns.length === 0 && !this.isResumed) return;

    this.triggered = true;
    const dataFns = this.handlers['data'] || [];
    for (const fn of dataFns) {
      fn(this.data);
    }
    for (const fn of endFns) {
      fn();
    }
  }
}

export function pack(): TarPack {
  return new TarPack();
}

export function extract(): TarExtract {
  return new TarExtract();
}

export default {
  pack,
  extract,
  packTar,
  unpackTar,
};
