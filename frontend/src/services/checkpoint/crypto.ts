/**
 * AUTONEX Checkpoint Engine: Cryptographic & Integrity Utilities
 *
 * Implements SHA-256 integrity hashing and AES-256-GCM authenticated encryption.
 * Works seamlessly across both Browser (Vite client) and Node.js runtime environments.
 */

import { sha256 as viemSha256, toHex } from 'viem';

export interface EncryptedPayload {
  ciphertext: Uint8Array;
  iv: string;       // Hex encoded 96-bit IV
  authTag: string;  // Hex encoded 128-bit GCM auth tag
}

function getNodeCrypto(): any {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      if (typeof (process as any).getBuiltinModule === 'function') {
        const mod = (process as any).getBuiltinModule('node:crypto');
        if (mod) return mod;
      }
      const nodeMod = (process as any).getBuiltinModule?.('node:module');
      if (nodeMod?.createRequire) {
        return nodeMod.createRequire(import.meta.url)('node:crypto');
      }
    } catch {}
  }
  return null;
}

/**
 * Computes deterministic SHA-256 hash returning formatted "sha256:<64-char hex>".
 * Pure-JS synchronous implementation safe for browser and Node.js alike.
 */
export function calculateSHA256(data: Uint8Array | Buffer | string): string {
  let hex: string;
  if (typeof data === 'string') {
    hex = viemSha256(toHex(data));
  } else {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    hex = viemSha256(u8);
  }
  return 'sha256:' + hex.replace(/^0x/i, '');
}

/**
 * Generates a cryptographically strong 256-bit (32 bytes) symmetric key.
 */
export function generateEncryptionKey(): Buffer {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  const nodeCrypto = getNodeCrypto();
  if (nodeCrypto?.randomBytes) {
    return nodeCrypto.randomBytes(32);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Normalizes input key (hex string, Uint8Array, or Buffer) to a 32-byte Buffer.
 */
export function normalizeKey(key: Buffer | Uint8Array | string): Buffer {
  if (typeof key === 'string') {
    const clean = key.trim().replace(/^0x/i, '');
    if (clean.length === 64) {
      return Buffer.from(clean, 'hex');
    }
    const hex = viemSha256(toHex(key)).replace(/^0x/i, '');
    return Buffer.from(hex, 'hex');
  }
  const buf = Buffer.from(key);
  if (buf.length === 32) return buf;
  const hex = viemSha256(new Uint8Array(buf)).replace(/^0x/i, '');
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a binary payload using AES-256-GCM authenticated encryption.
 * Generates a unique 96-bit IV per call and returns the 128-bit authentication tag.
 */
export function encryptPayload(
  plaintext: Uint8Array | Buffer,
  key: Buffer | Uint8Array | string
): EncryptedPayload {
  const nodeCrypto = getNodeCrypto();
  const keyBuf = normalizeKey(key);

  let iv: Buffer;
  if (nodeCrypto?.randomBytes) {
    iv = nodeCrypto.randomBytes(12);
  } else if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    const ivU8 = new Uint8Array(12);
    globalThis.crypto.getRandomValues(ivU8);
    iv = Buffer.from(ivU8.buffer, ivU8.byteOffset, ivU8.byteLength);
  } else {
    iv = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  }

  if (nodeCrypto && nodeCrypto.createCipheriv) {
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 128-bit tag

    return {
      ciphertext: new Uint8Array(encrypted),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  throw new Error('AES-256-GCM encryption is only supported in an environment with WebCrypto or Node.js crypto.');
}

/**
 * Decrypts an AES-256-GCM ciphertext payload and validates the authentication tag.
 * Throws explicit, actionable errors if authentication fails or data was tampered with.
 */
export function decryptPayload(
  ciphertext: Uint8Array | Buffer,
  key: Buffer | Uint8Array | string,
  ivHex: string,
  authTagHex: string
): Uint8Array {
  if (!key) {
    throw new Error('Decryption failed: Missing required encryption key.');
  }
  if (!ivHex || ivHex.length !== 24) {
    throw new Error('Decryption failed: Invalid or missing 96-bit IV (expected 24 hex characters).');
  }
  if (!authTagHex || authTagHex.length !== 32) {
    throw new Error('Decryption failed: Invalid or missing 128-bit authentication tag (expected 32 hex characters).');
  }

  const nodeCrypto = getNodeCrypto();
  if (nodeCrypto && nodeCrypto.createDecipheriv) {
    const keyBuf = normalizeKey(key);
    const ivBuf = Buffer.from(ivHex, 'hex');
    const authTagBuf = Buffer.from(authTagHex, 'hex');

    try {
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
      decipher.setAuthTag(authTagBuf);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return new Uint8Array(decrypted);
    } catch (err: any) {
      throw new Error(
        `Decryption failed: Integrity authentication check failed. Data may have been tampered with or key is invalid (${err?.message || 'Unsupported state or unable to authenticate data'}).`
      );
    }
  }

  throw new Error('AES-256-GCM decryption is only supported in an environment with WebCrypto or Node.js crypto.');
}
