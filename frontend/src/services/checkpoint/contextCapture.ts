/**
 * AUTONEX Checkpoint Engine: AI Context Capture (Phase 4)
 *
 * Captures, sanitizes, and canonicalizes the multi-agent execution context
 * corresponding to the exact current codebase snapshot.
 */

import type { BlackboardNote, Task } from '@/api/types';
import type { AgentUI } from '@/state/store';
import {
  type CheckpointContextV2,
  type ContextPayload,
  type ContextTaskItem,
  type ContextAgentState,
  type FileChangeRecord,
  type CaptureContextOptions,
  type EncryptedContextPayload,
} from './contextTypes';
import { calculateSHA256, encryptPayload } from './crypto';
import { deriveProjectName, determineCheckpointStatus } from '../checkpointSummary';

/**
 * Redacts secrets, private keys, and API keys to prevent credential leakage.
 */
export function sanitizeContextText(text: string): string {
  if (!text) return '';

  return text
    // 1. Redact 64-character Ethereum private keys (0x + 64 hex)
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, '[REDACTED_PRIVATE_KEY]')
    // 2. Redact 0G and OpenAI API keys
    .replace(/0g-[a-zA-Z0-9]{16,}/gi, '[REDACTED_0G_KEY]')
    .replace(/sk-[a-zA-Z0-9]{20,}/gi, '[REDACTED_API_KEY]')
    .replace(/bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, 'Bearer [REDACTED_TOKEN]')
    // 3. Redact passwords in prose or config
    .replace(/\b(password|passwd|pwd)\s*(?:was|is|:|=)\s*['"]?[^\s,'"]+['"]?/gi, '$1=[REDACTED_PASSWORD]')
    // 4. Redact environment variable assignments (if not already redacted)
    .replace(/(PRIVATE_KEY|API_KEY|SECRET_KEY|TOKEN)\s*[:=]\s*['"]?(?!\[REDACTED)[^\s'"]+['"]?/gi, '$1=[REDACTED]');
}

/**
 * Sanitizes a blackboard note.
 */
function sanitizeNote(note: BlackboardNote): BlackboardNote {
  const noteText = String((note as any).text || note.note || '');
  const topic = String(note.topic || '');
  const sanitizedText = sanitizeContextText(noteText);
  return {
    ...note,
    note: sanitizedText,
    ...( (note as any).text !== undefined ? { text: sanitizedText } : {} ),
    topic: sanitizeContextText(topic),
  };
}

/**
 * Captures the complete AI context snapshot from the application state.
 */
export function captureAIContext(
  state: any,
  options: CaptureContextOptions
): CheckpointContextV2 {
  const goal = state.goal || 'AUTONEX Engineering Objective';
  const projectName = deriveProjectName(goal);
  const tasks: Record<string, Task> = state.tasks || {};
  const agents: Record<string, AgentUI> = state.agents || {};
  const notes: BlackboardNote[] = (state.notes || []).map(sanitizeNote);
  const fileEdits = state.fileEdits || {};
  const executionState = state.executionState || 'running';
  const paused = Boolean(state.paused);

  // 1. Task classification
  const taskList = Object.values(tasks);
  const completedTasks: ContextTaskItem[] = [];
  const inProgressTasks: ContextTaskItem[] = [];
  const pendingTasks: ContextTaskItem[] = [];

  let activeTaskId: string | null = options.currentTaskId || null;
  let activeTaskDescription: string | null = null;

  for (const t of taskList) {
    const rawStatus = (t.status || 'pending') as ContextTaskItem['status'];
    const item: ContextTaskItem = {
      id: String(t.id),
      description: sanitizeContextText(String(t.description || '')),
      assignedAgentId: t.assigned_agent || null,
      assignedAgentName: t.assigned_agent && agents[t.assigned_agent] ? agents[t.assigned_agent].name : undefined,
      status: rawStatus,
      progressPct: Number(t.progress_pct ?? (t as any).progress ?? 0),
      resultPreview: (t as any).result_preview ? sanitizeContextText(String((t as any).result_preview)) : undefined,
      dependencies: Array.isArray(t.depends_on) ? t.depends_on : (Array.isArray((t as any).dependencies) ? (t as any).dependencies : []),
      department: (t as any).department ? String((t as any).department) : undefined,
    };

    if (item.status === 'done') {
      completedTasks.push(item);
    } else if (item.status === 'running' || item.status === 'ready') {
      inProgressTasks.push(item);
      if (!activeTaskId && item.status === 'running') {
        activeTaskId = item.id;
        activeTaskDescription = item.description;
      }
    } else {
      pendingTasks.push(item);
    }
  }

  if (activeTaskId && !activeTaskDescription && tasks[activeTaskId]) {
    activeTaskDescription = sanitizeContextText(String(tasks[activeTaskId].description || ''));
  }

  // 2. Architectural & Agent Decisions
  const architectureDecisions: string[] = [];
  const agentDecisions: string[] = [];
  for (const n of notes) {
    const noteText = String((n as any).text || n.note || '');
    const topic = String(n.topic || '');
    if (/arch|decision|design|pattern|structure|stack|framework/i.test(topic + ' ' + noteText)) {
      architectureDecisions.push(`[${topic || 'Arch'}] ${noteText}`);
    } else if (/pinned|approved|verified|selected|consensus/i.test(noteText)) {
      agentDecisions.push(noteText);
    }
  }

  // 3. File Inventory tracking
  const filesCreatedSet = new Set<string>();
  const filesModifiedSet = new Set<string>();
  const filesDeletedSet = new Set<string>();
  const recentFileChanges: FileChangeRecord[] = [];

  for (const [path, edits] of Object.entries(fileEdits)) {
    filesModifiedSet.add(path);
    if (Array.isArray(edits)) {
      for (const edit of edits as any[]) {
        recentFileChanges.push({
          path,
          type: 'modified',
          linesChanged: edit.line_ranges ? edit.line_ranges.length : undefined,
          timestamp: edit.ts || new Date().toISOString(),
          editorAgent: edit.branch,
        });
      }
    }
  }

  // Also extract files pinned in blackboard notes
  for (const n of notes) {
    const noteText = String((n as any).text || n.note || '');
    const fileMatch = noteText.match(/(?:created|written|saved|output to)\s+([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9]+)/i);
    if (fileMatch && fileMatch[1]) {
      const p = fileMatch[1].trim();
      filesCreatedSet.add(p);
    }
  }

  // 4. Agent roster
  const agentRoster: Record<string, ContextAgentState> = {};
  for (const [id, a] of Object.entries(agents)) {
    agentRoster[id] = {
      id: a.id,
      name: a.name,
      role: a.role,
      department: a.department || null,
      status: a.status,
      currentTaskId: a.current_task_id || null,
      energy: a.energy || 100,
      contextTokens: a.context_tokens || 0,
      contextMax: a.context_max || 1000000,
      tasksCompleted: a.done || 0,
      tasksFailed: a.failed || 0,
      keyDecisions: [],
    };
  }

  // 5. User requirements
  const userRequirements: string[] = options.customRequirements || [
    `Goal: ${sanitizeContextText(goal)}`,
    'Preserve codebase integrity across checkpoint restorations.',
    'Execute real Ethereum Swarm and Arkiv Rabdi persistence.',
  ];

  // 6. Next recommended actions & Agent continuation instructions
  const nextRecommendedActions: string[] = [];
  if (inProgressTasks.length > 0) {
    nextRecommendedActions.push(`Resume in-flight task ${inProgressTasks[0].id}: ${inProgressTasks[0].description}`);
  } else if (pendingTasks.length > 0) {
    nextRecommendedActions.push(`Begin pending task ${pendingTasks[0].id}: ${pendingTasks[0].description}`);
  } else {
    nextRecommendedActions.push('All planned DAG tasks complete. Ready for validation and delivery.');
  }

  let continuationInstructions = options.customContinuationInstructions || '';
  if (!continuationInstructions) {
    continuationInstructions = `Active Checkpoint: ${options.checkpointId} for ${projectName}.\n` +
      `Current Objective: ${goal}\n` +
      `Completed Tasks: ${completedTasks.map((t) => t.id).join(', ') || 'None'}\n` +
      `Current In-Flight: ${activeTaskId ? `${activeTaskId} (${activeTaskDescription})` : 'None'}\n` +
      `Pending: ${pendingTasks.map((t) => t.id).join(', ') || 'None'}\n` +
      `Instructions for Resuming Agent: Inspect restored workspace, verify test pass, and proceed with ${nextRecommendedActions[0] || 'remaining milestones'}.`;
  }
  continuationInstructions = sanitizeContextText(continuationInstructions);

  const executionStatus = determineCheckpointStatus(state.report || null, executionState, paused, tasks);

  const payload: ContextPayload = {
    projectIdentity: {
      projectId: options.projectId,
      projectName,
      goal: sanitizeContextText(goal),
      outputDirectory: `D:\\AUTONEX\\output\\${projectName}`,
    },
    currentObjective: sanitizeContextText(goal),
    userRequirements,
    currentTaskId: activeTaskId,
    currentTaskDescription: activeTaskDescription,
    completedTasks,
    inProgressTasks,
    pendingTasks,
    allTasks: tasks,
    taskEdges: state.edges || [],
    architectureDecisions,
    agentDecisions,
    filesCreated: Array.from(filesCreatedSet),
    filesModified: Array.from(filesModifiedSet),
    filesDeleted: Array.from(filesDeletedSet),
    recentFileChanges,
    executionStatus,
    executionState,
    simClock: state.simClock || '00:00:00',
    realElapsedSeconds: state.realElapsed || 0,
    logicalElapsedSeconds: state.effortLogical || 0,
    replanCount: state.replanCount || 0,
    agentRoster,
    conversationSummary: `Project ${projectName}: ${completedTasks.length} done, ${inProgressTasks.length} running, ${pendingTasks.length} pending.`,
    blackboardNotes: notes,
    nextRecommendedActions,
    agentContinuationInstructions: continuationInstructions,
    eventReplayTape: options.includeReplayTape ? state.runEvents : undefined,
  };

  // Compute canonical SHA-256 checksum of payload JSON
  const canonicalJson = JSON.stringify(payload);
  const contextChecksum = calculateSHA256(canonicalJson);

  return {
    checkpointId: options.checkpointId,
    projectId: options.projectId,
    schemaVersion: '2.0.0',
    createdAt: new Date().toISOString(),
    agentTaskId: activeTaskId,
    parentCheckpointId: options.parentCheckpointId || null,
    payload,
    contextChecksum,
  };
}

/**
 * Serializes, encodes, and encrypts the context snapshot into a binary payload.
 */
export function serializeAndEncryptContext(
  context: CheckpointContextV2,
  encryptionKey: Buffer | Uint8Array | string
): EncryptedContextPayload {
  const jsonStr = JSON.stringify(context);
  const utf8Bytes = Buffer.from(jsonStr, 'utf-8');
  const encrypted = encryptPayload(utf8Bytes, encryptionKey);

  return {
    checkpointId: context.checkpointId,
    projectId: context.projectId,
    ciphertext: encrypted.ciphertext,
    ivHex: encrypted.iv,
    authTagHex: encrypted.authTag,
    contextChecksum: context.contextChecksum,
    rawByteSize: utf8Bytes.byteLength,
    encryptedByteSize: encrypted.ciphertext.byteLength,
    schemaVersion: context.schemaVersion,
    createdAt: context.createdAt,
  };
}
