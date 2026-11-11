/**
 * AUTONEX Checkpoint Engine: Automatic Agent Execution Checkpointing (Phase 7)
 *
 * Integrates AUTONEX_CHECKPOINT_ENGINE directly into the AI agent lifecycle.
 *
 * Responsibilities:
 * 1. Pre-execution Safety: Captures workspace & context before destructive modifications.
 *    Enforces execution block if pre-execution safety checkpoint fails.
 * 2. Successful Completion: Captures verified workspace & context after file writes finish.
 * 3. Failed Execution: Captures partial workspace + failure context, records FAILED, preserves recovery checkpoint.
 * 4. Interrupted Execution: Handles cancellation / shutdown, records INTERRUPTED, preserves safety baseline.
 * 5. Concurrency & Idempotency: Mutex-guarded workspace snapshots and event deduplication.
 * 6. Credit Independence: Works completely independently of iAI / 0G compute credits.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CheckpointService,
  type CreateCheckpointParams,
} from './checkpointService';
import {
  CheckpointDatabase,
  type CheckpointRecord,
  type CheckpointExecutionStatus,
  type CheckpointLifecycleStatus,
} from './checkpointDb';

export type StoreState = Record<string, any>;

export interface AgentTaskExecutionContext {
  projectId: string;
  taskId: string;
  agentId?: string;
  workspaceDir: string;
  ownerUserId: string;
  goal: string;
  stateSnapshot?: Partial<StoreState> | any;
  encryptionKey?: Buffer | Uint8Array | string;
  postageBatchId?: string;
  customExclusions?: string[];
  idempotencyKey?: string;
  description?: string;
}

export interface TaskFailureContext extends AgentTaskExecutionContext {
  error: Error | string;
  failedAgentId?: string;
}

export interface TaskInterruptedContext extends AgentTaskExecutionContext {
  reason: string;
  cancelledByUser?: boolean;
}

export interface ManualCheckpointContext {
  projectId: string;
  ownerUserId: string;
  workspaceDir: string;
  goal: string;
  description: string;
  stateSnapshot?: Partial<StoreState> | any;
  encryptionKey?: Buffer | Uint8Array | string;
  postageBatchId?: string;
  idempotencyKey?: string;
}

export class PreExecutionSafetyCheckpointFailedError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`[AUTONEX PRE-EXECUTION GATE] Destructive project modifications BLOCKED: ${message}`);
    this.name = 'PreExecutionSafetyCheckpointFailedError';
  }
}

/**
 * Manages active file write locks per workspace to ensure snapshot consistency.
 */
class WorkspaceWriteTracker {
  private activeWrites = new Map<string, Set<string>>(); // workspaceDir -> Set<taskId>
  private lastWriteTimestamps = new Map<string, number>(); // workspaceDir -> timestamp

  public acquire(workspaceDir: string, taskId: string): void {
    const canonical = path.resolve(workspaceDir);
    if (!this.activeWrites.has(canonical)) {
      this.activeWrites.set(canonical, new Set());
    }
    this.activeWrites.get(canonical)!.add(taskId);
    this.lastWriteTimestamps.set(canonical, Date.now());
  }

  public release(workspaceDir: string, taskId: string): void {
    const canonical = path.resolve(workspaceDir);
    const set = this.activeWrites.get(canonical);
    if (set) {
      set.delete(taskId);
      if (set.size === 0) {
        this.activeWrites.delete(canonical);
      }
    }
    this.lastWriteTimestamps.set(canonical, Date.now());
  }

  public isWriting(workspaceDir: string): boolean {
    const canonical = path.resolve(workspaceDir);
    const set = this.activeWrites.get(canonical);
    return Boolean(set && set.size > 0);
  }

  public async awaitSettled(workspaceDir: string, quietWindowMs = 30, timeoutMs = 3000): Promise<void> {
    const canonical = path.resolve(workspaceDir);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const active = this.activeWrites.get(canonical);
      if (!active || active.size === 0) {
        const lastWrite = this.lastWriteTimestamps.get(canonical) || 0;
        if (Date.now() - lastWrite >= quietWindowMs) {
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

export class AgentCheckpointCoordinator {
  private service: CheckpointService;
  private writeTracker = new WorkspaceWriteTracker();
  private workspaceMutexes = new Map<string, Promise<any>>(); // workspaceDir -> promise chain

  // Project Lineage & Safety Baseline Tracking
  private activeTaskSafetyBaselines = new Map<string, string>(); // taskId -> preExecutionCheckpointId
  private projectLatestCheckpoint = new Map<string, string>(); // projectId -> latestCheckpointId

  // Idempotency Registry: key -> CheckpointRecord
  private idempotencyRegistry = new Map<string, CheckpointRecord>();

  constructor(service?: CheckpointService) {
    this.service = service || new CheckpointService();
  }

  public getService(): CheckpointService {
    return this.service;
  }

  public getDatabase(): CheckpointDatabase {
    return this.service.getDatabase();
  }

  /**
   * Acquire a write lock when an agent starts writing/modifying files in workspace.
   */
  public acquireWriteLock(workspaceDir: string, taskId: string): () => void {
    this.writeTracker.acquire(workspaceDir, taskId);
    return () => this.writeTracker.release(workspaceDir, taskId);
  }

  /**
   * Release write lock manually if not using the returned cleanup callback.
   */
  public releaseWriteLock(workspaceDir: string, taskId: string): void {
    this.writeTracker.release(workspaceDir, taskId);
  }

  /**
   * Serializes snapshot capture per workspace directory to eliminate race conditions
   * and partial TAR reads across concurrent agent tasks.
   */
  private async withWorkspaceSnapshotLock<T>(workspaceDir: string, action: () => Promise<T>): Promise<T> {
    const canonical = path.resolve(workspaceDir);
    const currentPromise = this.workspaceMutexes.get(canonical) || Promise.resolve();

    let releaseAction: () => void;
    const nextPromise = new Promise<void>((resolve) => {
      releaseAction = resolve;
    });

    this.workspaceMutexes.set(canonical, currentPromise.then(() => nextPromise));

    try {
      await currentPromise;
      await this.writeTracker.awaitSettled(canonical);
      return await action();
    } finally {
      releaseAction!();
      if (this.workspaceMutexes.get(canonical) === nextPromise) {
        this.workspaceMutexes.delete(canonical);
      }
    }
  }

  /**
   * TRIGGER 1: Before Execution Safety Checkpoint
   *
   * Must be called before an agent performs destructive project modifications.
   * If Swarm or local capture fails, throws PreExecutionSafetyCheckpointFailedError
   * and BLOCKS execution.
   */
  public async onBeforeTaskExecution(ctx: AgentTaskExecutionContext): Promise<CheckpointRecord> {
    const idempotencyKey = ctx.idempotencyKey || `pre:${ctx.projectId}:${ctx.taskId}`;
    if (this.idempotencyRegistry.has(idempotencyKey)) {
      return this.idempotencyRegistry.get(idempotencyKey)!;
    }

    return this.withWorkspaceSnapshotLock(ctx.workspaceDir, async () => {
      // Re-check idempotency inside lock
      if (this.idempotencyRegistry.has(idempotencyKey)) {
        return this.idempotencyRegistry.get(idempotencyKey)!;
      }

      const parentCheckpointId = this.projectLatestCheckpoint.get(ctx.projectId) || null;
      const description = ctx.description || `Pre-execution safety baseline for task ${ctx.taskId} (${ctx.goal})`;

      try {
        const preCheckpoint = await this.service.createCheckpoint({
          projectId: ctx.projectId,
          ownerUserId: ctx.ownerUserId,
          workspaceDir: ctx.workspaceDir,
          goal: ctx.goal,
          parentCheckpointId,
          agentTaskId: ctx.taskId,
          description,
          executionStatus: 'In Progress',
          targetLifecycleStatus: 'COMPLETED',
          encryptionKey: ctx.encryptionKey,
          postageBatchId: ctx.postageBatchId,
          stateSnapshot: ctx.stateSnapshot,
        });

        // Track safety baseline for rollback/recovery
        this.activeTaskSafetyBaselines.set(ctx.taskId, preCheckpoint.checkpointId);
        this.projectLatestCheckpoint.set(ctx.projectId, preCheckpoint.checkpointId);
        this.idempotencyRegistry.set(idempotencyKey, preCheckpoint);

        return preCheckpoint;
      } catch (err: any) {
        throw new PreExecutionSafetyCheckpointFailedError(
          `Pre-execution checkpoint failed for task "${ctx.taskId}". Aborting execution to prevent unrecoverable workspace modifications. Reason: ${err?.message}`,
          err
        );
      }
    });
  }

  /**
   * TRIGGER 2: Successful Completion Checkpoint
   *
   * Captured after agent task completes and all file writes have settled.
   * Chained to the pre-execution safety checkpoint.
   */
  public async onTaskCompleted(ctx: AgentTaskExecutionContext): Promise<CheckpointRecord> {
    const idempotencyKey = ctx.idempotencyKey || `post:${ctx.projectId}:${ctx.taskId}`;
    if (this.idempotencyRegistry.has(idempotencyKey)) {
      return this.idempotencyRegistry.get(idempotencyKey)!;
    }

    return this.withWorkspaceSnapshotLock(ctx.workspaceDir, async () => {
      if (this.idempotencyRegistry.has(idempotencyKey)) {
        return this.idempotencyRegistry.get(idempotencyKey)!;
      }

      const parentCheckpointId =
        this.activeTaskSafetyBaselines.get(ctx.taskId) ||
        this.projectLatestCheckpoint.get(ctx.projectId) ||
        null;

      const description = ctx.description || `Completed checkpoint for task ${ctx.taskId}`;

      const postCheckpoint = await this.service.createCheckpoint({
        projectId: ctx.projectId,
        ownerUserId: ctx.ownerUserId,
        workspaceDir: ctx.workspaceDir,
        goal: ctx.goal,
        parentCheckpointId,
        agentTaskId: ctx.taskId,
        description,
        executionStatus: 'Completed',
        targetLifecycleStatus: 'COMPLETED',
        encryptionKey: ctx.encryptionKey,
        postageBatchId: ctx.postageBatchId,
        stateSnapshot: ctx.stateSnapshot,
      });

      this.projectLatestCheckpoint.set(ctx.projectId, postCheckpoint.checkpointId);
      this.activeTaskSafetyBaselines.delete(ctx.taskId);
      this.idempotencyRegistry.set(idempotencyKey, postCheckpoint);

      return postCheckpoint;
    });
  }

  /**
   * TRIGGER 3: Failed Execution Checkpoint
   *
   * Captures actual partial state, records FAILED, and preserves pre-execution checkpoint for recovery.
   */
  public async onTaskFailed(
    ctx: TaskFailureContext
  ): Promise<{ failureCheckpoint: CheckpointRecord | null; safetyCheckpointId: string | null }> {
    const idempotencyKey = ctx.idempotencyKey || `fail:${ctx.projectId}:${ctx.taskId}`;
    const safetyCheckpointId = this.activeTaskSafetyBaselines.get(ctx.taskId) || null;
    const errorMessage = typeof ctx.error === 'string' ? ctx.error : ctx.error?.message || 'Unknown error';

    return this.withWorkspaceSnapshotLock(ctx.workspaceDir, async () => {
      let failureCheckpoint: CheckpointRecord | null = null;

      try {
        failureCheckpoint = await this.service.createCheckpoint({
          projectId: ctx.projectId,
          ownerUserId: ctx.ownerUserId,
          workspaceDir: ctx.workspaceDir,
          goal: ctx.goal,
          parentCheckpointId: safetyCheckpointId,
          agentTaskId: ctx.taskId,
          description: `Failed execution for task ${ctx.taskId}: ${errorMessage}`,
          executionStatus: 'Failed',
          targetLifecycleStatus: 'FAILED',
          encryptionKey: ctx.encryptionKey,
          postageBatchId: ctx.postageBatchId,
          stateSnapshot: {
            ...ctx.stateSnapshot,
            executionError: errorMessage,
            failedAgentId: ctx.failedAgentId,
          },
        });

        this.idempotencyRegistry.set(idempotencyKey, failureCheckpoint);
      } catch (uploadErr) {
        console.error('[AgentCheckpointCoordinator] Failed to persist partial-state failure checkpoint:', uploadErr);
      }

      // Pre-execution checkpoint is explicitly preserved for recovery
      return {
        failureCheckpoint,
        safetyCheckpointId,
      };
    });
  }

  /**
   * TRIGGER 4: Interrupted Execution Checkpoint
   *
   * Captures partial state if safely accessible, records INTERRUPTED, and preserves safety checkpoint.
   */
  public async onTaskInterrupted(
    ctx: TaskInterruptedContext
  ): Promise<{ interruptedCheckpoint: CheckpointRecord | null; safetyCheckpointId: string | null }> {
    const idempotencyKey = ctx.idempotencyKey || `int:${ctx.projectId}:${ctx.taskId}`;
    const safetyCheckpointId = this.activeTaskSafetyBaselines.get(ctx.taskId) || null;

    return this.withWorkspaceSnapshotLock(ctx.workspaceDir, async () => {
      let interruptedCheckpoint: CheckpointRecord | null = null;

      try {
        interruptedCheckpoint = await this.service.createCheckpoint({
          projectId: ctx.projectId,
          ownerUserId: ctx.ownerUserId,
          workspaceDir: ctx.workspaceDir,
          goal: ctx.goal,
          parentCheckpointId: safetyCheckpointId,
          agentTaskId: ctx.taskId,
          description: `Interrupted execution for task ${ctx.taskId}: ${ctx.reason}`,
          executionStatus: 'Interrupted',
          targetLifecycleStatus: 'INTERRUPTED',
          encryptionKey: ctx.encryptionKey,
          postageBatchId: ctx.postageBatchId,
          stateSnapshot: {
            ...ctx.stateSnapshot,
            executionState: 'interrupted',
            interruptionReason: ctx.reason,
          },
        });

        this.idempotencyRegistry.set(idempotencyKey, interruptedCheckpoint);
      } catch (err) {
        console.error('[AgentCheckpointCoordinator] Failed to persist interrupted checkpoint:', err);
      }

      return {
        interruptedCheckpoint,
        safetyCheckpointId,
      };
    });
  }

  /**
   * MANUAL CHECKPOINT
   *
   * Allows user to trigger an ad-hoc checkpoint at any time.
   */
  public async createManualCheckpoint(ctx: ManualCheckpointContext): Promise<CheckpointRecord> {
    const idempotencyKey = ctx.idempotencyKey || `manual:${ctx.projectId}:${Date.now()}`;
    if (this.idempotencyRegistry.has(idempotencyKey)) {
      return this.idempotencyRegistry.get(idempotencyKey)!;
    }

    return this.withWorkspaceSnapshotLock(ctx.workspaceDir, async () => {
      const parentCheckpointId = this.projectLatestCheckpoint.get(ctx.projectId) || null;

      const manualCheckpoint = await this.service.createCheckpoint({
        projectId: ctx.projectId,
        ownerUserId: ctx.ownerUserId,
        workspaceDir: ctx.workspaceDir,
        goal: ctx.goal,
        parentCheckpointId,
        description: ctx.description || `Manual user checkpoint for ${ctx.projectId}`,
        executionStatus: 'Completed',
        targetLifecycleStatus: 'COMPLETED',
        encryptionKey: ctx.encryptionKey,
        postageBatchId: ctx.postageBatchId,
        stateSnapshot: ctx.stateSnapshot,
      });

      this.projectLatestCheckpoint.set(ctx.projectId, manualCheckpoint.checkpointId);
      this.idempotencyRegistry.set(idempotencyKey, manualCheckpoint);

      return manualCheckpoint;
    });
  }

  /**
   * STARTUP RECOVERY
   *
   * Recovers any incomplete checkpoint operations left from abnormal shutdown / restart.
   */
  public async recoverIncompleteCheckpoints(projectId?: string): Promise<{ recoveredCount: number; resolvedIds: string[] }> {
    const db = this.service.getDatabase();
    const incomplete = db.getIncompleteCheckpoints(projectId);
    const resolvedIds: string[] = [];

    for (const record of incomplete) {
      db.updateCheckpointLifecycle(record.checkpointId, 'FAILED', {
        executionStatus: 'Interrupted',
        failureReason: 'System process restarted while checkpoint was in-flight (startup recovery)',
      });
      resolvedIds.push(record.checkpointId);
    }

    return {
      recoveredCount: resolvedIds.length,
      resolvedIds,
    };
  }

  /**
   * Clear in-memory caches and active locks (for testing or reset).
   */
  public reset(): void {
    this.activeTaskSafetyBaselines.clear();
    this.projectLatestCheckpoint.clear();
    this.idempotencyRegistry.clear();
    this.workspaceMutexes.clear();
  }
}
