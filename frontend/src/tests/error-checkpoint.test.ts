import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStore } from '../state/store';
import { applyEvent } from '../state/events';
import { uploadContextWorkflow, retrieveContextWorkflow } from '../services/storageWorkflow';
import { getActiveStorageProvider } from '../services/swarm/operations';
import * as arkivOps from '../services/arkiv/operations';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { rabdiChain } from '../config/chain';
import type { Envelope } from '../api/types';

describe('0G Inference Failure Checkpoint & Arkiv/Swarm Recovery Pipeline', () => {
  const TEST_ERROR =
    'Execution halted: 0G Private Computer inference failed (Request ID: 47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5)';

  beforeEach(() => {
    vi.restoreAllMocks();
    useStore.getState().resetRun('Build verified smart contract deployment CLI');
    useStore.setState({
      agents: {
        M0: {
          id: 'M0',
          name: 'Diya',
          role: 'manager',
          department: 'management',
          parent_id: null,
          engine: { kind: 'llm', label: '0G · glm-5.3-flash' },
          status: 'IDLE',
          energy: 100,
          context_tokens: 0,
          context_max: 1179648,
          current_task_id: null,
          avatar_seed: 1,
          pending: 0,
          done: 0,
          failed: 0,
          outputs: [],
        },
        W_backend_0: {
          id: 'W_backend_0',
          name: 'Rohan',
          role: 'worker',
          department: 'engineering',
          parent_id: 'M0',
          engine: { kind: 'llm', label: '0G · qwen3-coder-flash' },
          status: 'WORKING',
          energy: 85,
          context_tokens: 450,
          context_max: 1000000,
          current_task_id: 'T1',
          avatar_seed: 2,
          pending: 1,
          done: 0,
          failed: 0,
          outputs: [],
        },
        W_qa_0: {
          id: 'W_qa_0',
          name: 'Nisha',
          role: 'worker',
          department: 'engineering',
          parent_id: 'M0',
          engine: { kind: 'llm', label: '0G · kimi-k2.7-code' },
          status: 'IDLE',
          energy: 100,
          context_tokens: 0,
          context_max: 262144,
          current_task_id: null,
          avatar_seed: 4,
          pending: 0,
          done: 0,
          failed: 0,
          outputs: [],
        },
      },
      tasks: {
        T1: {
          id: 'T1',
          parent_id: null,
          description: 'Construct core deployment compiler',
          owner_role: 'backend',
          assigned_agent: 'W_backend_0',
          depends_on: [],
          status: 'running',
          progress_pct: 60,
          target_file: 'src/compiler.ts',
          priority: 'medium' as any,
          attempts: 0,
          est_effort_s: 60,
        },
        T2: {
          id: 'T2',
          parent_id: null,
          description: 'Implement gas simulation assertions',
          owner_role: 'qa',
          assigned_agent: 'W_qa_0',
          depends_on: ['T1'],
          status: 'pending',
          progress_pct: 0,
          target_file: 'src/test_compiler.ts',
          priority: 'medium' as any,
          attempts: 0,
          est_effort_s: 60,
        },
      },
    });
  });

  // --------------------------------------------------------------------------
  // Test 1: Triggering error checkpoint preserves context & switches agents
  // --------------------------------------------------------------------------
  it('1. Error Checkpoint Trigger: freezes state, extracts request ID, and switches agent', () => {
    useStore.getState().triggerErrorCheckpoint({
      error: TEST_ERROR,
      failedAgentId: 'W_backend_0',
    });

    const state = useStore.getState();

    // 1. Verify modal opened and state transitioned
    expect(state.errorCheckpointModalOpen).toBe(true);
    expect(state.executionState).toBe('failed');
    expect(state.executionError).toBe(TEST_ERROR);

    // 2. Verify Request ID extraction
    expect(state.errorCheckpointData).not.toBeNull();
    expect(state.errorCheckpointData?.requestId).toBe(
      '47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5'
    );

    // 3. Verify Agent Failover (Rohan -> Nisha)
    expect(state.errorCheckpointData?.failedAgentName).toBe('Rohan');
    expect(state.errorCheckpointData?.recoveryAgentName).toBe('Nisha');
    expect(state.selected).toBe('W_qa_0');

    // 4. Verify Checkpoint Summary synthesis
    expect(state.checkpointSummary).not.toBeNull();
    expect(state.checkpointSummary?.metadata.status).toBe('Interrupted');
    expect(state.checkpointSummary?.projectOverview.tasksTotal).toBe(2);

    // 5. Verify recovery note pinned to blackboard
    const recoveryNote = state.notes.find((n) => n.topic === 'CHECKPOINT_RECOVERY');
    expect(recoveryNote).toBeDefined();
    expect(recoveryNote?.note).toContain('0G Private Computer inference failed');
    expect(recoveryNote?.author_agent_id).toBe('W_qa_0');
  });

  // --------------------------------------------------------------------------
  // Test 2: Event Stream Integration via blackboard.note
  // --------------------------------------------------------------------------
  it('2. Event Stream: blackboard.note with 0G failure automatically activates checkpoint popup', () => {
    const errorEvent: Envelope = {
      seq: 42,
      run_id: 'run_test_123',
      ts_real: new Date().toISOString(),
      ts_sim: '09:14',
      type: 'blackboard.note',
      agent_id: 'W_backend_0',
      payload: {
        id: 'note_err_test',
        author_agent_id: 'W_backend_0',
        topic: 'ERROR',
        note: TEST_ERROR,
        ts: '09:14',
      },
    };

    applyEvent(errorEvent, false);

    const state = useStore.getState();
    expect(state.errorCheckpointModalOpen).toBe(true);
    expect(state.errorCheckpointData?.requestId).toBe(
      '47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5'
    );
    expect(state.errorCheckpointData?.failedAgentName).toBe('Rohan');
    expect(state.errorCheckpointData?.recoveryAgentName).toBe('Nisha');
  });

  // --------------------------------------------------------------------------
  // Test 3: Agent Failover Strategy for Different Roles
  // --------------------------------------------------------------------------
  it('3. Agent Failover Strategy: selects appropriate recovery agent depending on failed role', () => {
    // If QA agent fails, switches to Manager Diya
    useStore.getState().triggerErrorCheckpoint({
      error: '0G Private Computer inference failed: timeout',
      failedAgentId: 'W_qa_0',
    });

    let state = useStore.getState();
    expect(state.errorCheckpointData?.failedAgentName).toBe('Nisha');
    expect(state.errorCheckpointData?.recoveryAgentName).toBe('Diya');

    // If Manager fails, switches to QA Nisha
    useStore.getState().triggerErrorCheckpoint({
      error: '0G Private Computer inference failed: rate_limited',
      failedAgentId: 'M0',
    });

    state = useStore.getState();
    expect(state.errorCheckpointData?.failedAgentName).toBe('Diya');
    expect(state.errorCheckpointData?.recoveryAgentName).toBe('Nisha');
  });

  // --------------------------------------------------------------------------
  // Test 4: End-to-End Arkiv + Swarm Storage Workflow for Checkpoint Context
  // --------------------------------------------------------------------------
  it('4. Arkiv + Swarm Pipeline: saves checkpoint payload to Swarm and anchors reference on Arkiv', async () => {
    const mockEntityKey = '0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000' as any;
    const mockTxHash = '0xaaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999' as any;
    const checkpointId = `chk_test_${Date.now()}`;

    let capturedMeta: any = null;
    vi.spyOn(arkivOps, 'saveArkivContextRef').mockImplementation(async (_client, meta) => {
      capturedMeta = meta;
      return { entityKey: mockEntityKey, txHash: mockTxHash };
    });

    vi.spyOn(arkivOps, 'getArkivContextRefByReportId').mockImplementation(async () => {
      return {
        key: mockEntityKey,
        reportId: checkpointId,
        projectId: capturedMeta.projectId,
        userId: capturedMeta.userId,
        owner: capturedMeta.userId,
        storageProvider: 'swarm_bzz',
        swarmRef: capturedMeta.swarmRef,
        contentHash: capturedMeta.contentHash,
        fileName: capturedMeta.fileName,
        contentType: 'application/json',
        fileSize: capturedMeta.fileSize,
        createdAt: Date.now(),
        summary: capturedMeta.summary,
        entityKey: mockEntityKey,
      };
    });

    const mockWalletClient: any = {
      account: { address: '0x1234567890123456789012345678901234567890' },
    };

    const payload = JSON.stringify(
      {
        checkpointId,
        error: TEST_ERROR,
        status: 'Interrupted',
        failedAgent: 'W_backend_0',
        recoveryAgent: 'W_qa_0',
        tasks: Object.values(useStore.getState().tasks),
        notes: useStore.getState().notes,
      },
      null,
      2
    );

    const mockSwarmRef = 'ebb37e867f90bff371c628ad269d98360543f66c3e462e4186e2c2de1c9c2091';
    const provider = getActiveStorageProvider();
    vi.spyOn(provider, 'uploadBinary').mockResolvedValueOnce({
      reference: mockSwarmRef,
      contentHash: 'sha256:dummy',
      byteSize: new TextEncoder().encode(payload).byteLength,
      contentType: 'application/json',
      timestamp: new Date().toISOString(),
    });
    vi.spyOn(provider, 'downloadBinary').mockResolvedValueOnce({
      data: new TextEncoder().encode(payload),
      contentHash: 'sha256:dummy',
      byteSize: new TextEncoder().encode(payload).byteLength,
      verified: true,
    });

    // 1. Upload heavy context to Swarm and register reference on Arkiv
    const uploadResult = await uploadContextWorkflow(mockWalletClient, payload, {
      projectId: 'autonex-checkpoint-cli',
      userId: '0x1234567890123456789012345678901234567890',
      reportId: checkpointId,
      fileName: 'checkpoint-incident-context.json',
      contentType: 'application/json',
      summary: 'Emergency recovery checkpoint for 0G Private Computer inference failure',
    });

    expect(uploadResult.swarmReference).toBeDefined();
    expect(uploadResult.swarmReference).toHaveLength(64);
    expect(uploadResult.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(uploadResult.reportId).toBe(checkpointId);
    expect(uploadResult.entityKey).toBe(mockEntityKey);
    expect(uploadResult.txHash).toBe(mockTxHash);

    // 2. Retrieve from Arkiv pointer and verify SHA-256 from Swarm
    const check = await retrieveContextWorkflow(checkpointId, uploadResult.entityKey);
    expect(check.verified).toBe(true);
    expect(check.expectedHash).toBe(uploadResult.contentHash);
    expect(check.actualHash).toBe(uploadResult.contentHash);
    expect(check.content).toContain('47fe2489886d5d85');
  });
});
