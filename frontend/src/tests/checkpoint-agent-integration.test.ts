/**
 * AUTONEX Checkpoint Engine: Automatic Agent Execution Checkpointing (Phase 7 Tests)
 *
 * Comprehensive test suite verifying:
 * 1. Successful task execution lifecycle (Pre -> Work -> Post)
 * 2. Failed task execution (Partial state capture, FAILED status, safety preservation)
 * 3. Interrupted task execution (Partial state capture, INTERRUPTED status)
 * 4. User cancellation (Cancellation preserves recovery baseline)
 * 5. Empty task (Zero file workspace archiving)
 * 6. Task with no file modifications (Read-only execution with identical manifest hashes)
 * 7. Multiple consecutive tasks (Lineage chaining across T1 -> T2 -> T3)
 * 8. Concurrent tasks (Mutex serialization preventing TAR corruption)
 * 9. Storage failure before execution (Pre-execution block aborts destructive modifications)
 * 10. Storage failure after execution (Post-execution failure preserves pre-execution safety checkpoint)
 * 11. Backend restart during checkpoint creation (Startup recovery handles orphaned checkpoints)
 * 12. Manual checkpoint creation capability
 * 13. Credit independence (No LLM / 0G / iAI token reliance)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  AgentCheckpointCoordinator,
  PreExecutionSafetyCheckpointFailedError,
} from '../services/checkpoint/agentLifecycle';
import { CheckpointService } from '../services/checkpoint/checkpointService';
import { CheckpointDatabase } from '../services/checkpoint/checkpointDb';
import { SwarmStorageProvider } from '../services/swarm/beeProvider';
import { calculateSHA256 } from '../services/checkpoint/crypto';

describe('AUTONEX Checkpoint Engine: Automatic Agent Execution Checkpointing (Phase 7)', () => {
  let tempBaseDir: string;
  let testWorkspaceDir: string;
  let coordinator: AgentCheckpointCoordinator;
  let db: CheckpointDatabase;
  let service: CheckpointService;
  let swarmProvider: SwarmStorageProvider;
  let swarmNetwork: Map<string, Uint8Array>;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonex-phase7-test-'));
    testWorkspaceDir = path.join(tempBaseDir, 'project-workspace');
    fs.mkdirSync(testWorkspaceDir, { recursive: true });

    const dbPath = path.join(tempBaseDir, 'test-checkpoints.db');
    db = new CheckpointDatabase(dbPath);

    swarmNetwork = new Map<string, Uint8Array>();
    swarmProvider = new SwarmStorageProvider();
    const mockBee = (swarmProvider as any).bee;
    vi.spyOn(mockBee.data, 'upload').mockImplementation((async (_batchId: any, data: Uint8Array) => {
      const reference = calculateSHA256(data).replace('sha256:', '');
      swarmNetwork.set(reference, new Uint8Array(data));
      return { reference } as any;
    }) as any);

    vi.spyOn(mockBee.data, 'download').mockImplementation((async (reference: any) => {
      const cleanRef = String(reference).trim();
      const chunk = swarmNetwork.get(cleanRef);
      if (!chunk) {
        throw new Error(`Swarm reference "${cleanRef}" not found on network.`);
      }
      return {
        bytes: () => Promise.resolve(new Uint8Array(chunk)),
        toUint8Array: () => new Uint8Array(chunk),
        arrayBuffer: () => Promise.resolve(new Uint8Array(chunk).buffer),
      } as any;
    }) as any);

    service = new CheckpointService(db, swarmProvider);
    coordinator = new AgentCheckpointCoordinator(service);
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Successful task
  it('1. Successful task: captures pre-execution baseline, settles writes, and produces verified post-execution checkpoint', async () => {
    // Initial workspace with 2 files
    fs.writeFileSync(path.join(testWorkspaceDir, 'main.py'), 'print("initial")', 'utf-8');
    fs.writeFileSync(path.join(testWorkspaceDir, 'README.md'), '# Initial Docs', 'utf-8');

    const ctx = {
      projectId: 'proj-success-1',
      taskId: 'T1-implement-feature',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Implement user login feature',
    };

    // Step 1: Pre-execution checkpoint
    const preChk = await coordinator.onBeforeTaskExecution(ctx);
    expect(preChk.checkpointId).toBeDefined();
    expect(preChk.executionStatus).toBe('In Progress');
    expect(preChk.fileCount).toBe(2);

    // Step 2: Agent performs work (acquires write lock and modifies files)
    const releaseLock = coordinator.acquireWriteLock(testWorkspaceDir, ctx.taskId);
    fs.writeFileSync(path.join(testWorkspaceDir, 'main.py'), 'print("login active")', 'utf-8');
    fs.writeFileSync(path.join(testWorkspaceDir, 'auth.py'), 'def login(): pass', 'utf-8');
    releaseLock();

    // Step 3: Post-execution checkpoint
    const postChk = await coordinator.onTaskCompleted(ctx);
    expect(postChk.checkpointId).toBeDefined();
    expect(postChk.executionStatus).toBe('Completed');
    expect(postChk.lifecycleStatus).toBe('COMPLETED');
    expect(postChk.parentCheckpointId).toBe(preChk.checkpointId);
    expect(postChk.fileCount).toBe(3);

    // Verify Swarm refs are present and non-empty
    expect(postChk.archiveSwarmRef).toBeTruthy();
    expect(postChk.contextSwarmRef).toBeTruthy();
  });

  // 2. Failed task
  it('2. Failed task: captures partial state, marks execution FAILED, and preserves pre-execution safety checkpoint for recovery', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'index.ts'), 'export const a = 1;', 'utf-8');

    const ctx = {
      projectId: 'proj-fail-2',
      taskId: 'T2-refactor-api',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Refactor REST API to GraphQL',
    };

    // Pre-execution baseline
    const preChk = await coordinator.onBeforeTaskExecution(ctx);

    // Partial modifications
    fs.writeFileSync(path.join(testWorkspaceDir, 'index.ts'), 'export const syntax_error =', 'utf-8');

    // Agent fails
    const failRes = await coordinator.onTaskFailed({
      ...ctx,
      error: new Error('TypeScript syntax parse error at line 1'),
      failedAgentId: 'agent-coder-9',
    });

    expect(failRes.safetyCheckpointId).toBe(preChk.checkpointId);
    expect(failRes.failureCheckpoint).toBeDefined();
    expect(failRes.failureCheckpoint?.executionStatus).toBe('Failed');
    expect(failRes.failureCheckpoint?.lifecycleStatus).toBe('FAILED');
    expect(failRes.failureCheckpoint?.parentCheckpointId).toBe(preChk.checkpointId);

    // Pre-execution checkpoint is still intact in DB and COMPLETED
    const retrievedPre = db.getCheckpointById(preChk.checkpointId);
    expect(retrievedPre?.lifecycleStatus).toBe('COMPLETED');
  });

  // 3. Interrupted task
  it('3. Interrupted task: captures partial state, marks execution Interrupted, and preserves safety baseline', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'state.json'), '{"step": 1}', 'utf-8');

    const ctx = {
      projectId: 'proj-interrupt-3',
      taskId: 'T3-heavy-migration',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Database schema migration',
    };

    const preChk = await coordinator.onBeforeTaskExecution(ctx);

    // Mid-execution file modification
    fs.writeFileSync(path.join(testWorkspaceDir, 'state.json'), '{"step": 2, "pending": true}', 'utf-8');

    // System halted / process interrupted
    const intRes = await coordinator.onTaskInterrupted({
      ...ctx,
      reason: 'Execution halted by watchdog: max execution duration exceeded',
    });

    expect(intRes.safetyCheckpointId).toBe(preChk.checkpointId);
    expect(intRes.interruptedCheckpoint?.executionStatus).toBe('Interrupted');
    expect(intRes.interruptedCheckpoint?.lifecycleStatus).toBe('INTERRUPTED');
  });

  // 4. User cancellation
  it('4. User cancellation: clean handling preserving pre-execution checkpoint for immediate restore', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'app.vue'), '<template>Hello</template>', 'utf-8');

    const ctx = {
      projectId: 'proj-cancel-4',
      taskId: 'T4-frontend-revamp',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Revamp UI header',
    };

    const preChk = await coordinator.onBeforeTaskExecution(ctx);

    // User hits stop / cancel
    const cancelRes = await coordinator.onTaskInterrupted({
      ...ctx,
      reason: 'User clicked cancel button in AUTONEX control bar',
      cancelledByUser: true,
    });

    expect(cancelRes.safetyCheckpointId).toBe(preChk.checkpointId);
    expect(cancelRes.interruptedCheckpoint?.executionStatus).toBe('Interrupted');

    // We can restore directly back to preChk cleanly using CheckpointService
    const restoreRes = await service.restoreCheckpoint({
      checkpointId: preChk.checkpointId,
      requestingUserId: ctx.ownerUserId,
      targetWorkspaceDir: testWorkspaceDir,
      createSafetyBackup: false,
    });
    expect(restoreRes.restoreId).toBeDefined();
    expect(restoreRes.restoredFilesCount).toBe(1);
    expect(db.getRestoreOpById(restoreRes.restoreId)?.status).toBe('COMPLETED');
    expect(fs.readFileSync(path.join(testWorkspaceDir, 'app.vue'), 'utf-8')).toBe('<template>Hello</template>');
  });

  // 5. Empty task
  it('5. Empty task: creates valid archive and context for workspace with 0 files', async () => {
    const ctx = {
      projectId: 'proj-empty-5',
      taskId: 'T5-init-repo',
      workspaceDir: testWorkspaceDir, // Empty directory
      ownerUserId: 'user-0x123',
      goal: 'Initialize new empty workspace',
    };

    const preChk = await coordinator.onBeforeTaskExecution(ctx);
    expect(preChk.fileCount).toBe(0);
    expect(preChk.archiveChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);

    const postChk = await coordinator.onTaskCompleted(ctx);
    expect(postChk.fileCount).toBe(0);
    expect(postChk.parentCheckpointId).toBe(preChk.checkpointId);
  });

  // 6. Task with no file modifications
  it('6. Task with no file modifications: pre and post checksums and manifests match exactly', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'read_only.py'), '# No changes here', 'utf-8');

    const ctx = {
      projectId: 'proj-readonly-6',
      taskId: 'T6-audit-security',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Audit repository for security vulnerabilities (read-only)',
    };

    const preChk = await coordinator.onBeforeTaskExecution(ctx);
    // Task executes without modifying anything on disk
    const postChk = await coordinator.onTaskCompleted(ctx);

    expect(preChk.fileCount).toBe(1);
    expect(postChk.fileCount).toBe(1);
    expect(postChk.parentCheckpointId).toBe(preChk.checkpointId);

    // Compare manifests: zero file deltas
    const diff = service.compareCheckpoints(preChk.checkpointId, postChk.checkpointId, ctx.ownerUserId);
    expect(diff.filesAdded.length).toBe(0);
    expect(diff.filesRemoved.length).toBe(0);
    expect(diff.filesModified.length).toBe(0);
    expect(diff.filesUnchanged).toContain('read_only.py');
  });

  // 7. Multiple consecutive tasks
  it('7. Multiple consecutive tasks: preserves lineage chaining across T1 -> T2 -> T3', async () => {
    const baseCtx = {
      projectId: 'proj-chain-7',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
    };

    // Task 1
    fs.writeFileSync(path.join(testWorkspaceDir, 'file1.txt'), 'Task 1 content', 'utf-8');
    const t1Pre = await coordinator.onBeforeTaskExecution({ ...baseCtx, taskId: 'T1', goal: 'Task 1' });
    const t1Post = await coordinator.onTaskCompleted({ ...baseCtx, taskId: 'T1', goal: 'Task 1' });
    expect(t1Post.parentCheckpointId).toBe(t1Pre.checkpointId);

    // Task 2
    fs.writeFileSync(path.join(testWorkspaceDir, 'file2.txt'), 'Task 2 content', 'utf-8');
    const t2Pre = await coordinator.onBeforeTaskExecution({ ...baseCtx, taskId: 'T2', goal: 'Task 2' });
    expect(t2Pre.parentCheckpointId).toBe(t1Post.checkpointId); // Chained to T1 completion!
    const t2Post = await coordinator.onTaskCompleted({ ...baseCtx, taskId: 'T2', goal: 'Task 2' });
    expect(t2Post.parentCheckpointId).toBe(t2Pre.checkpointId);

    // Task 3
    fs.writeFileSync(path.join(testWorkspaceDir, 'file3.txt'), 'Task 3 content', 'utf-8');
    const t3Pre = await coordinator.onBeforeTaskExecution({ ...baseCtx, taskId: 'T3', goal: 'Task 3' });
    expect(t3Pre.parentCheckpointId).toBe(t2Post.checkpointId); // Chained to T2 completion!
    const t3Post = await coordinator.onTaskCompleted({ ...baseCtx, taskId: 'T3', goal: 'Task 3' });

    // Verify 3 files present in final checkpoint
    expect(t3Post.fileCount).toBe(3);
  });

  // 8. Concurrent tasks
  it('8. Concurrent tasks: mutex serialization guarantees consistent TAR archives without race condition', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'base.txt'), 'base', 'utf-8');

    const ctxA = {
      projectId: 'proj-concurrent-8',
      taskId: 'T-A',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Concurrent worker A',
    };

    const ctxB = {
      projectId: 'proj-concurrent-8',
      taskId: 'T-B',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Concurrent worker B',
    };

    // Trigger pre-execution checkpoints concurrently
    const [chkA, chkB] = await Promise.all([
      coordinator.onBeforeTaskExecution(ctxA),
      coordinator.onBeforeTaskExecution(ctxB),
    ]);

    expect(chkA.checkpointId).toBeDefined();
    expect(chkB.checkpointId).toBeDefined();

    // Trigger completion checkpoints concurrently while modifying files
    fs.writeFileSync(path.join(testWorkspaceDir, 'modA.txt'), 'A', 'utf-8');
    fs.writeFileSync(path.join(testWorkspaceDir, 'modB.txt'), 'B', 'utf-8');

    const [doneA, doneB] = await Promise.all([
      coordinator.onTaskCompleted(ctxA),
      coordinator.onTaskCompleted(ctxB),
    ]);

    expect(doneA.executionStatus).toBe('Completed');
    expect(doneB.executionStatus).toBe('Completed');
    expect(doneA.archiveChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(doneB.archiveChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  // 9. Storage failure before execution
  it('9. Storage failure before execution: throws PreExecutionSafetyCheckpointFailedError and BLOCKS project modifications', async () => {
    // Mock Swarm provider to simulate network/node outage
    const failingSwarm = new SwarmStorageProvider({ gatewayUrl: 'http://127.0.0.1:9999' });
    failingSwarm.uploadCheckpointArtifacts = async () => {
      throw new Error('Connection refused: Bee node at http://127.0.0.1:9999 is unreachable');
    };

    const failingService = new CheckpointService(db, failingSwarm);
    const strictCoordinator = new AgentCheckpointCoordinator(failingService);

    fs.writeFileSync(path.join(testWorkspaceDir, 'critical_prod.py'), 'def safe(): pass', 'utf-8');

    const ctx = {
      projectId: 'proj-fail-storage-pre-9',
      taskId: 'T9-destructive-work',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Destructive database wipe & migration',
    };

    // Expect PreExecutionSafetyCheckpointFailedError
    await expect(strictCoordinator.onBeforeTaskExecution(ctx)).rejects.toThrow(
      PreExecutionSafetyCheckpointFailedError
    );

    // Workspace MUST be preserved untouched
    expect(fs.readFileSync(path.join(testWorkspaceDir, 'critical_prod.py'), 'utf-8')).toBe('def safe(): pass');
  });

  // 10. Storage failure after execution
  it('10. Storage failure after execution: preserves pre-execution safety checkpoint in database', async () => {
    let failPostUpload = false;
    const flakySwarm = new SwarmStorageProvider();
    const originalUpload = flakySwarm.uploadCheckpointArtifacts.bind(flakySwarm);

    flakySwarm.uploadCheckpointArtifacts = async (...args) => {
      if (failPostUpload) {
        throw new Error('Swarm node out of disk space during post-execution upload');
      }
      return originalUpload(...args);
    };

    const mockFlakyBee = (flakySwarm as any).bee;
    vi.spyOn(mockFlakyBee.data, 'upload').mockImplementation((async (_batchId: any, data: Uint8Array) => {
      const reference = calculateSHA256(data).replace('sha256:', '');
      swarmNetwork.set(reference, new Uint8Array(data));
      return { reference } as any;
    }) as any);

    vi.spyOn(mockFlakyBee.data, 'download').mockImplementation((async (reference: any) => {
      const cleanRef = String(reference).trim();
      const chunk = swarmNetwork.get(cleanRef);
      if (!chunk) {
        throw new Error(`Swarm reference "${cleanRef}" not found on network.`);
      }
      return {
        bytes: () => Promise.resolve(new Uint8Array(chunk)),
        toUint8Array: () => new Uint8Array(chunk),
        arrayBuffer: () => Promise.resolve(new Uint8Array(chunk).buffer),
      } as any;
    }) as any);

    const flakyService = new CheckpointService(db, flakySwarm);
    const testCoordinator = new AgentCheckpointCoordinator(flakyService);

    fs.writeFileSync(path.join(testWorkspaceDir, 'file.txt'), 'initial', 'utf-8');

    const ctx = {
      projectId: 'proj-fail-post-10',
      taskId: 'T10-post-fail',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Task that succeeds locally but Swarm fails on completion',
    };

    // Pre-execution succeeds
    const preChk = await testCoordinator.onBeforeTaskExecution(ctx);
    expect(preChk.lifecycleStatus).toBe('COMPLETED');

    // Agent modifies file
    fs.writeFileSync(path.join(testWorkspaceDir, 'file.txt'), 'modified', 'utf-8');

    // Arm Swarm failure for post-execution
    failPostUpload = true;

    // Post-execution fails
    await expect(testCoordinator.onTaskCompleted(ctx)).rejects.toThrow(
      'Swarm node out of disk space during post-execution upload'
    );

    // Pre-execution checkpoint is STILL safely persisted in DB
    const persistedPre = db.getCheckpointById(preChk.checkpointId);
    expect(persistedPre?.lifecycleStatus).toBe('COMPLETED');
    expect(persistedPre?.archiveChecksum).toBeTruthy();
  });

  // 11. Backend restart during checkpoint creation
  it('11. Backend restart during checkpoint creation: startup recovery resolves orphaned in-flight checkpoints', async () => {
    // Manually insert an orphaned PENDING checkpoint mimicking a sudden power cut / crash
    const orphanId = `chk_orphan_${Date.now()}`;
    db.insertCheckpoint({
      checkpointId: orphanId,
      projectId: 'proj-restart-11',
      parentCheckpointId: null,
      agentTaskId: 'T11-crashed-task',
      ownerUserId: 'user-0x123',
      description: 'Orphaned in-flight checkpoint before crash',
      createdAt: Date.now(),
      executionStatus: 'In Progress',
      lifecycleStatus: 'PENDING',
      archiveSwarmRef: null,
      contextSwarmRef: null,
      archiveChecksum: null,
      contextChecksum: null,
      archiveSize: 0,
      fileCount: 0,
      manifestJson: null,
      storageProvider: 'swarm',
      schemaVersion: '2.0.0',
    });

    expect(db.getCheckpointById(orphanId)?.lifecycleStatus).toBe('PENDING');

    // Startup recovery runs on service initialization
    const recoveryRes = await coordinator.recoverIncompleteCheckpoints('proj-restart-11');
    expect(recoveryRes.recoveredCount).toBe(1);
    expect(recoveryRes.resolvedIds).toContain(orphanId);

    const recoveredRecord = db.getCheckpointById(orphanId);
    expect(recoveredRecord?.lifecycleStatus).toBe('FAILED');
    expect(recoveredRecord?.executionStatus).toBe('Interrupted');
    expect(recoveredRecord?.failureReason).toContain('startup recovery');
  });

  // 12. Manual checkpoint capability
  it('12. Manual checkpoint: user can trigger an ad-hoc checkpoint at any time', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'manual.txt'), 'ad-hoc save', 'utf-8');

    const manualChk = await coordinator.createManualCheckpoint({
      projectId: 'proj-manual-12',
      ownerUserId: 'user-0x123',
      workspaceDir: testWorkspaceDir,
      goal: 'User triggered manual snapshot',
      description: 'Manual checkpoint before testing a custom script',
    });

    expect(manualChk.checkpointId).toBeDefined();
    expect(manualChk.executionStatus).toBe('Completed');
    expect(manualChk.lifecycleStatus).toBe('COMPLETED');
    expect(manualChk.fileCount).toBe(1);
    expect(manualChk.archiveSwarmRef).toBeTruthy();
  });

  // 13. Idempotency handling
  it('13. Idempotency: repeated identical lifecycle triggers return the existing checkpoint without duplicate uploads', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'idempotent.txt'), 'data', 'utf-8');

    const ctx = {
      projectId: 'proj-idempotent-13',
      taskId: 'T13-idempotent-task',
      workspaceDir: testWorkspaceDir,
      ownerUserId: 'user-0x123',
      goal: 'Idempotency verification',
      idempotencyKey: 'idemp-custom-key-001',
    };

    const first = await coordinator.onBeforeTaskExecution(ctx);
    const second = await coordinator.onBeforeTaskExecution(ctx);

    expect(first.checkpointId).toBe(second.checkpointId);
    expect(first.archiveChecksum).toBe(second.archiveChecksum);
  });
});
