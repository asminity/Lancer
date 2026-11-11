/**
 * AUTONEX Checkpoint Engine: AI Context Snapshot Types (Version 2.0.0)
 *
 * Defines the schema for persistent, checkpoint-specific AI context snapshots.
 * Guarantees that restoring an older checkpoint restores the exact AI context
 * corresponding to that codebase state (Rule 5).
 */

import type { BlackboardNote, Envelope, Task } from '@/api/types';
import type { AgentUI } from '@/state/store';
import type { CheckpointStatus } from '../checkpointSummary';

export interface ContextTaskItem {
  id: string;
  description: string;
  assignedAgentId?: string | null;
  assignedAgentName?: string;
  status: 'done' | 'running' | 'ready' | 'pending' | 'failed' | 'waiting' | 'review';
  progressPct: number;
  resultPreview?: string;
  dependencies?: string[];
  department?: string;
}

export interface ContextAgentState {
  id: string;
  name: string;
  role: string;
  department?: string | null;
  status: string;
  currentTaskId: string | null;
  energy: number;
  contextTokens: number;
  contextMax: number;
  tasksCompleted: number;
  tasksFailed: number;
  keyDecisions: string[];
}

export interface FileChangeRecord {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  linesChanged?: number;
  timestamp: string;
  editorAgent?: string;
}

export interface ContextPayload {
  // 1. Project identity & Objective
  projectIdentity: {
    projectId: string;
    projectName: string;
    goal: string;
    outputDirectory: string;
  };
  currentObjective: string;
  userRequirements: string[];

  // 2. Task Execution State
  currentTaskId: string | null;
  currentTaskDescription: string | null;
  completedTasks: ContextTaskItem[];
  inProgressTasks: ContextTaskItem[];
  pendingTasks: ContextTaskItem[];
  allTasks: Record<string, Task>;
  taskEdges: { from: string; to: string }[];

  // 3. Technical & Architectural Decisions
  architectureDecisions: string[];
  agentDecisions: string[];

  // 4. File Inventory & Changes
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  recentFileChanges: FileChangeRecord[];

  // 5. Execution Status & Metrics
  executionStatus: CheckpointStatus;
  executionState: string;
  simClock: string;
  realElapsedSeconds: number;
  logicalElapsedSeconds: number;
  replanCount: number;

  // 6. Agent State & Continuation Instructions
  agentRoster: Record<string, ContextAgentState>;
  conversationSummary: string;
  blackboardNotes: BlackboardNote[];
  nextRecommendedActions: string[];
  agentContinuationInstructions: string;

  // 7. Event replay tape for full state reconstruction if requested
  eventReplayTape?: Envelope[];
}

export interface CheckpointContextV2 {
  checkpointId: string;
  projectId: string;
  schemaVersion: '2.0.0';
  createdAt: string;
  agentTaskId: string | null;
  parentCheckpointId: string | null;
  payload: ContextPayload;
  contextChecksum: string; // SHA-256 of canonical serialized payload JSON
}

export interface EncryptedContextPayload {
  checkpointId: string;
  projectId: string;
  ciphertext: Uint8Array;
  ivHex: string;       // 24 hex chars (96-bit IV)
  authTagHex: string;  // 32 hex chars (128-bit auth tag)
  contextChecksum: string;
  rawByteSize: number;
  encryptedByteSize: number;
  schemaVersion: '2.0.0';
  createdAt: string;
}

export interface CaptureContextOptions {
  checkpointId: string;
  projectId: string;
  parentCheckpointId?: string | null;
  currentTaskId?: string | null;
  customContinuationInstructions?: string;
  customRequirements?: string[];
  includeReplayTape?: boolean;
}
