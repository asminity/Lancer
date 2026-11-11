/**
 * AUTONEX Checkpoint Engine: Ethereum Swarm Storage Provider (Bee JS)
 *
 * Implements real, unmocked decentralized storage for binary archives and AI contexts
 * using the official @ethersphere/bee-js SDK.
 */

import { Bee, Reference } from '@ethersphere/bee-js';
import {
  type StorageProvider,
  type StorageProviderState,
  type PostageBatchInfo,
  type SwarmNodeHealth,
  type SwarmUploadResult,
  type SwarmDownloadResult,
  type DualArtifactUploadResult,
} from './types';
import { calculateSHA256 } from '../checkpoint/crypto';
import { getSwarmConfig, type SwarmConfig } from './client';

export class SwarmStorageProvider implements StorageProvider {
  public readonly name = 'Ethereum Swarm (Bee)';
  private bee: Bee;
  private config: SwarmConfig;
  private state: StorageProviderState = 'CONNECTING';

  constructor(customConfig?: Partial<SwarmConfig>) {
    this.config = { ...getSwarmConfig(), ...customConfig };
    this.bee = new Bee(this.config.gatewayUrl);
  }

  private usesPublicGateway(): boolean {
    try {
      return new URL(this.config.gatewayUrl).hostname.endsWith('ethswarm.org');
    } catch {
      return false;
    }
  }

  public getState(): StorageProviderState {
    return this.state;
  }

  /**
   * 1. Health & Node Connectivity Check
   */
  public async checkHealth(): Promise<SwarmNodeHealth> {
    this.state = 'CONNECTING';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 10000);

    try {
      let isConnected = false;
      try {
        isConnected = await this.bee.connectivity.isConnected();
      } catch {
        // Continue to direct HTTP check if SDK connectivity check had issues
      }

      if (!isConnected) {
        const res = await fetch(`${this.config.gatewayUrl.replace(/\/$/, '')}/health`, {
          signal: controller.signal,
        });
        isConnected = res.ok;
      }
      clearTimeout(timeout);

      if (isConnected) {
        this.state = 'READY';
        return {
          connected: true,
          gatewayUrl: this.config.gatewayUrl,
          status: 'ok',
          message: 'Swarm Bee endpoint is reachable and healthy.',
        };
      }

      this.state = 'UPLOAD_FAILED';
      return {
        connected: false,
        gatewayUrl: this.config.gatewayUrl,
        status: 'unreachable',
        message: `Bee node at ${this.config.gatewayUrl} is unreachable or unhealthy.`,
      };
    } catch (err: any) {
      clearTimeout(timeout);
      this.state = 'UPLOAD_FAILED';
      return {
        connected: false,
        gatewayUrl: this.config.gatewayUrl,
        status: 'unreachable',
        message: `Failed to connect to Swarm Bee node at ${this.config.gatewayUrl}: ${err?.message || 'Connection refused'}`,
      };
    }
  }

  /**
   * 2. Postage Stamp Batch Usability & Capacity Verification
   */
  public async checkPostageBatch(batchId?: string): Promise<PostageBatchInfo> {
    const targetBatch = (batchId || this.config.postageBatchId || '').trim();

    // If no batch is configured, check if endpoint is a public test gateway allowing zero-stamp writes
    if (!targetBatch) {
      const isPublicGateway = this.usesPublicGateway();
      if (isPublicGateway) {
        return {
          batchId: 'public-gateway-zero-stamp',
          usable: true,
          utilization: 0,
          depth: 17,
          bucketDepth: 16,
          exists: true,
          message: 'Using public Swarm gateway with default community postage.',
        };
      }
      this.state = 'POSTAGE_BATCH_INVALID';
      throw new Error(
        'Swarm Postage Batch ID is required for uploads. Configure VITE_SWARM_POSTAGE_BATCH_ID or pass batchId.'
      );
    }

    try {
      const stamp = await this.bee.stamp.get(targetBatch as any);
      if (!stamp) {
        this.state = 'POSTAGE_BATCH_INVALID';
        throw new Error(`Postage batch "${targetBatch}" was not found on the Swarm network.`);
      }

      const batchTTL = typeof (stamp as any).batchTTL === 'number'
        ? (stamp as any).batchTTL
        : (typeof (stamp as any).duration === 'number' ? (stamp as any).duration : 0);

      if (!stamp.usable) {
        this.state = 'POSTAGE_BATCH_INSUFFICIENT';
        throw new Error(
          `Postage batch "${targetBatch}" exists but is not currently usable (batchTTL: ${batchTTL}s). Please top up or fund the batch.`
        );
      }

      const utilization = typeof stamp.utilization === 'number' ? stamp.utilization : 0;
      if (utilization >= 1) {
        this.state = 'POSTAGE_BATCH_INSUFFICIENT';
        throw new Error(
          `Postage batch "${targetBatch}" capacity is 100% exhausted. Dilute or create a new batch before uploading.`
        );
      }

      return {
        batchId: targetBatch,
        usable: true,
        utilization,
        depth: stamp.depth,
        bucketDepth: stamp.bucketDepth,
        batchTTL: batchTTL || undefined,
        exists: true,
      };
    } catch (err: any) {
      if (this.state !== 'POSTAGE_BATCH_INSUFFICIENT') {
        this.state = 'POSTAGE_BATCH_INVALID';
      }
      throw new Error(`Postage batch verification failed for "${targetBatch}": ${err?.message || 'Invalid batch'}`);
    }
  }

  /**
   * 3. Upload Binary Data to Ethereum Swarm
   */
  public async uploadBinary(
    data: Uint8Array,
    options?: { postageBatchId?: string; contentType?: string }
  ): Promise<SwarmUploadResult> {
    if (!data || data.byteLength === 0) {
      throw new Error('Cannot upload empty binary payload to Swarm.');
    }

    this.state = 'UPLOADING';
    const contentHash = calculateSHA256(data);
    const byteSize = data.byteLength;
    const contentType = options?.contentType || 'application/octet-stream';
    const timeoutMs = this.config.timeoutMs || 15000;

    // Determine batch ID to use
    let batchId = (options?.postageBatchId || this.config.postageBatchId || '').trim();
    if (!batchId) {
      if (!this.usesPublicGateway()) {
        this.state = 'POSTAGE_BATCH_INVALID';
        throw new Error(
          `Swarm uploads to "${this.config.gatewayUrl}" require VITE_SWARM_POSTAGE_BATCH_ID. ` +
          'Use the public ethSwarm gateway for no-postage development uploads or configure a funded Bee postage batch.'
        );
      }
      // The official public gateway accepts the null batch for development uploads.
      batchId = '0'.repeat(64);
    }

    try {
      const uploadRes = await Promise.race([
        this.bee.data.upload(batchId as any, data),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Upload timed out after ${timeoutMs}ms.`)), timeoutMs)
        ),
      ]);
      const reference = String(
        (uploadRes.reference as any)?.toHex ? (uploadRes.reference as any).toHex() : uploadRes.reference
      );

      if (!reference || reference.length !== 64) {
        this.state = 'UPLOAD_FAILED';
        throw new Error(`Swarm upload returned invalid reference: "${reference}". Expected 64-character hex address.`);
      }

      this.state = 'READY';
      return {
        reference,
        contentHash,
        byteSize,
        contentType,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      this.state = 'UPLOAD_FAILED';
      throw new Error(`Ethereum Swarm upload failed: ${err?.message || 'Network error during binary upload'}`);
    }
  }

  /**
   * 4. Download Binary Data from Ethereum Swarm by Reference
   */
  public async downloadBinary(reference: string, expectedHash?: string): Promise<SwarmDownloadResult> {
    const cleanRef = (reference || '').trim();
    if (!cleanRef || cleanRef.length !== 64) {
      throw new Error(`Invalid Swarm reference: "${reference}". Expected 64-character hex hash.`);
    }

    this.state = 'DOWNLOADING';
    const timeoutMs = this.config.timeoutMs || 15000;
    try {
      const swarmBytes = await Promise.race([
        this.bee.data.download(cleanRef),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Download timed out after ${timeoutMs}ms.`)), timeoutMs)
        ),
      ]);
      const data = swarmBytes.toUint8Array();
      const actualHash = calculateSHA256(data);

      this.state = 'VERIFYING';
      let verified = true;
      if (expectedHash) {
        if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
          this.state = 'DOWNLOAD_FAILED';
          throw new Error(
            `Cryptographic Integrity Mismatch! Downloaded data from Swarm ref "${cleanRef}" produced SHA-256 ${actualHash}, expected ${expectedHash}. Data was corrupted or tampered with.`
          );
        }
      }

      this.state = 'VERIFIED';
      return {
        data,
        contentHash: actualHash,
        byteSize: data.byteLength,
        verified,
      };
    } catch (err: any) {
      this.state = 'DOWNLOAD_FAILED';
      throw new Error(`Failed to retrieve binary data from Swarm reference "${cleanRef}": ${err?.message || 'Not found or timeout'}`);
    }
  }

  /**
   * 5. Upload Paired Checkpoint Artifacts (Binary Archive + AI Context) with Verification
   */
  public async uploadCheckpointArtifacts(
    archiveBytes: Uint8Array,
    contextBytes: Uint8Array,
    metadata: { checkpointId: string; projectId: string; postageBatchId?: string }
  ): Promise<DualArtifactUploadResult> {
    // 1. Upload Workspace Binary Archive (TAR + Zstandard)
    const archiveResult = await this.uploadBinary(archiveBytes, {
      postageBatchId: metadata.postageBatchId,
      contentType: 'application/zstd',
    });

    // 2. Upload AI Context Snapshot
    const contextResult = await this.uploadBinary(contextBytes, {
      postageBatchId: metadata.postageBatchId,
      contentType: 'application/json',
    });

    // 3. Immediately re-download and verify both artifacts from Swarm
    await this.downloadBinary(archiveResult.reference, archiveResult.contentHash);
    await this.downloadBinary(contextResult.reference, contextResult.contentHash);

    return {
      checkpointId: metadata.checkpointId,
      projectId: metadata.projectId,
      archiveReference: archiveResult.reference,
      archiveContentHash: archiveResult.contentHash,
      archiveByteSize: archiveResult.byteSize,
      contextReference: contextResult.reference,
      contextContentHash: contextResult.contentHash,
      contextByteSize: contextResult.byteSize,
      verified: true,
      uploadedAt: new Date().toISOString(),
    };
  }
}
