import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  calculateSHA256,
  uploadContextFile,
  getContextFile,
  verifyContentIntegrity,
  getActiveStorageProvider,
} from '@/services/swarm/operations';

describe('Ethereum Swarm Content-Addressed Storage & Hashing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Cryptographic SHA-256: computes standard sha256: hex string', async () => {
    const text = 'Hello AUTONEX on Ethereum Swarm!';
    const hash = await calculateSHA256(text);

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Deterministic check
    const hash2 = await calculateSHA256(text);
    expect(hash2).toBe(hash);

    // Difference check
    const hashDiff = await calculateSHA256('Different text');
    expect(hashDiff).not.toBe(hash);
  });

  it('2. SHA-256: works with Uint8Array binary buffers', async () => {
    const bytes = new TextEncoder().encode('Binary payload content');
    const hash = await calculateSHA256(bytes);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('3. Upload Context File: generates 64-char Swarm content address & SHA-256 hash', async () => {
    const payload = JSON.stringify({
      project: 'CRYPTracker',
      summary: 'Automated consensus deliverable',
      timestamp: Date.now(),
    });

    const mockRef = 'ebb37e867f90bff371c628ad269d98360543f66c3e462e4186e2c2de1c9c2091';
    const provider = getActiveStorageProvider();
    vi.spyOn(provider, 'uploadBinary').mockResolvedValueOnce({
      reference: mockRef,
      contentHash: await calculateSHA256(payload),
      byteSize: new TextEncoder().encode(payload).byteLength,
      contentType: 'application/json',
      timestamp: new Date().toISOString(),
    });

    const res = await uploadContextFile(payload, 'deliverable.json', 'application/json');

    expect(res.swarmReference).toHaveLength(64);
    expect(res.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(res.fileName).toBe('deliverable.json');
    expect(res.contentType).toBe('application/json');
    expect(res.fileSize).toBe(new TextEncoder().encode(payload).byteLength);
  });

  it('4. Get Context File: retrieves stored content from content reference', async () => {
    const sampleMd = '# AUTONEX Deliverable Report\n\n- Milestone 1: Done\n- Milestone 2: Done';
    const mockRef = 'ebb37e867f90bff371c628ad269d98360543f66c3e462e4186e2c2de1c9c2091';
    const provider = getActiveStorageProvider();

    vi.spyOn(provider, 'downloadBinary').mockResolvedValueOnce({
      data: new TextEncoder().encode(sampleMd),
      contentHash: await calculateSHA256(sampleMd),
      byteSize: new TextEncoder().encode(sampleMd).byteLength,
      verified: true,
    });

    const retrieved = await getContextFile(mockRef);

    expect(retrieved.content).toBe(sampleMd);
    expect(retrieved.contentType).toBe('application/json');
    expect(retrieved.fileSize).toBe(new TextEncoder().encode(sampleMd).byteLength);
  });

  it('5. Verify Content Integrity: correctly validates intact and detects tampered data', async () => {
    const originalContent = 'Valid untampered report data';
    const originalHash = await calculateSHA256(originalContent);

    // Untampered match
    const isValid = await verifyContentIntegrity(originalContent, originalHash);
    expect(isValid).toBe(true);

    // Tampered mismatch
    const isTamperedValid = await verifyContentIntegrity(originalContent + ' [tampered]', originalHash);
    expect(isTamperedValid).toBe(false);
  });

  it('6. Error Handling: throws clean descriptive error when reference not found', async () => {
    const nonExistentRef = '0000000000000000000000000000000000000000000000000000000000000000';
    const provider = getActiveStorageProvider();
    vi.spyOn(provider, 'downloadBinary').mockRejectedValueOnce(
      new Error(`Failed to retrieve binary data from Swarm reference "${nonExistentRef}": Not found`)
    );
    await expect(getContextFile(nonExistentRef)).rejects.toThrow();
  });
});

