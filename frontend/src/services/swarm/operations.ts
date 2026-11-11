import { getSwarmConfig } from './client';
import { SwarmStorageProvider } from './beeProvider';

export interface SwarmUploadResult {
  swarmReference: string;
  contentHash: string;
  fileSize: number;
  fileName: string;
  contentType: string;
}

export interface SwarmGetResult {
  content: string;
  rawBytes: Uint8Array;
  contentType: string;
  fileSize: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Default production Swarm storage provider instance
let activeStorageProvider: SwarmStorageProvider = new SwarmStorageProvider();

export function getActiveStorageProvider(): SwarmStorageProvider {
  return activeStorageProvider;
}

export function setActiveStorageProvider(provider: SwarmStorageProvider): void {
  activeStorageProvider = provider;
}

import { calculateSHA256 as computeSHA256 } from '../checkpoint/crypto';

/**
 * 1. Compute Cryptographic SHA-256 Hash of File Content
 */
export async function calculateSHA256(content: string | Uint8Array): Promise<string> {
  return computeSHA256(content);
}

/**
 * 2. Upload Context File to Ethereum Swarm
 * Uploads raw binary/text to Ethereum Swarm via real Bee provider.
 * Throws on failure — NEVER generates fake references or silent mock fallbacks.
 */
export async function uploadContextFile(
  content: string | Uint8Array,
  fileName = 'context-report.json',
  contentType = 'application/json'
): Promise<SwarmUploadResult> {
  const rawBytes = typeof content === 'string' ? encoder.encode(content) : content;
  const contentHash = await calculateSHA256(rawBytes);
  const fileSize = rawBytes.byteLength;

  // Real upload to Swarm via official Bee SDK
  const result = await activeStorageProvider.uploadBinary(rawBytes, { contentType });

  return {
    swarmReference: result.reference,
    contentHash,
    fileSize,
    fileName,
    contentType,
  };
}

/**
 * 3. Retrieve Context File from Ethereum Swarm by Reference
 * Downloads raw binary from Ethereum Swarm via real Bee provider.
 * Throws on retrieval failure — NEVER reads from fake local storage masquerading as Swarm.
 */
export async function getContextFile(swarmReference: string): Promise<SwarmGetResult> {
  const ref = (swarmReference || '').trim();
  if (!ref) {
    throw new Error('Swarm content reference is empty or missing from the on-chain pointer.');
  }

  const result = await activeStorageProvider.downloadBinary(ref);
  const content = decoder.decode(result.data);

  return {
    content,
    rawBytes: result.data,
    contentType: 'application/json',
    fileSize: result.byteSize,
  };
}

/**
 * 4. Verify Content Integrity against Expected Hash
 */
export async function verifyContentIntegrity(
  content: string | Uint8Array,
  expectedHash: string
): Promise<boolean> {
  const actualHash = await calculateSHA256(content);
  return actualHash.toLowerCase() === expectedHash.toLowerCase();
}
