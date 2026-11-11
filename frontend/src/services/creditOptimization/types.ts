/**
 * AUTONEX iAI Credit Optimization Types
 * Defines data structures for the 3-minute guided demonstration across 5 stages:
 * 1. iAI Credit Dashboard
 * 2. Intelligent Task Prioritization
 * 3. Token-Efficient Swarm Execution
 * 4. Intelligent Credit Utilization
 * 5. Checkpoint Storage & Recovery
 */

export type CreditUtilizationStatus = 'optimal' | 'underutilized' | 'critical_expiry' | 'depleted' | 'unconnected';

export interface IAICreditAccount {
  walletAddress: string | null;
  heldIAI: string;
  stakedIAI: string;
  stakedCollateralA0G: string;
  eligibleStakedAmount: number;
  isStakingVerified: boolean;
  indicativeDailyCredits: number;
  availableCredits: number;
  reservedCredits: number;
  consumedCredits: number;
  remainingCredits: number;
  nextExpiryUTC: string;
  secondsUntilExpiry: number;
  utilizationStatus: CreditUtilizationStatus;
  isDemoMode: boolean;
  providerConfirmed: boolean;
  notes: string[];
}

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskScheduleStatus = 'selected' | 'deferred' | 'deduplicated' | 'in_progress' | 'completed';

export interface OptimizableTask {
  id: string;
  name: string;
  description: string;
  category: 'core' | 'optimization' | 'testing' | 'redundant' | 'documentation';
  priority: TaskPriority;
  valueScore: number; // 1-100
  estimatedTokens: number;
  estimatedCredits: number;
  dependencies: string[];
  status: TaskScheduleStatus;
  isRedundant: boolean;
  redundancyReason?: string;
  canCompleteBeforeExpiry: boolean;
  assignedAgent?: string;
  assignedModel?: string;
}

export interface TaskPrioritizationResult {
  allTasks: OptimizableTask[];
  selectedTasks: OptimizableTask[];
  deferredTasks: OptimizableTask[];
  deduplicatedTasks: OptimizableTask[];
  totalDiscovered: number;
  redundantRemoved: number;
  scheduledCount: number;
  deferredCount: number;
  totalEstimatedTokens: number;
  totalEstimatedCredits: number;
  budgetUtilizationPct: number;
}

export interface SwarmAgentExecutionStatus {
  id: string;
  role: 'Planner' | 'Researcher' | 'Coder' | 'Reviewer';
  name: string;
  responsibility: string;
  model: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  originalTokens: number;
  optimizedTokens: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  contextReusePct: number;
  outputSummary: string;
}

export interface SwarmOptimizationMetrics {
  originalContextTokens: number;
  optimizedContextTokens: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  totalTokensUsed: number;
  tokensSaved: number;
  savingsPercentage: number;
  agents: SwarmAgentExecutionStatus[];
  techniquesApplied: string[];
  activePhase: 'idle' | 'planning' | 'researching' | 'coding' | 'reviewing' | 'completed';
}

export interface CreditAccountingSnapshot {
  initialAvailable: number;
  creditsReserved: number;
  confirmedConsumed: number;
  remainingCredits: number;
  tasksCompleted: number;
  tasksDeferred: number;
  accountingAuthority: string;
  safetyBufferCredits: number;
  providerConfirmed: boolean;
  telemetryTraceId?: string;
}

export interface CheckpointPayload {
  checkpointId: string;
  version: string;
  timestamp: string;
  runId: string;
  executionSummary: string;
  completedTasks: { id: string; name: string; outputPreview: string }[];
  pendingTasks: { id: string; name: string; reason: string }[];
  agentOutputs: { agentId: string; role: string; summary: string }[];
  tokenUsage: {
    originalTokens: number;
    optimizedTokens: number;
    actualInputTokens: number;
    actualOutputTokens: number;
    tokensSaved: number;
    savingsPct: number;
  };
  creditAccounting: {
    initial: number;
    reserved: number;
    consumed: number;
    remaining: number;
    dailyExpiryUTC: string;
  };
  metadata: {
    wallet: string | null;
    stakedIAI: string;
    modelRouting: Record<string, string>;
    isDemoMode: boolean;
  };
}

export interface CheckpointVerificationResult {
  checkpointId: string;
  swarmReference: string;
  contentHash: string;
  fileSize: number;
  verified: boolean;
  storedAt: string;
  retrievedAt: string;
  canResume: boolean;
  resumeTaskId?: string;
  status: 'pending' | 'uploaded' | 'verified' | 'failed';
  errorMessage?: string;
}

export type DemoStage = 1 | 2 | 3 | 4 | 5;

export interface DemoState {
  stage: DemoStage;
  isRunning: boolean;
  isPaused: boolean;
  autoPlay: boolean;
  elapsedSeconds: number;
  mode: 'demo' | 'production';
  creditAccount: IAICreditAccount;
  prioritization: TaskPrioritizationResult;
  swarmMetrics: SwarmOptimizationMetrics;
  creditAccounting: CreditAccountingSnapshot;
  checkpoint: CheckpointVerificationResult | null;
  checkpointPayload: CheckpointPayload | null;
  resumedTaskIds: string[];
  logs: { timestamp: string; stage: DemoStage; text: string; type: 'info' | 'success' | 'warn' | 'error' }[];
}

