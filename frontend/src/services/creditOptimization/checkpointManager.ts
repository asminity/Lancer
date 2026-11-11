/**
 * AUTONEX Checkpoint & Recovery Manager for iAI Credit Optimization
 * Handles serialization of compact execution checkpoints,
 * stores them directly via Ethereum Swarm,
 * retrieves and verifies bit-for-bit SHA-256 integrity,
 * and provides state resume for incomplete/deferred tasks.
 */

import { uploadContextFile, getContextFile, calculateSHA256 } from '../swarm/operations';
import type {
  CheckpointPayload,
  CheckpointVerificationResult,
  TaskPrioritizationResult,
  SwarmOptimizationMetrics,
  IAICreditAccount,
  CreditAccountingSnapshot
} from './types';

export function createCheckpointPayload(
  account: IAICreditAccount,
  prioritization: TaskPrioritizationResult,
  swarmMetrics: SwarmOptimizationMetrics,
  creditAccounting: CreditAccountingSnapshot,
  runId: string = `run_opt_${Date.now()}`
): CheckpointPayload {
  const timestamp = new Date().toISOString();
  const checkpointId = `chk_iai_${Date.now()}`;

  const completedTasks = prioritization.selectedTasks
    .filter((t) => t.status === 'completed' || t.status === 'selected')
    .map((t) => ({
      id: t.id,
      name: t.name,
      outputPreview: `Completed with ${t.estimatedTokens} tokens consumed. Value score: ${t.valueScore}/100.`
    }));

  const pendingTasks = prioritization.deferredTasks.map((t) => ({
    id: t.id,
    name: t.name,
    reason: 'Preserved for subsequent UTC epoch or additional credit allocation.'
  }));

  const agentOutputs = swarmMetrics.agents.map((a) => ({
    agentId: a.id,
    role: a.role,
    summary: a.outputSummary
  }));

  return {
    checkpointId,
    version: '2.0.0',
    timestamp,
    runId,
    executionSummary: `AUTONEX iAI Credit Optimization run. Completed ${completedTasks.length} high-value tasks, deferred ${pendingTasks.length} tasks before UTC expiry. Measured ${swarmMetrics.savingsPercentage}% context token reduction.`,
    completedTasks,
    pendingTasks,
    agentOutputs,
    tokenUsage: {
      originalTokens: swarmMetrics.originalContextTokens,
      optimizedTokens: swarmMetrics.optimizedContextTokens,
      actualInputTokens: swarmMetrics.actualInputTokens,
      actualOutputTokens: swarmMetrics.actualOutputTokens,
      tokensSaved: swarmMetrics.tokensSaved,
      savingsPct: swarmMetrics.savingsPercentage
    },
    creditAccounting: {
      initial: creditAccounting.initialAvailable,
      reserved: creditAccounting.creditsReserved,
      consumed: creditAccounting.confirmedConsumed,
      remaining: creditAccounting.remainingCredits,
      dailyExpiryUTC: account.nextExpiryUTC
    },
    metadata: {
      wallet: account.walletAddress,
      stakedIAI: account.stakedIAI,
      modelRouting: {
        planner: '0g/glm-5.3-flash',
        researcher: '0g/deepseek-v4.1-flash',
        coder: '0g/qwen3-coder-flash',
        reviewer: '0g/kimi-k2.7-code'
      },
      isDemoMode: account.isDemoMode
    }
  };
}

/**
 * Stores checkpoint payload on Ethereum Swarm and verifies bit-for-bit SHA-256 retrieval
 */
export async function storeAndVerifySwarmCheckpoint(
  payload: CheckpointPayload
): Promise<CheckpointVerificationResult> {
  const jsonContent = JSON.stringify(payload, null, 2);
  const fileName = `autonex-checkpoint-${payload.checkpointId}.json`;
  const storedAt = new Date().toISOString();

  try {
    // 1. Upload to Ethereum Swarm
    const uploadRes = await uploadContextFile(jsonContent, fileName, 'application/json');
    if (!uploadRes || !uploadRes.swarmReference) {
      throw new Error('Ethereum Swarm did not return a valid content reference');
    }

    // 2. Immediate retrieval and verification
    const retrieved = await getContextFile(uploadRes.swarmReference);
    const actualHash = await calculateSHA256(retrieved.rawBytes);
    const isBitValid = actualHash.toLowerCase() === uploadRes.contentHash.toLowerCase();

    if (!isBitValid) {
      throw new Error(`Integrity check failed: Expected ${uploadRes.contentHash}, retrieved ${actualHash}`);
    }

    const retrievedAt = new Date().toISOString();

    return {
      checkpointId: payload.checkpointId,
      swarmReference: uploadRes.swarmReference,
      contentHash: uploadRes.contentHash,
      fileSize: uploadRes.fileSize,
      verified: true,
      storedAt,
      retrievedAt,
      canResume: payload.pendingTasks.length > 0,
      resumeTaskId: payload.pendingTasks[0]?.id,
      status: 'verified'
    };
  } catch (err: any) {
    console.error('[Swarm Checkpoint] Storage or verification error:', err);
    return {
      checkpointId: payload.checkpointId,
      swarmReference: '',
      contentHash: '',
      fileSize: 0,
      verified: false,
      storedAt,
      retrievedAt: '',
      canResume: false,
      status: 'failed',
      errorMessage: err?.message || 'Swarm upload and verification failed'
    };
  }
}

