/**
 * AUTONEX Checkpoint Engine: Archive Extraction & Verification Engine
 *
 * Decompresses, decrypts, and unpacks TAR + Zstandard archives into target directories
 * with strict path traversal sandboxing and bit-for-bit SHA-256 integrity verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import tar from './tar';
import { type ExtractionOptions, type ExtractionResult, type CheckpointManifest } from './types';
import { calculateSHA256, decryptPayload } from './crypto';

/**
 * Extracts a TAR + Zstandard checkpoint archive into a target directory.
 */
export async function extractWorkspaceSnapshot(options: ExtractionOptions): Promise<ExtractionResult> {
  const { archiveBytes, targetDir, manifest, decryptionKey } = options;

  if (!targetDir) {
    throw new Error('Extraction target directory is required.');
  }

  // 1. Verify Overall Archive SHA-256
  const actualArchiveSha = calculateSHA256(archiveBytes);
  if (manifest.archiveSha256 && actualArchiveSha !== manifest.archiveSha256) {
    throw new Error(
      `Archive verification failed: SHA-256 mismatch. Expected ${manifest.archiveSha256}, got ${actualArchiveSha}.`
    );
  }

  // 2. Decrypt Payload (if encrypted)
  let decompressedTarBuffer: Buffer;
  let compressedBytes: Uint8Array = archiveBytes;

  if (manifest.encryption && manifest.encryption.enabled) {
    if (!decryptionKey) {
      throw new Error('Archive is encrypted with AES-256-GCM. Decryption key is required.');
    }
    const iv = manifest.encryption.iv;
    const authTag = manifest.encryption.authTag;
    if (!iv || !authTag) {
      throw new Error('Corrupted encryption metadata: Missing IV or authentication tag in manifest.');
    }
    compressedBytes = decryptPayload(archiveBytes, decryptionKey, iv, authTag);
  }

  // 3. Decompress Zstandard
  try {
    decompressedTarBuffer = zlib.zstdDecompressSync(Buffer.from(compressedBytes));
  } catch (err: any) {
    throw new Error(`Zstandard decompression failed: ${err?.message || 'Invalid or corrupted zstd payload'}`);
  }

  // 4. Ensure target directory exists
  const resolvedTarget = path.resolve(targetDir);
  if (!fs.existsSync(resolvedTarget)) {
    fs.mkdirSync(resolvedTarget, { recursive: true });
  }

  // 5. Extract TAR Stream with Security Sandboxing
  const extract = tar.extract();
  let restoredFilesCount = 0;
  let restoredDirectoriesCount = 0;
  let totalBytesExtracted = 0;
  const restoredPaths: string[] = [];

  const manifestMap = new Map(manifest.files.map((f) => [f.path, f]));

  const extractionPromise = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      // Path Traversal Security Sandbox Check
      const entryRelative = header.name.replace(/\\/g, '/').replace(/\/+$/, '');
      const fullPath = path.resolve(resolvedTarget, entryRelative);

      if (!fullPath.startsWith(resolvedTarget + path.sep) && fullPath !== resolvedTarget) {
        stream.resume();
        return reject(
          new Error(`Security Alert: Blocked path traversal attempt in archive entry "${header.name}".`)
        );
      }

      if (header.type === 'directory') {
        try {
          fs.mkdirSync(fullPath, { recursive: true });
          restoredDirectoriesCount++;
          restoredPaths.push(entryRelative);
          stream.resume();
          stream.on('end', next);
        } catch (err) {
          reject(err);
        }
      } else if (header.type === 'file') {
        const fileChunks: Buffer[] = [];
        stream.on('data', (chunk: any) => fileChunks.push(Buffer.from(chunk)));
        stream.on('end', () => {
          try {
            const content = Buffer.concat(fileChunks);

            // Verify file SHA-256 against manifest
            const expectedFile = manifestMap.get(entryRelative);
            if (expectedFile && expectedFile.sha256 !== 'sha256:directory') {
              const actualSha = calculateSHA256(content);
              if (actualSha !== expectedFile.sha256) {
                return reject(
                  new Error(
                    `File hash mismatch for "${entryRelative}": Expected ${expectedFile.sha256}, got ${actualSha}.`
                  )
                );
              }
            }

            // Ensure parent directory exists
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content);

            // Restore permissions if header mode present
            if (header.mode) {
              try {
                fs.chmodSync(fullPath, header.mode);
              } catch {}
            }

            restoredFilesCount++;
            totalBytesExtracted += content.length;
            restoredPaths.push(entryRelative);
            next();
          } catch (err) {
            reject(err);
          }
        });
      } else {
        // Unsupported entry type (symlink, block device, etc.)
        stream.resume();
        stream.on('end', next);
      }
    });

    extract.on('finish', () => resolve());
    extract.on('error', (err) => reject(err));
  });

  extract.end(decompressedTarBuffer);
  await extractionPromise;

  return {
    restoredFilesCount,
    restoredDirectoriesCount,
    totalBytesExtracted,
    verifiedFileHashes: true,
    restoredPaths,
  };
}

/**
 * Reads all files from a TAR + Zstandard checkpoint archive into memory
 * without writing to disk.
 */
export async function readArchiveFiles(options: {
  archiveBytes: Uint8Array;
  manifest: CheckpointManifest;
  decryptionKey?: Buffer | Uint8Array | string;
}): Promise<Map<string, Buffer>> {
  const { archiveBytes, manifest, decryptionKey } = options;

  let compressedBytes: Uint8Array = archiveBytes;
  if (manifest.encryption && manifest.encryption.enabled) {
    if (!decryptionKey) {
      throw new Error('Archive is encrypted with AES-256-GCM. Decryption key is required.');
    }
    const iv = manifest.encryption.iv;
    const authTag = manifest.encryption.authTag;
    if (!iv || !authTag) {
      throw new Error('Corrupted encryption metadata: Missing IV or authentication tag in manifest.');
    }
    compressedBytes = decryptPayload(archiveBytes, decryptionKey, iv, authTag);
  }

  let decompressedTarBuffer: Buffer;
  try {
    decompressedTarBuffer = zlib.zstdDecompressSync(Buffer.from(compressedBytes));
  } catch (err: any) {
    throw new Error(`Zstandard decompression failed: ${err?.message || 'Invalid or corrupted zstd payload'}`);
  }

  const filesMap = new Map<string, Buffer>();
  const extract = tar.extract();

  const promise = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const entryRelative = header.name.replace(/\\/g, '/').replace(/\/+$/, '');
      if (header.type === 'file') {
        const chunks: Buffer[] = [];
        stream.on('data', (c: any) => chunks.push(Buffer.from(c)));
        stream.on('end', () => {
          filesMap.set(entryRelative, Buffer.concat(chunks));
          next();
        });
      } else {
        stream.resume();
        stream.on('end', next);
      }
    });
    extract.on('finish', () => resolve());
    extract.on('error', (err) => reject(err));
  });

  extract.end(decompressedTarBuffer);
  await promise;
  return filesMap;
}
