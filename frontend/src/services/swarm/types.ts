/**
 * AUTONEX Checkpoint Engine: Swarm Storage Provider Interfaces & States
 *
 * Defines the contracts for authentic Ethereum Swarm (Bee) decentralized storage.
 */

export type StorageProviderState =
  | 'CONNECTING'
  | 'READY'
  | 'POSTAGE_BATCH_INVALID'
  | 'POSTAGE_BATCH_INSUFFICIENT'
  | 'UPLOADING'
  | 'UPLOAD_FAILED'
  | 'DOWNLOADING'
  | 'DOWNLOAD_FAILED'
  | 'VERIFYING'
  | 'VERIFIED';

export interface PostageBatchInfo {
  batchId: string;
  usable: boolean;
  utilization: number;
  depth: number;
  bucketDepth: number;
  batchTTL?: number;
  exists: boolean;
  message?: string;
}

export interface SwarmNodeHealth {
  connected: boolean;
  gatewayUrl: string;
  status: 'ok' | 'degraded' | 'unreachable';
  version?: string;
  mode?: string;
  message?: string;
}

export interface SwarmUploadResult {
  reference: string;        // 64-character hex Swarm BZZ content address
  contentHash: string;      // Cryptographic SHA-256 hex digest
  byteSize: number;
  contentType: string;
  timestamp: string;
}

export interface SwarmDownloadResult {
  data: Uint8Array;
  contentHash: string;
  byteSize: number;
  verified: boolean;
}

export interface DualArtifactUploadResult {
  checkpointId: string;
  projectId: string;
  archiveReference: string;
  archiveContentHash: string;
  archiveByteSize: number;
  contextReference: string;
  contextContentHash: string;
  contextByteSize: number;
  verified: boolean;
  uploadedAt: string;
}

export interface StorageProvider {
  name: string;
  getState(): StorageProviderState;
  checkHealth(): Promise<SwarmNodeHealth>;
  checkPostageBatch(batchId?: string): Promise<PostageBatchInfo>;
  uploadBinary(data: Uint8Array, options?: { postageBatchId?: string; contentType?: string }): Promise<SwarmUploadResult>;
  downloadBinary(reference: string, expectedHash?: string): Promise<SwarmDownloadResult>;
  uploadCheckpointArtifacts(
    archiveBytes: Uint8Array,
    contextBytes: Uint8Array,
    metadata: { checkpointId: string; projectId: string; postageBatchId?: string }
  ): Promise<DualArtifactUploadResult>;
}

