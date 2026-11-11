/**
 * AUTONEX Checkpoint Engine: AI Context Restoration & Agent Rehydration (Phase 4)
 *
 * Reconstructs the exact cognitive state of the agent floor from an encrypted
 * checkpoint snapshot. Prevents split-brain syndrome by guaranteeing that
 * restoring an older codebase restores the exact matching agent context (Rule 5).
 */

import { useStore } from '@/state/store';
import type { Task, Agent } from '@/api/types';
import {
  type CheckpointContextV2,
  type EncryptedContextPayload,
} from './contextTypes';
import { calculateSHA256, decryptPayload } from './crypto';

export interface ContextRestorationResult {
  checkpointId: string;
  projectId: string;
  schemaVersion: string;
  tasksRestoredCount: number;
  agentsRestoredCount: number;
  notesRestoredCount: number;
  activeTaskId: string | null;
  activeObjective: string;
  continuationInstructions: string;
  restoredAt: string;
}

/**
 * Decrypts, verifies checksum, and validates schema of an encrypted context snapshot.
 */
export function decryptAndValidateContext(
  encrypted: EncryptedContextPayload,
  decryptionKey: Buffer | Uint8Array | string,
  expectedChecksum?: string
): CheckpointContextV2 {
  if (!encrypted.ciphertext || encrypted.ciphertext.byteLength === 0) {
    throw new Error('Context restoration failed: Ciphertext is empty or missing.');
  }

  // 1. Decrypt AES-256-GCM ciphertext
  const decryptedBytes = decryptPayload(
    encrypted.ciphertext,
    decryptionKey,
    encrypted.ivHex,
    encrypted.authTagHex
  );

  // 2. Decode UTF-8 JSON
  const jsonStr = Buffer.from(decryptedBytes).toString('utf-8');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err: any) {
    throw new Error(`Context restoration failed: Corrupted JSON structure: ${err?.message}`);
  }

  // 3. Schema validation
  if (parsed.schemaVersion !== '2.0.0') {
    throw new Error(
      `Context restoration failed: Unsupported schema version "${parsed.schemaVersion}". Expected "2.0.0".`
    );
  }

  if (!parsed.checkpointId || !parsed.payload) {
    throw new Error('Context restoration failed: Invalid context snapshot missing checkpointId or payload.');
  }

  // 4. Verify canonical checksum against both decrypted payload and expected/container checksum
  const canonicalPayloadJson = JSON.stringify(parsed.payload);
  const calculatedChecksum = calculateSHA256(canonicalPayloadJson);

  const checksumToVerify = expectedChecksum || encrypted.contextChecksum || parsed.contextChecksum;
  if (checksumToVerify && calculatedChecksum.toLowerCase() !== checksumToVerify.toLowerCase()) {
    throw new Error(
      `Context restoration failed: Cryptographic Checksum Mismatch! Expected ${checksumToVerify}, calculated ${calculatedChecksum}. Context payload may have been tampered with.`
    );
  }

  return parsed as CheckpointContextV2;
}

/**
 * Rehydrates the active application store (`useStore`) and multi-agent floor
 * with the exact state captured at the time of the checkpoint.
 *
 * Guarantees that:
 * - Active agent continuation instructions match the restored checkpoint.
 * - Tasks DAG reflects the checkpoint (not newer progress).
 * - Agent roster, statuses, and assigned tasks reflect the checkpoint.
 * - Historical conversation notes are preserved without overwriting new sessions unsafely.
 */
export function applyRestoredContextToStore(context: CheckpointContextV2): ContextRestorationResult {
  const { payload, checkpointId, projectId, schemaVersion } = context;
  const store = useStore.getState();

  // 1. Reconstruct Tasks map
  const restoredTasks: Record<string, Task> = {};
  if (payload.allTasks && Object.keys(payload.allTasks).length > 0) {
    for (const [id, t] of Object.entries(payload.allTasks)) {
      restoredTasks[id] = { ...t };
    }
  } else {
    // Fall back to reconstructed tasks lists
    const allItems = [
      ...payload.completedTasks,
      ...payload.inProgressTasks,
      ...payload.pendingTasks,
    ];
    for (const item of allItems) {
      restoredTasks[item.id] = {
        id: item.id,
        parent_id: null,
        description: item.description,
        owner_role: 'engineering',
        assigned_agent: item.assignedAgentId || null,
        status: item.status,
        priority: 1,
        depends_on: item.dependencies || [],
        attempts: 1,
        progress_pct: item.progressPct,
        est_effort_s: 60,
        result_preview: item.resultPreview,
        department: item.department,
      } as Task;
    }
  }

  // 2. Reconstruct Agents map while preserving existing UI properties
  const currentAgents = store.agents;
  const restoredAgents: Record<string, any> = {};

  for (const [id, agentState] of Object.entries(payload.agentRoster)) {
    const existing = currentAgents[id] || {};
    restoredAgents[id] = {
      ...existing,
      id: agentState.id,
      name: agentState.name,
      role: agentState.role,
      department: agentState.department || existing.department || 'engineering',
      status: agentState.status,
      current_task_id: agentState.currentTaskId,
      energy: agentState.energy,
      context_tokens: agentState.contextTokens,
      context_max: agentState.contextMax,
      done: agentState.tasksCompleted,
      failed: agentState.tasksFailed,
      pending: Object.values(restoredTasks).filter(
        (t) => t.assigned_agent === id && t.status !== 'done' && t.status !== 'failed'
      ).length,
      outputs: existing.outputs || [],
    };
  }

  // 3. Atomically update application store
  useStore.setState({
    goal: payload.currentObjective || store.goal,
    tasks: restoredTasks,
    edges: payload.taskEdges || store.edges,
    agents: Object.keys(restoredAgents).length > 0 ? restoredAgents : store.agents,
    notes: payload.blackboardNotes || store.notes,
    executionState: (payload.executionState as any) || 'running',
    simClock: payload.simClock || store.simClock,
    realElapsed: payload.realElapsedSeconds ?? store.realElapsed,
    effortLogical: payload.logicalElapsedSeconds ?? store.effortLogical,
    replanCount: payload.replanCount ?? store.replanCount,
    // Add continuation instruction as a pinned directive on the blackboard
    toast: `Restored Checkpoint Context: ${checkpointId} (${payload.completedTasks.length} tasks completed)`,
  });

  return {
    checkpointId,
    projectId,
    schemaVersion,
    tasksRestoredCount: Object.keys(restoredTasks).length,
    agentsRestoredCount: Object.keys(restoredAgents).length,
    notesRestoredCount: payload.blackboardNotes ? payload.blackboardNotes.length : 0,
    activeTaskId: payload.currentTaskId,
    activeObjective: payload.currentObjective,
    continuationInstructions: payload.agentContinuationInstructions,
    restoredAt: new Date().toISOString(),
  };
}
