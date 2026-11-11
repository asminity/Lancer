/**
 * AUTONEX Intelligent Task Prioritizer
 * Analyzes project backlog, detects & eliminates redundant tasks,
 * scores value, estimates compute/token budget, and schedules tasks
 * that fit within the user's available iAI credit envelope before daily expiry.
 */

import type { OptimizableTask, TaskPrioritizationResult, TaskPriority } from './types';

export const SAMPLE_PROJECT_BACKLOG: OptimizableTask[] = [
  {
    id: 'TASK-101',
    name: '0G Model Routing & Latency Optimization',
    description: 'Tune model selection matrix across glm-5.3-flash, qwen3-coder, and kimi-k2.7 to minimize latency.',
    category: 'core',
    priority: 'critical',
    valueScore: 95,
    estimatedTokens: 8500,
    estimatedCredits: 120.0,
    dependencies: [],
    status: 'selected',
    isRedundant: false,
    canCompleteBeforeExpiry: true,
    assignedAgent: 'Diya (Manager)',
    assignedModel: '0g/glm-5.3-flash'
  },
  {
    id: 'TASK-102',
    name: 'Full AST Codebase Re-index Sweep #1',
    description: 'Full un-cached AST parse across unchanged node_modules and vendor dependencies.',
    category: 'redundant',
    priority: 'low',
    valueScore: 15,
    estimatedTokens: 32000,
    estimatedCredits: 450.0,
    dependencies: [],
    status: 'deduplicated',
    isRedundant: true,
    redundancyReason: 'Duplicate of recent cache; static vendor files unchanged since previous run.',
    canCompleteBeforeExpiry: false
  },
  {
    id: 'TASK-103',
    name: 'Swarm Checkpoint Serialization & Integrity Verification',
    description: 'Implement compact JSON summary serialization and bit-level SHA-256 verification on Ethereum Swarm.',
    category: 'core',
    priority: 'critical',
    valueScore: 92,
    estimatedTokens: 11200,
    estimatedCredits: 165.0,
    dependencies: ['TASK-101'],
    status: 'selected',
    canCompleteBeforeExpiry: true,
    isRedundant: false,
    assignedAgent: 'Rohan (Coder)',
    assignedModel: '0g/qwen3-coder-flash'
  },
  {
    id: 'TASK-104',
    name: 'Duplicate Schema Validation Pass (Arkiv)',
    description: 'Repeated validation of existing ContextRefSchema without schema mutations.',
    category: 'redundant',
    priority: 'low',
    valueScore: 20,
    estimatedTokens: 14500,
    estimatedCredits: 210.0,
    dependencies: [],
    status: 'deduplicated',
    isRedundant: true,
    redundancyReason: 'Redundant with live TypeScript compiler & Viem runtime validation.',
    canCompleteBeforeExpiry: false
  },
  {
    id: 'TASK-105',
    name: 'Automated Test Suite & QA Consensus Gate',
    description: 'Execute end-to-end integration assertions with Kimi K2.7 Code verifier and generate QA proofs.',
    category: 'testing',
    priority: 'high',
    valueScore: 88,
    estimatedTokens: 9800,
    estimatedCredits: 140.0,
    dependencies: ['TASK-103'],
    status: 'selected',
    canCompleteBeforeExpiry: true,
    isRedundant: false,
    assignedAgent: 'Nisha (QA)',
    assignedModel: '0g/kimi-k2.7-code'
  },
  {
    id: 'TASK-106',
    name: 'Heavy Synthetic Benchmark Simulation (10,000 passes)',
    description: 'Extended stress test generating 10,000 synthetic transactions across mock chain.',
    category: 'optimization',
    priority: 'medium',
    valueScore: 60,
    estimatedTokens: 45000,
    estimatedCredits: 620.0,
    dependencies: ['TASK-105'],
    status: 'deferred',
    isRedundant: false,
    canCompleteBeforeExpiry: false,
    assignedAgent: 'Unassigned',
    assignedModel: 'Deferred to next UTC epoch'
  },
  {
    id: 'TASK-107',
    name: 'Technical Architecture & Verification Report Export',
    description: 'Synthesize deliverable markdown report linking Swarm BZZ refs and Rabdi DB-Chain proofs.',
    category: 'documentation',
    priority: 'high',
    valueScore: 84,
    estimatedTokens: 7600,
    estimatedCredits: 110.0,
    dependencies: ['TASK-105'],
    status: 'selected',
    canCompleteBeforeExpiry: true,
    isRedundant: false,
    assignedAgent: 'Diya (Manager)',
    assignedModel: '0g/glm-5.3-flash'
  }
];

export function prioritizeTasks(
  backlog: OptimizableTask[] = SAMPLE_PROJECT_BACKLOG,
  availableCreditBudget: number = 6355.0,
  secondsUntilExpiry: number = 14400, // 4 hours
  maxRunCreditLimit: number = 600.0 // Session allocation envelope
): TaskPrioritizationResult {
  // 1. Identification: Split active work from redundant tasks
  const deduplicatedTasks: OptimizableTask[] = [];
  const validTasks: OptimizableTask[] = [];

  for (const t of backlog) {
    if (t.isRedundant || t.category === 'redundant') {
      deduplicatedTasks.push({
        ...t,
        status: 'deduplicated'
      });
    } else {
      validTasks.push(t);
    }
  }

  // 2. Prioritization: Sort valid tasks by Priority & Value Score descending
  const priorityWeight: Record<TaskPriority, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  };

  validTasks.sort((a, b) => {
    const pDiff = priorityWeight[b.priority] - priorityWeight[a.priority];
    if (pDiff !== 0) return pDiff;
    return b.valueScore - a.valueScore;
  });

  // 3. Budget & Expiry Envelope Scheduling
  // Conservative budget allocation: Reserve safety buffer to prevent credit exhaustion
  const maxSpendable = Math.min(availableCreditBudget * 0.85, maxRunCreditLimit);
  let accumulatedCredits = 0;
  let accumulatedTokens = 0;
  // Estimate ~300 seconds (5 mins) compute per task
  let accumulatedTimeSeconds = 0;

  const selectedTasks: OptimizableTask[] = [];
  const deferredTasks: OptimizableTask[] = [];

  for (const task of validTasks) {
    const taskTime = 300; // 5 min execution window
    const fitsBudget = (accumulatedCredits + task.estimatedCredits) <= maxSpendable;
    const fitsTime = (accumulatedTimeSeconds + taskTime) < (secondsUntilExpiry - 600); // 10 min margin before UTC 00:00

    if (fitsBudget && fitsTime) {
      accumulatedCredits += task.estimatedCredits;
      accumulatedTokens += task.estimatedTokens;
      accumulatedTimeSeconds += taskTime;
      selectedTasks.push({
        ...task,
        status: 'selected',
        canCompleteBeforeExpiry: true
      });
    } else {
      deferredTasks.push({
        ...task,
        status: 'deferred',
        canCompleteBeforeExpiry: false
      });
    }
  }

  const allUpdated: OptimizableTask[] = [
    ...selectedTasks,
    ...deferredTasks,
    ...deduplicatedTasks
  ];

  const budgetUtilization = availableCreditBudget > 0
    ? (accumulatedCredits / availableCreditBudget) * 100
    : 0;

  return {
    allTasks: allUpdated,
    selectedTasks,
    deferredTasks,
    deduplicatedTasks,
    totalDiscovered: backlog.length,
    redundantRemoved: deduplicatedTasks.length,
    scheduledCount: selectedTasks.length,
    deferredCount: deferredTasks.length,
    totalEstimatedTokens: accumulatedTokens,
    totalEstimatedCredits: parseFloat(accumulatedCredits.toFixed(2)),
    budgetUtilizationPct: parseFloat(budgetUtilization.toFixed(1))
  };
}
