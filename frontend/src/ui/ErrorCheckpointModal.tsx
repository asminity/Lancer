import React, { useState } from 'react';
import { useWalletClient, useAccount } from 'wagmi';
import { useStore } from '@/state/store';
import { Icon, I } from './Icons';
import { ensureRabdiWalletClient, rabdiChain } from '@/config/chain';
import { uploadContextWorkflow, retrieveContextWorkflow } from '@/services/storageWorkflow';
import { formatArkivError } from '@/services/arkiv/balance';
import {
  generateCheckpointSummary,
  formatCheckpointSummaryMarkdown,
  type CheckpointSummary,
} from '@/services/checkpointSummary';

export function ErrorCheckpointModal() {
  const { data: wagmiWalletClient } = useWalletClient();
  const { address: activeAddress } = useAccount();

  const open = useStore((s) => s.errorCheckpointModalOpen);
  const data = useStore((s) => s.errorCheckpointData);
  const goal = useStore((s) => s.goal);
  const tasks = useStore((s) => s.tasks);
  const files = useStore((s) => s.fileEdits);
  const notes = useStore((s) => s.notes);
  const zgConnection = useStore((s) => s.zgConnection);
  const iai = useStore((s) => s.iai);
  const setOpen = useStore((s) => s.setErrorCheckpointModalOpen);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);

  if (!open) return null;

  const errorText = data?.error || 'Execution halted: 0G Private Computer inference failed (Request ID: 47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5)';
  const failedAgent = data?.failedAgentName || 'Rohan (W_backend_0)';
  const recoveryAgent = data?.recoveryAgentName || 'Nisha (W_qa_0)';
  const requestId = data?.requestId || '47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5';

  const taskList = Object.values(tasks);
  const tasksDone = taskList.filter((t) => t.status === 'done' || t.progress_pct === 100);
  const tasksInProgress = taskList.filter((t) => t.status === 'running' || t.status === 'ready' || t.status === 'pending');
  const tasksFailed = taskList.filter((t) => t.status === 'failed');

  const handleSaveToArkivAndSwarm = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // 1. Ensure user has an authorized Rabdi wallet client
      const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
      let walletClient = null;
      const expectedSigner = activeAddress || iai.walletAddress;
      try {
        walletClient = await ensureRabdiWalletClient(wagmiWalletClient, expectedSigner);
      } catch (e: any) {
        throw new Error(
          eth
            ? (e.message || 'Please approve switching to Rabdi DB-Chain in your wallet.')
            : 'No Web3 wallet detected. Please connect MetaMask, Rabby, or another Rabdi-compatible wallet.'
        );
      }

      const signerAddress = walletClient.account?.address || activeAddress || iai.walletAddress;
      if (!signerAddress) {
        throw new Error('Please connect your Web3 wallet first.');
      }

      // 2. Prepare AI-generated summary/checkpoint context payload (NO raw codebase files)
      const storeSnapshot = useStore.getState();
      const summary: CheckpointSummary = data?.checkpointSummary || generateCheckpointSummary(storeSnapshot) || {
        metadata: {
          checkpointId: `chk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          version: 'v1.0',
          timestamp: new Date().toISOString(),
          createdAtFormatted: new Date().toLocaleString(),
          runId: `run_${Date.now()}`,
          status: 'Interrupted',
          executionState: 'failed',
        },
        projectOverview: {
          projectName: (goal ? goal.slice(0, 30) : 'AUTONEX-Checkpoint').trim(),
          objective: goal || 'Autonomous task execution',
          status: 'Interrupted',
          progressPct: Math.round((tasksDone.length / (taskList.length || 1)) * 100),
          tasksTotal: taskList.length,
          tasksDone: tasksDone.length,
          tasksRunning: 0,
          tasksPending: taskList.length - tasksDone.length,
          tasksFailed: 1,
          elapsedRealSeconds: 0,
          elapsedLogicalSeconds: 0,
          simClock: '09:00',
          outputDirectory: '',
        },
        workCompleted: {
          tasks: tasksDone.map((t) => ({
            id: t.id,
            description: t.description,
            status: 'done',
            progressPct: 100,
          })),
          majorFeatures: [],
          filesCreatedOrModified: Object.keys(files || {}),
          architecturalDecisions: [],
          integrationsCompleted: [],
          relevantOutputs: [],
        },
        currentState: {
          implemented: tasksDone.map((t) => t.description),
          partiallyImplemented: [],
          incomplete: taskList.filter((t) => t.status !== 'done').map((t) => t.description),
          knownLimitations: [`Interrupted by 0G Private Computer inference failure: ${errorText}`],
        },
        agentExecution: {
          contributors: [],
          totalLlmCalls: 0,
          totalToolCalls: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
        },
        pendingTasksAndNextSteps: {
          inProgressTasks: [],
          pendingTasks: taskList
            .filter((t) => t.status !== 'done')
            .map((t) => ({ id: t.id, description: t.description, status: t.status, progressPct: t.progress_pct })),
          blockers: [errorText],
          recommendedNextActions: ['Retry inference with alternate agent', 'Resume from stored checkpoint'],
        },
        technicalContext: {
          technologies: ['0G Private Compute', 'Arkiv Rabdi DB-Chain', 'Ethereum Swarm'],
          architecture: ['Dual-Engine Autonomous Multi-Agent System'],
          configurationAndEnvironment: [
            `Failed Agent: ${failedAgent}`,
            `Recovery Agent: ${recoveryAgent}`,
            `0G Request ID: ${requestId}`,
          ],
          integrations: ['Arkiv Rabdi DB-Chain (Chain ID: 7794095)', 'Ethereum Swarm (BZZ)'],
          criticalContinuationNotes: [`Halted at request ${requestId}`],
          gitCheckpoint: null,
        },
      };

      const summaryMarkdown = formatCheckpointSummaryMarkdown(summary);

      // Payload strictly contains the AI summary / checkpoint context — no raw codebase files
      const checkpointPayload = {
        type: 'autonex_incident_checkpoint_context',
        version: '1.0.0',
        metadata: {
          checkpointId: summary.metadata.checkpointId,
          incidentType: '0g_inference_failure_recovery',
          timestamp: new Date().toISOString(),
          error: errorText,
          requestId,
          failedAgent,
          recoveryAgent,
          signerAddress,
        },
        checkpointSummary: summary,
        checkpointMarkdown: summaryMarkdown,
        fileInventory: Object.keys(files || {}), // Only file path strings, no raw codebase text
        technicalContext: {
          runtime: 'AUTONEX Dual-Engine Spatial Floor',
          computeProvider: '0G Private Computer (Router: https://router-api.0g.ai/v1)',
          databaseNetwork: 'Arkiv Rabdi DB-Chain (Chain ID: 7794095)',
          storageNetwork: 'Ethereum Swarm (BZZ)',
        },
      };

      const payloadString = JSON.stringify(checkpointPayload, null, 2);
      const cleanProjectSlug = (goal.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 24) || 'autonex-checkpoint').toLowerCase();

      // 3. Upload summary/checkpoint context to Swarm and register pointer on Arkiv Rabdi DB-Chain
      const res = await uploadContextWorkflow(walletClient, payloadString, {
        projectId: cleanProjectSlug,
        userId: signerAddress,
        reportId: checkpointPayload.metadata.checkpointId,
        fileName: `checkpoint-${cleanProjectSlug}-summary.json`,
        contentType: 'application/json',
        summary: `AI Checkpoint context for 0G inference halt (Req: ${requestId.slice(0, 16)}...)`,
      });

      setSaveResult(res);
    } catch (err: any) {
      console.error('[ErrorCheckpointModal] Failed to save checkpoint:', err);
      setSaveError(formatArkivError(err) || err.message || 'Failed to save context to Arkiv and Swarm');
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyIntegrity = async () => {
    if (!saveResult?.reportId) return;
    setVerifying(true);
    setVerifyStatus(null);
    try {
      const check = await retrieveContextWorkflow(saveResult.reportId, saveResult.entityKey);
      if (check.verified) {
        setVerifyStatus('✓ Cryptographic SHA-256 Verified! Swarm context matches on-chain Arkiv pointer bit-for-bit.');
      } else {
        setVerifyStatus('⚠ Warning: Hash mismatch detected between Swarm and Arkiv.');
      }
    } catch (err: any) {
      setVerifyStatus(`Verification failed: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const openInLedger = () => {
    useStore.setState({
      arkivHistoryOpen: true,
      arkivActiveTab: 'swarm_context',
      errorCheckpointModalOpen: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl bg-paper rounded-2xl border border-ink/20 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 bg-amber-500/10 border-b border-amber-500/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-700 shadow-xs">
              <Icon d={I.alert} size={16} />
            </div>
            <div>
              <h2 className="text-sm font-heading font-bold text-ink">
                Execution Halted · 0G Private Computer Inference Failed
              </h2>
              <p className="text-[11px] font-mono text-ink/60">
                Automatic Agent Failover & Checkpoint Synthesizer
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="w-7 h-7 rounded-lg border border-ink/10 hover:bg-white flex items-center justify-center text-ink/60 hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs font-body">
          {/* Error Details Alert */}
          <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-900 font-mono space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-red-700 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping inline-block" />
                Inference Exception Captured
              </span>
              <span className="text-[10px] text-red-600/70">Status: INTERRUPTED</span>
            </div>
            <p className="text-xs font-semibold leading-relaxed break-words">{errorText}</p>
            {requestId && (
              <div className="text-[10px] text-red-700/80 pt-1 border-t border-red-500/15">
                <span className="font-bold">0G Request ID:</span> {requestId}
              </div>
            )}
          </div>

          {/* Autonomous Agent Switch Callout */}
          <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-blue-800 flex items-center gap-1.5">
                <Icon d={I.users} size={12} />
                Autonomous Agent Switch Engaged
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-900 font-mono">
                Context Preserved
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-ink/80 pt-1">
              <div className="px-2.5 py-1 rounded-lg bg-white/80 border border-ink/15 text-red-700 flex items-center gap-1">
                <span>Failed:</span>
                <span className="font-bold">{failedAgent}</span>
              </div>
              <span className="text-blue-600 font-bold">➔</span>
              <div className="px-2.5 py-1 rounded-lg bg-white/80 border border-blue-400 text-blue-800 flex items-center gap-1 shadow-xs">
                <span>Switched to:</span>
                <span className="font-bold">{recoveryAgent}</span>
              </div>
            </div>
            <p className="text-[11px] text-blue-950/80 leading-normal">
              When {failedAgent} encountered an unrecoverable 0G inference exception, AUTONEX automatically handed
              control to {recoveryAgent}, who synthesized in-flight tasks, completed files, and system notes into a persistent checkpoint.
            </p>
          </div>

          {/* Checkpoint Context Snapshot */}
          <div className="p-3.5 rounded-xl bg-white border border-ink/15 space-y-2.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-ink/10 pb-2">
              <span className="text-[11px] font-heading font-bold text-ink flex items-center gap-1.5">
                <Icon d={I.database} size={12} />
                Execution Context Snapshot
              </span>
              <span className="text-[10px] font-mono text-ink/50">
                {new Date().toLocaleTimeString()}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded-lg bg-paper border border-ink/10">
                <span className="block text-[10px] text-ink/50">Tasks Completed</span>
                <span className="text-sm font-bold text-emerald-700">
                  {tasksDone.length} <span className="text-[10px] text-ink/40">/ {taskList.length}</span>
                </span>
              </div>
              <div className="p-2 rounded-lg bg-paper border border-ink/10">
                <span className="block text-[10px] text-ink/50">Tasks Interrupted</span>
                <span className="text-sm font-bold text-amber-700">
                  {tasksInProgress.length + tasksFailed.length}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-paper border border-ink/10">
                <span className="block text-[10px] text-ink/50">Notes & Logs</span>
                <span className="text-sm font-bold text-ink">
                  {notes.length}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-ink/70">
              <span className="font-semibold text-ink">Active Objective:</span> {goal || 'Autonomous coding sprint'}
            </div>
          </div>

          {/* Save Prompt & Storage Architecture Split */}
          {!saveResult && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h3 className="text-xs font-heading font-bold text-emerald-950">
                  Do you want to save this recovery context to Arkiv & Swarm?
                </h3>
              </div>
              <p className="text-[11px] text-emerald-900/80 leading-relaxed">
                AUTONEX divides decentralized persistence accordingly:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2.5 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="font-bold text-emerald-800 block mb-0.5">📦 Ethereum Swarm (BZZ)</span>
                  <span className="text-[10px] text-ink/70">
                    Stores the structured AI checkpoint summary, task progress, and execution context off-chain.
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="font-bold text-emerald-800 block mb-0.5">🌐 Arkiv Rabdi DB-Chain</span>
                  <span className="text-[10px] text-ink/70">
                    Anchors the immutable reference, project ownership, and cryptographic SHA-256 hash.
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Save Error */}
          {saveError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-800 text-xs">
              <span className="font-bold">Save Failed:</span> {saveError}
            </div>
          )}

          {/* Save Success View */}
          {saveResult && (
            <div className="p-4 rounded-xl bg-emerald-500/15 border border-emerald-500/30 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-heading font-bold text-emerald-900 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  ✓ Checkpoint Context Successfully Saved to Swarm + Arkiv!
                </span>
                <span className="text-[10px] font-mono text-emerald-800">
                  Chain ID: {rabdiChain.id}
                </span>
              </div>

              <div className="space-y-2 text-[11px] font-mono">
                <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="block text-[10px] text-ink/50 uppercase">Swarm BZZ Content Reference</span>
                  <span className="font-bold text-emerald-800 select-all break-all">
                    {saveResult.swarmReference}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                  <span className="block text-[10px] text-ink/50 uppercase">Cryptographic SHA-256 Digest</span>
                  <span className="font-bold text-emerald-800 select-all break-all">
                    {saveResult.contentHash}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                    <span className="block text-[10px] text-ink/50 uppercase">Arkiv Entity Key</span>
                    <span className="font-bold text-ink select-all break-all">
                      {saveResult.entityKey?.slice(0, 16)}...{saveResult.entityKey?.slice(-8)}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white/90 border border-emerald-500/20">
                    <span className="block text-[10px] text-ink/50 uppercase">Rabdi Transaction Hash</span>
                    <a
                      href={`https://rabdi.explorer.arkiv.network/tx/${saveResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-emerald-700 hover:underline select-all break-all inline-flex items-center gap-1"
                    >
                      {saveResult.txHash?.slice(0, 14)}... ↗
                    </a>
                  </div>
                </div>
              </div>

              {verifyStatus && (
                <div
                  className={`p-2.5 rounded-lg text-[11px] font-mono ${
                    verifyStatus.includes('Verified')
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  {verifyStatus}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleVerifyIntegrity}
                  disabled={verifying}
                  className="px-3 py-1.5 rounded-lg bg-white border border-emerald-500/30 text-emerald-800 text-xs font-heading font-semibold hover:bg-emerald-50 transition-colors shadow-xs"
                >
                  {verifying ? 'Verifying on Swarm...' : '✓ Verify Swarm Integrity'}
                </button>
                <button
                  type="button"
                  onClick={openInLedger}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-heading font-semibold transition-colors shadow-xs flex items-center gap-1"
                >
                  Open in Arkiv Ledger ↗
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-paper border-t border-ink/10 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3.5 py-2 rounded-xl border border-ink/20 hover:bg-white text-xs font-heading text-ink/70 hover:text-ink transition-colors"
          >
            {saveResult ? 'Close' : 'Dismiss / Keep in Memory'}
          </button>

          {!saveResult && (
            <button
              type="button"
              onClick={handleSaveToArkivAndSwarm}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-heading font-semibold shadow-md flex items-center gap-2 transition-transform active:scale-95 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Uploading to Swarm & Signing on Arkiv...</span>
                </>
              ) : (
                <>
                  <Icon d={I.database} size={14} />
                  <span>Save Context to Arkiv + Swarm</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

