/**
 * Browser shim for Node.js 'crypto' and 'node:crypto' modules.
 * Prevents Vite browser externalization errors and provides synchronous SHA-256 and randomBytes.
 */

import { sha256 as viemSha256, toHex } from 'viem';

export function createHash(algorithm: string) {
  const algo = (algorithm || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (algo === 'sha256') {
    let chunks: Uint8Array[] = [];
    return {
      update(data: Uint8Array | Buffer | string, _encoding?: string) {
        if (typeof data === 'string') {
          chunks.push(new TextEncoder().encode(data));
        } else if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
          chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        }
        return this;
      },
      digest(format?: string) {
        let totalLen = 0;
        for (const c of chunks) totalLen += c.length;
        const merged = new Uint8Array(totalLen);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        const hex = viemSha256(merged).replace(/^0x/i, '');
        if (format === 'hex') return hex;
        return Buffer.from(hex, 'hex');
      },
    };
  }
  throw new Error(`Hash algorithm "${algorithm}" not implemented in browser crypto shim.`);
}

export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(size);
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export const webcrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

export default {
  createHash,
  randomBytes,
  webcrypto,
};

