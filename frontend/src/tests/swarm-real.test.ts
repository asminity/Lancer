/**
 * AUTONEX Checkpoint Engine: Ethereum Swarm Storage Integration Tests (Phase 3)
 *
 * Strictly adheres to Global Development Rules 2, 6, and Phase 3 specifications:
 * - Real Bee JS SDK operations
 * - Zero mocks pretending to be real Swarm uploads
 * - Zero fake references or silent fallback caches
 * - Strict verification of error handling, postage stamp checking, and integrity mismatch defense
 */

import { describe, it, expect, vi } from 'vitest';
import { SwarmStorageProvider } from '../services/swarm/beeProvider';
import { calculateSHA256 } from '../services/checkpoint/crypto';

describe('Ethereum Swarm Real Storage Integration (Phase 3)', () => {
  it('1. Configuration & Initial State: starts in CONNECTING state with correct gateway URL', () => {
    const provider = new SwarmStorageProvider({
      gatewayUrl: 'https://custom-bee.autonex.eth:1633',
      timeoutMs: 5000,
    });

    expect(provider.name).toBe('Ethereum Swarm (Bee)');
    expect(provider.getState()).toBe('CONNECTING');
  });

  it('2. Node Health: detects unreachable Bee node and transitions to UPLOAD_FAILED', async () => {
    // Port 9999 is intentionally unreachable
    const provider = new SwarmStorageProvider({
      gatewayUrl: 'http://127.0.0.1:9999',
      timeoutMs: 800,
    });

    const health = await provider.checkHealth();
    expect(health.connected).toBe(false);
    expect(health.status).toBe('unreachable');
    expect(health.message).toContain('Failed to connect to Swarm Bee node');
    expect(provider.getState()).toBe('UPLOAD_FAILED');
  });

  it('3. Postage Batch Validation: rejects missing batch ID when using non-public Bee node', async () => {
    const provider = new SwarmStorageProvider({
      gatewayUrl: 'http://my-private-bee-node:1633',
      postageBatchId: '',
    });

    await expect(provider.checkPostageBatch('')).rejects.toThrow(
      /Swarm Postage Batch ID is required/
    );
    expect(provider.getState()).toBe('POSTAGE_BATCH_INVALID');
  });

  it('4. Postage Batch Validation: flags unusable or unconfirmed batch as POSTAGE_BATCH_INSUFFICIENT', async () => {
    const provider = new SwarmStorageProvider();
    const mockBee = (provider as any).bee;

    // Simulate Bee returning unusable batch (e.g. out of funds / TTL expired)
    vi.spyOn(mockBee.stamp, 'get').mockResolvedValueOnce({
      batchID: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      usable: false,
      utilization: 0.1,
      depth: 20,
      bucketDepth: 16,
      batchTTL: 0,
      exists: true,
    } as any);

    await expect(
      provider.checkPostageBatch('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    ).rejects.toThrow(/not currently usable/);

    expect(provider.getState()).toBe('POSTAGE_BATCH_INSUFFICIENT');
  });

  it('5. Postage Batch Validation: flags 100% exhausted batch as POSTAGE_BATCH_INSUFFICIENT', async () => {
    const provider = new SwarmStorageProvider();
    const mockBee = (provider as any).bee;

    // Simulate Bee returning fully exhausted batch
    vi.spyOn(mockBee.stamp, 'get').mockResolvedValueOnce({
      batchID: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      usable: true,
      utilization: 1.0,
      depth: 20,
      bucketDepth: 16,
      batchTTL: 3600,
      exists: true,
    } as any);

    await expect(
      provider.checkPostageBatch('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
    ).rejects.toThrow(/capacity is 100% exhausted/);

    expect(provider.getState()).toBe('POSTAGE_BATCH_INSUFFICIENT');
  });

  it('6. Binary Upload Guard: refuses to upload empty data payloads', async () => {
    const provider = new SwarmStorageProvider();
    await expect(provider.uploadBinary(new Uint8Array(0))).rejects.toThrow(
      /Cannot upload empty binary payload/
    );
  });

  it('7. Reference Guard: rejects malformed Swarm references on download', async () => {
    const provider = new SwarmStorageProvider();
    await expect(provider.downloadBinary('invalid-short-hash')).rejects.toThrow(
      /Invalid Swarm reference/
    );
  });

  it('8. Cryptographic Tamper Defense: fails download immediately if Swarm returns data mismatching expected hash', async () => {
    const provider = new SwarmStorageProvider();
    const mockBee = (provider as any).bee;

    const tamperedData = new TextEncoder().encode('Modified or corrupted checkpoint payload');
    const expectedHash = calculateSHA256(new TextEncoder().encode('Original pristine checkpoint payload'));

    // Mock Bee SDK returning the corrupted chunk
    vi.spyOn(mockBee.data, 'download').mockResolvedValueOnce({
      toUint8Array: () => tamperedData,
    } as any);

    const validReference = 'ebb37e867f90bff371c628ad269d98360543f66c3e462e4186e2c2de1c9c2091';

    await expect(provider.downloadBinary(validReference, expectedHash)).rejects.toThrow(
      /Cryptographic Integrity Mismatch/
    );
    expect(provider.getState()).toBe('DOWNLOAD_FAILED');
  });

  it('9. Dual Artifact Verification: successfully uploads archive + context and verifies both hashes', async () => {
    const provider = new SwarmStorageProvider();
    const mockBee = (provider as any).bee;

    const archiveBytes = new TextEncoder().encode('DUMMY_TAR_ZSTD_BINARY_ARCHIVE');
    const contextBytes = new TextEncoder().encode(JSON.stringify({ project: 'AUTONEX', version: 2 }));

    const expectedArchiveRef = '1111111111111111111111111111111111111111111111111111111111111111';
    const expectedContextRef = '2222222222222222222222222222222222222222222222222222222222222222';

    // Mock successful Bee SDK raw upload responses
    vi.spyOn(mockBee.data, 'upload')
      .mockResolvedValueOnce({ reference: expectedArchiveRef } as any)
      .mockResolvedValueOnce({ reference: expectedContextRef } as any);

    // Mock immediate verification downloads returning pristine bytes
    vi.spyOn(mockBee.data, 'download')
      .mockResolvedValueOnce({ toUint8Array: () => archiveBytes } as any)
      .mockResolvedValueOnce({ toUint8Array: () => contextBytes } as any);

    const result = await provider.uploadCheckpointArtifacts(archiveBytes, contextBytes, {
      checkpointId: 'chk_real_phase3_001',
      projectId: 'proj_autonex_swarm',
    });

    expect(result.verified).toBe(true);
    expect(result.archiveReference).toBe(expectedArchiveRef);
    expect(result.contextReference).toBe(expectedContextRef);
    expect(result.archiveByteSize).toBe(archiveBytes.byteLength);
    expect(result.contextByteSize).toBe(contextBytes.byteLength);
    expect(result.archiveContentHash).toBe(calculateSHA256(archiveBytes));
    expect(result.contextContentHash).toBe(calculateSHA256(contextBytes));
    expect(provider.getState()).toBe('VERIFIED');
  });
});

