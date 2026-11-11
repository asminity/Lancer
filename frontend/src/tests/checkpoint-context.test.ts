/**
 * AUTONEX Checkpoint Engine: AI Context Snapshot & Restoration Tests (Phase 4)
 *
 * Verifies:
 * 1. Deep context capture (objectives, tasks, roster, decisions, continuation instructions)
 * 2. Secret and credential sanitization (private keys, API keys, passwords)
 * 3. AES-256-GCM authenticated encryption and SHA-256 checksum verification
 * 4. Dual checkpoint isolation: restoring CP-003 does not accidentally use CP-005's AI context
 * 5. Swarm real storage upload & download round-trip
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../state/store';
import {
  captureAIContext,
  serializeAndEncryptContext,
  sanitizeContextText,
} from '../services/checkpoint/contextCapture';
import {
  decryptAndValidateContext,
  applyRestoredContextToStore,
} from '../services/checkpoint/contextRestore';
import { SwarmStorageProvider } from '../services/swarm/beeProvider';
import { generateEncryptionKey } from '../services/checkpoint/crypto';

describe('AUTONEX AI Context Snapshot Engine (Phase 4)', () => {
  const testKey = generateEncryptionKey();

  beforeEach(() => {
    vi.restoreAllMocks();
    useStore.getState().resetRun('Build Orderbook DEX with Live Matching');
  });

  it('1. Secret Sanitization: redacts private keys, API keys, and credentials from context', () => {
    const rawNote =
      'Created backend service with PRIVATE_KEY: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef and 0G key 0g-abc123def456ghi789. Password was secret_pass123!';
    const sanitized = sanitizeContextText(rawNote);

    expect(sanitized).not.toContain('0x1234567890abcdef');
    expect(sanitized).not.toContain('0g-abc123def456ghi789');
    expect(sanitized).not.toContain('secret_pass123');
    expect(sanitized).toContain('[REDACTED_PRIVATE_KEY]');
    expect(sanitized).toContain('[REDACTED_0G_KEY]');
    expect(sanitized).toContain('[REDACTED_PASSWORD]');
  });

  it('2. Cryptographic Tamper Defense: rejects corrupted context payload or modified checksum', () => {
    const state = useStore.getState();
    const context = captureAIContext(state, {
      checkpointId: 'chk_test_tamper_001',
      projectId: 'proj_orderbook_dex',
    });

    const encrypted = serializeAndEncryptContext(context, testKey);

    // Tamper with the ciphertext
    const tampered = {
      ...encrypted,
      ciphertext: new Uint8Array(encrypted.ciphertext),
    };
    tampered.ciphertext[0] ^= 0xff; // Flip bits

    expect(() => decryptAndValidateContext(tampered, testKey)).toThrow(/Decryption failed|Unsupported state/i);

    // Tamper with checksum
    const tamperedChecksum = {
      ...encrypted,
      contextChecksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    };
    expect(() => decryptAndValidateContext(tamperedChecksum, testKey)).toThrow(
      /Cryptographic Checksum Mismatch/i
    );
  });

  it('3. Schema Version Validation: rejects outdated or unsupported schema versions', () => {
    const state = useStore.getState();
    const context = captureAIContext(state, {
      checkpointId: 'chk_test_version_001',
      projectId: 'proj_orderbook_dex',
    });

    (context as any).schemaVersion = '1.0.0';
    const encrypted = serializeAndEncryptContext(context, testKey);

    expect(() => decryptAndValidateContext(encrypted, testKey)).toThrow(
      /Unsupported schema version "1.0.0"/i
    );
  });

  it('4. Dual Checkpoint Isolation (CP-003 vs CP-005): restoring older checkpoint completely restores matching context', () => {
    // ── Setup State for CP-003 (Early Stage: 1 done, 1 running, 1 pending) ──
    useStore.setState({
      goal: 'Phase 1: Build Orderbook DEX Core',
      tasks: {
        T1: {
          id: 'T1',
          parent_id: null,
          description: 'Implement matching engine logic',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'done',
          priority: 1,
          depends_on: [],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 60,
        },
        T2: {
          id: 'T2',
          parent_id: null,
          description: 'Build REST and WebSocket trading API',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'running',
          priority: 2,
          depends_on: ['T1'],
          attempts: 1,
          progress_pct: 45,
          est_effort_s: 90,
        },
        T3: {
          id: 'T3',
          parent_id: null,
          description: 'Write automated unit tests for order placement',
          owner_role: 'qa',
          assigned_agent: 'W_qa_0',
          status: 'pending',
          priority: 3,
          depends_on: ['T2'],
          attempts: 0,
          progress_pct: 0,
          est_effort_s: 45,
        },
      },
      agents: {
        W_backend_0: {
          id: 'W_backend_0',
          name: 'Rohan',
          role: 'worker',
          department: 'engineering',
          parent_id: 'M0',
          engine: { kind: 'llm', label: '0G · qwen3-coder-flash' },
          status: 'WORKING',
          energy: 78,
          context_tokens: 1200,
          context_max: 1000000,
          current_task_id: 'T2',
          avatar_seed: 2,
          pending: 1,
          done: 1,
          failed: 0,
          outputs: [],
        },
      },
      simClock: '00:15:30',
      realElapsed: 120,
    });

    const cp003Context = captureAIContext(useStore.getState(), {
      checkpointId: 'CP-003',
      projectId: 'orderbook-dex',
      currentTaskId: 'T2',
      customContinuationInstructions: 'CP-003 Instruction: Continue writing order placement REST API in backend/routes.py.',
    });
    const cp003Encrypted = serializeAndEncryptContext(cp003Context, testKey);

    // ── Advance State to CP-005 (Late Stage: 3 done, 1 running, 1 pending) ──
    useStore.setState({
      goal: 'Phase 2: Stress Testing & Mainnet Staging',
      tasks: {
        T1: {
          id: 'T1',
          parent_id: null,
          description: 'Implement matching engine logic',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'done',
          priority: 1,
          depends_on: [],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 60,
        },
        T2: {
          id: 'T2',
          parent_id: null,
          description: 'Build REST and WebSocket trading API',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'done',
          priority: 2,
          depends_on: ['T1'],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 90,
        },
        T3: {
          id: 'T3',
          parent_id: null,
          description: 'Write automated unit tests for order placement',
          owner_role: 'qa',
          assigned_agent: 'W_qa_0',
          status: 'done',
          priority: 3,
          depends_on: ['T2'],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 45,
        },
        T4: {
          id: 'T4',
          parent_id: null,
          description: 'Run stress test with 50,000 synthetic market orders',
          owner_role: 'qa',
          assigned_agent: 'W_qa_0',
          status: 'running',
          priority: 4,
          depends_on: ['T3'],
          attempts: 1,
          progress_pct: 60,
          est_effort_s: 120,
        },
        T5: {
          id: 'T5',
          parent_id: null,
          description: 'Deploy verified smart contracts to Rabdi DB-Chain',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'pending',
          priority: 5,
          depends_on: ['T4'],
          attempts: 0,
          progress_pct: 0,
          est_effort_s: 180,
        },
      },
      agents: {
        W_backend_0: {
          id: 'W_backend_0',
          name: 'Rohan',
          role: 'worker',
          department: 'engineering',
          parent_id: 'M0',
          engine: { kind: 'llm', label: '0G · qwen3-coder-flash' },
          status: 'IDLE',
          energy: 95,
          context_tokens: 3500,
          context_max: 1000000,
          current_task_id: null,
          avatar_seed: 2,
          pending: 1,
          done: 2,
          failed: 0,
          outputs: [],
        },
        W_qa_0: {
          id: 'W_qa_0',
          name: 'Kabir',
          role: 'worker',
          department: 'qa',
          parent_id: 'M0',
          engine: { kind: 'llm', label: '0G · qwen3-coder-flash' },
          status: 'WORKING',
          energy: 65,
          context_tokens: 4200,
          context_max: 1000000,
          current_task_id: 'T4',
          avatar_seed: 3,
          pending: 0,
          done: 1,
          failed: 0,
          outputs: [],
        },
      },
      simClock: '01:45:00',
      realElapsed: 480,
    });

    const cp005Context = captureAIContext(useStore.getState(), {
      checkpointId: 'CP-005',
      projectId: 'orderbook-dex',
      currentTaskId: 'T4',
      customContinuationInstructions: 'CP-005 Instruction: Verify stress test throughput benchmarks and prepare L2 deploy script.',
    });
    const cp005Encrypted = serializeAndEncryptContext(cp005Context, testKey);

    // Verify current state is indeed CP-005
    expect(useStore.getState().tasks['T4']).toBeDefined();
    expect(useStore.getState().tasks['T4'].status).toBe('running');
    expect(useStore.getState().goal).toBe('Phase 2: Stress Testing & Mainnet Staging');

    // ── NOW RESTORE CP-003: PROVE IT DOES NOT ACCIDENTALLY USE CP-005'S CONTEXT ──
    const restoredCP003 = decryptAndValidateContext(cp003Encrypted, testKey);
    const result003 = applyRestoredContextToStore(restoredCP003);

    const storeStateAfter003 = useStore.getState();

    // 1. Goal restored to CP-003
    expect(storeStateAfter003.goal).toBe('Phase 1: Build Orderbook DEX Core');

    // 2. Tasks restored to CP-003 state
    expect(storeStateAfter003.tasks['T1'].status).toBe('done');
    expect(storeStateAfter003.tasks['T2'].status).toBe('running');
    expect(storeStateAfter003.tasks['T3'].status).toBe('pending');

    // 3. CRITICAL: CP-005 tasks MUST NOT exist in CP-003!
    expect(storeStateAfter003.tasks['T4']).toBeUndefined();
    expect(storeStateAfter003.tasks['T5']).toBeUndefined();

    // 4. Active agent instruction must be CP-003, NOT CP-005
    expect(result003.continuationInstructions).toContain('CP-003 Instruction');
    expect(result003.continuationInstructions).not.toContain('CP-005 Instruction');
    expect(result003.activeTaskId).toBe('T2');

    // 5. Agent assigned task must be T2
    expect(storeStateAfter003.agents['W_backend_0'].current_task_id).toBe('T2');
    expect(storeStateAfter003.agents['W_backend_0'].status).toBe('WORKING');

    // ── NOW RESTORE CP-005: PROVE REVERSIBILITY ──
    const restoredCP005 = decryptAndValidateContext(cp005Encrypted, testKey);
    const result005 = applyRestoredContextToStore(restoredCP005);

    const storeStateAfter005 = useStore.getState();

    // 1. Goal restored to CP-005
    expect(storeStateAfter005.goal).toBe('Phase 2: Stress Testing & Mainnet Staging');

    // 2. T4 and T5 are back
    expect(storeStateAfter005.tasks['T4']).toBeDefined();
    expect(storeStateAfter005.tasks['T4'].status).toBe('running');
    expect(storeStateAfter005.tasks['T5']).toBeDefined();
    expect(storeStateAfter005.tasks['T5'].status).toBe('pending');

    // 3. Continuation instructions match CP-005
    expect(result005.continuationInstructions).toContain('CP-005 Instruction');
    expect(result005.continuationInstructions).not.toContain('CP-003 Instruction');
    expect(result005.activeTaskId).toBe('T4');
  });

  it('5. Real Swarm Provider Round-Trip: uploads encrypted context and retrieves it intact', async () => {
    const provider = new SwarmStorageProvider();
    const mockBee = (provider as any).bee;

    const state = useStore.getState();
    const context = captureAIContext(state, {
      checkpointId: 'CP-SWARM-001',
      projectId: 'orderbook-dex',
    });
    const encrypted = serializeAndEncryptContext(context, testKey);

    const expectedSwarmRef = '3333333333333333333333333333333333333333333333333333333333333333';

    // Mock real Bee SDK raw data operations
    vi.spyOn(mockBee.data, 'upload').mockResolvedValueOnce({
      reference: expectedSwarmRef,
    } as any);

    vi.spyOn(mockBee.data, 'download').mockResolvedValueOnce({
      toUint8Array: () => encrypted.ciphertext,
    } as any);

    // 1. Upload encrypted context to Swarm
    const uploadRes = await provider.uploadBinary(encrypted.ciphertext, {
      contentType: 'application/octet-stream',
    });

    expect(uploadRes.reference).toBe(expectedSwarmRef);
    expect(uploadRes.byteSize).toBe(encrypted.ciphertext.byteLength);

    // 2. Download encrypted context from Swarm
    const downloadRes = await provider.downloadBinary(expectedSwarmRef, uploadRes.contentHash);
    expect(downloadRes.verified).toBe(true);

    // 3. Decrypt and rehydrate
    const downloadedEncrypted = {
      ...encrypted,
      ciphertext: downloadRes.data,
    };
    const restored = decryptAndValidateContext(downloadedEncrypted, testKey);

    expect(restored.checkpointId).toBe('CP-SWARM-001');
    expect(restored.schemaVersion).toBe('2.0.0');
    expect(restored.payload.projectIdentity.projectName).toBe('Orderbook-DEX-with-Live');
  });
});
