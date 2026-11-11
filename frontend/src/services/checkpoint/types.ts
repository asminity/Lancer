/**
 * AUTONEX Checkpoint Engine Types (Version 2.0.0)
 *
 * Defines the contracts for genuine binary snapshot creation, TAR + Zstandard
 * archiving, AES-256-GCM authenticated encryption, and deterministic manifest generation.
 */

export interface ManifestFileEntry {
  path: string;
  size: number;
  sha256: string;
  mode: number;
  mtime: string;
  type: 'file' | 'directory';
}

export interface ManifestExclusionEntry {
  path: string;
  rule: string;
  reason: string;
  size?: number;
}

export interface EncryptionMetadata {
  enabled: boolean;
  algorithm: 'AES-256-GCM' | 'none';
  iv?: string;          // Hex-encoded 96-bit (12 bytes) IV
  authTag?: string;     // Hex-encoded 128-bit (16 bytes) GCM auth tag
  keyHint?: string;     // Reference or key identifier
}

export interface CheckpointManifest {
  version: '2.0.0';
  checkpointId: string;
  projectId: string;
  createdAt: string;
  archiveFormat: 'tar' | 'zip';
  compressionFormat: 'zstd' | 'deflate';
  compressionLevel: number;
  encryption: EncryptionMetadata;
  files: ManifestFileEntry[];
  exclusions: ManifestExclusionEntry[];
  totalCapturedFiles: number;
  totalCapturedDirectories: number;
  totalCapturedBytes: number;
  archiveSha256: string;
  compressedSize: number;
  rawTarSize: number;
  metadata?: Record<string, any>;
}

export interface SnapshotOptions {
  workspaceDir: string;
  projectId: string;
  checkpointId?: string;
  encryptionKey?: Buffer | Uint8Array | string;
  compressionLevel?: number; // 1 to 19 (default: 3)
  customExclusions?: string[];
  metadata?: Record<string, any>;
}

export interface SnapshotResult {
  checkpointId: string;
  projectId: string;
  manifest: CheckpointManifest;
  manifestJson: string;
  archiveBytes: Uint8Array;
  archiveSha256: string;
  rawTarSize: number;
  compressedSize: number;
  encryptedSize: number;
  compressionRatio: number;
}

export interface ExtractionOptions {
  archiveBytes: Uint8Array;
  targetDir: string;
  manifest: CheckpointManifest;
  decryptionKey?: Buffer | Uint8Array | string;
  allowOverwrite?: boolean;
}

export interface ExtractionResult {
  restoredFilesCount: number;
  restoredDirectoriesCount: number;
  totalBytesExtracted: number;
  verifiedFileHashes: boolean;
  restoredPaths: string[];
}
