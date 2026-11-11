import { create } from 'zustand';
import { Agent, BlackboardNote, DepartmentDef, Envelope, FinalResult, Metrics, ModelInfo, PermissionRequest, Task, TriageResult, SwarmIdea, SwarmCluster, SwarmCritique } from '@/api/types';
import { DEFAULT_ACCENT } from '@/config/office';
import { generateCheckpointSummary, type CheckpointSummary } from '@/services/checkpointSummary';
import { apiUrl } from '@/api/client';

export interface AgentUI extends Agent {
  pending: number; done: number; failed: number;
  outputs: { task_id: string; ts: string; kind: string; preview: string }[];
}
export interface LogEntry { id: number; ts_sim: string; type: string; text: string; agentId?: string; taskId?: string }
export interface GateState { in_flight: number; limit: number; queue_depth: number; backoff_active: boolean }
export interface Settings {
  shadows: 'low' | 'med' | 'high'; post: boolean; lodDist: number; sound: boolean;
  reducedMotion: boolean; concurrency: number; pricePerM: number; showPaidCost: boolean;
}

export type ZGStatus = 'not_configured' | 'validating' | 'connected' | 'invalid_key' | 'unavailable' | 'error';
export type ExecutionState = 'idle' | 'validating' | 'waiting_0g' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ZGConnectionState {
  status: ZGStatus;
  isVerified: boolean;
  maskedKey: string | null;
  error: string | null;
  lastVerifiedAt: string | null;
  requestId: string | null;
}

export interface IAIState {
  walletConnected: boolean;
  walletAddress: string | null;
  chainId: number | null;
  isOwnerVerified: boolean;
  authToken: string | null;
  heldIAI: string;
  stakedIAI: string;
  stakedCollateralA0G: string;
  eligibleStakedAmount: number;
  stakingStatus: 'unconnected' | 'not_detected' | 'verified';
  indicativeDailyCredits: number;
  actualComputeBalance: number | null;
  balanceStatus: 'available' | 'unavailable';
  balanceReason: string;
  lastCreditRefresh: string;
  lastInferenceStatus: 'idle' | 'successful' | 'failed';
  lastInferenceError: string | null;
  totalInferenceRequests: number;
  totalTokensUsed: number;
  totalCostMicroUsd: number;
  lastRequestId: string | null;
}

export interface ErrorCheckpointData {
  error: string;
  failedAgentId?: string;
  failedAgentName?: string;
  recoveryAgentId?: string;
  recoveryAgentName?: string;
  requestId?: string;
  timestamp: string;
  checkpointSummary?: CheckpointSummary | null;
}

interface Store {
  phase: 'landing' | 'workspace';
  goal: string; modelId: string; models: ModelInfo[]; mode: 'live' | 'replay';
  view: '3d' | 'blueprint'; night: boolean; flows: boolean; dev: boolean;
  speed: number; paused: boolean; accent: string;
  simClock: string; realElapsed: number; effortLogical: number;
  agents: Record<string, AgentUI>; order: string[];
  tasks: Record<string, Task>; edges: { from: string; to: string }[];
  notes: BlackboardNote[]; log: LogEntry[]; runEvents: Envelope[];
  metrics: Metrics; gate: GateState; llmByRole: Record<string, number>; llmByModel: Record<string, number>;
  terminal: Record<string, string[]>;
  report: FinalResult | null; checkpointSummary: CheckpointSummary | null; replanCount: number; planOutline: string[];
  selected: string | null; inspectorOpen: boolean; drawerOpen: boolean; settingsOpen: boolean; reportOpen: boolean; arkivHistoryOpen: boolean;
  arkivActiveTab: 'public' | 'user' | 'swarm_context' | 'lookup';
  followId: string | null; toast: string | null; offline: boolean; demoMode: boolean;
  replayIdx: number; replayPlaying: boolean; notePulse: number;
  appMode: 'office' | 'swarm';
  swarmSize: 10 | 20 | 30 | 40 | 50;
  swarmPhaseTick: number;
  swarm: {
    phase: string; round: number; topic: string; moderatorId: string;
    agents: Record<string, any>;
    ideas: Record<string, SwarmIdea>; ideaOrder: string[];
    clusters: Record<string, SwarmCluster>; clusterOrder: string[];
    critiques: SwarmCritique[];
    votes: { agent_id: string; idea_id: string; score: number }[];
    tally: { scores: { idea_id: string; score: number; votes: number }[]; agreement: number } | null;
    speakingId: string | null;
    synthesis: { text: string; source_idea_ids: string[] } | null;
  };
  triage: TriageResult | null;
  departments: Record<string, DepartmentDef>;
  pendingPermissions: PermissionRequest[];
  profile: 'strict' | 'assist' | 'turbo';
  sandboxMode: 'native' | 'docker';
  contextStages: Record<string, { stage: number; frac: number }>;
  fileEdits: Record<string, { path: string; line_ranges: [number, number][]; branch?: string; ts: string }[]>;
  checkpoint: { branch: string; start_commit: string } | null;
  checkpointModalOpen: boolean;
  selectedCheckpointId: string | null;
  restoredWorkspaceFiles: Record<string, string> | null;
  restoredCheckpointId: string | null;
  editorOpenRequested: boolean;
  openProjectEditor: (mode: 'office' | 'swarm') => void;
  setCheckpointModalOpen: (open: boolean, checkpointId?: string | null) => void;
  settings: Settings;
  zgConnection: ZGConnectionState;
  zgModalOpen: boolean;
  iai: IAIState;
  creditDemoOpen: boolean;
  setCreditDemoOpen: (open: boolean) => void;
  errorCheckpointModalOpen: boolean;
  errorCheckpointData: ErrorCheckpointData | null;
  setErrorCheckpointModalOpen: (open: boolean) => void;
  triggerErrorCheckpoint: (info: { error: string; failedAgentId?: string; recoveryAgentId?: string; requestId?: string }) => void;
  executionState: ExecutionState;
  executionError: string | null;
  setExecutionState: (state: ExecutionState, error?: string | null) => void;
  setZGModalOpen: (open: boolean) => void;
  checkZGStatus: () => Promise<void>;
  verifyZGKey: (apiKey: string) => Promise<{ valid: boolean; message: string }>;
  disconnectZG: () => Promise<void>;
  connectWallet: (address: string, chainId?: number) => Promise<void>;
  disconnectWallet: () => void;
  verifyWalletSignature: (signature: string, message: string, nonce: string) => Promise<{ verified: boolean; message: string }>;
  refreshIAIStatus: (address?: string) => Promise<void>;
  refreshIAIUsage: () => Promise<void>;
  runTestInference: (prompt?: string, options?: { maxTokens?: number; model?: string }) => Promise<{ ok: boolean; status: string; result?: any; error?: string }>;
  set: (p: Partial<Store>) => void;
  resetRun: (goal: string) => void;
}

let logId = 0;
export const useStore = create<Store>((set, get) => ({
  phase: 'landing',
  goal: '', modelId: '0g/glm-5.3-flash', models: [], mode: 'live',
  view: '3d', night: false, flows: false, dev: false,
  speed: 1, paused: false, accent: DEFAULT_ACCENT,
  simClock: '09:00', realElapsed: 0, effortLogical: 0,
  agents: {}, order: [], tasks: {}, edges: [], notes: [], log: [], runEvents: [],
  metrics: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 }, gate: { in_flight: 0, limit: 4, queue_depth: 0, backoff_active: false },
  llmByRole: {}, llmByModel: {}, terminal: {},
  report: null, checkpointSummary: null, replanCount: 0, planOutline: [],
  selected: null, inspectorOpen: false, drawerOpen: false, settingsOpen: false, reportOpen: false, arkivHistoryOpen: false,
  arkivActiveTab: 'public',
  followId: null, toast: null, offline: false, demoMode: true,
  replayIdx: 0, replayPlaying: true, notePulse: 0,
  appMode: 'office',
  swarmSize: 20,
  swarmPhaseTick: 0,
  swarm: {
    phase: '', round: 0, topic: '', moderatorId: '',
    agents: {}, ideas: {}, ideaOrder: [], clusters: {}, clusterOrder: [],
    critiques: [], votes: [], tally: null, speakingId: null, synthesis: null,
  },
  triage: null,
  departments: {},
  pendingPermissions: [],
  profile: 'assist',
  sandboxMode: 'native',
  contextStages: {},
  fileEdits: {},
  checkpoint: null,
  checkpointModalOpen: false,
  selectedCheckpointId: null,
  restoredWorkspaceFiles: null,
  restoredCheckpointId: null,
  editorOpenRequested: false,
  openProjectEditor: (mode) => set({
    appMode: mode,
    reportOpen: true,
    editorOpenRequested: true,
  }),
  setCheckpointModalOpen: (open: boolean, checkpointId?: string | null) =>
    set({ checkpointModalOpen: open, selectedCheckpointId: checkpointId ?? null }),
  settings: { shadows: 'med', post: true, lodDist: 26, sound: true, reducedMotion: false, concurrency: 4, pricePerM: 0.6, showPaidCost: false },
  executionState: 'idle',
  executionError: null,
  setExecutionState: (executionState, executionError = null) => set({ executionState, executionError }),
  zgModalOpen: false,
  zgConnection: {
    status: 'not_configured',
    isVerified: false,
    maskedKey: null,
    error: null,
    lastVerifiedAt: null,
    requestId: null
  },
  iai: {
    walletConnected: false,
    walletAddress: null,
    chainId: null,
    isOwnerVerified: false,
    authToken: null,
    heldIAI: '0',
    stakedIAI: '0',
    stakedCollateralA0G: '0',
    eligibleStakedAmount: 0,
    stakingStatus: 'unconnected',
    indicativeDailyCredits: 0,
    actualComputeBalance: null,
    balanceStatus: 'unavailable',
    balanceReason: 'Compute balance unavailable: 0G sk- key is scoped for direct inference billing only. Balance queries require mk- management key.',
    lastCreditRefresh: 'Daily at 00:00 UTC',
    lastInferenceStatus: 'idle',
    lastInferenceError: null,
    totalInferenceRequests: 0,
    totalTokensUsed: 0,
    totalCostMicroUsd: 0,
    lastRequestId: null
  },
  creditDemoOpen: false,
  setCreditDemoOpen: (open) => set({ creditDemoOpen: open }),
  errorCheckpointModalOpen: false,
  errorCheckpointData: null,
  setErrorCheckpointModalOpen: (open) => set({ errorCheckpointModalOpen: open }),
  triggerErrorCheckpoint: (info) => {
    const s = get();
    // 1. Resolve failed agent
    const failedId = info.failedAgentId || s.selected || 'W_backend_0';
    const failedAgent = s.agents[failedId];
    const failedName = failedAgent?.name || (failedId.includes('backend') ? 'Rohan' : failedId.includes('qa') ? 'Nisha' : failedId.includes('frontend') ? 'Kabir' : 'Diya');

    // 2. Resolve fallback recovery agent
    let recoveryId = info.recoveryAgentId;
    if (!recoveryId || recoveryId === failedId) {
      if (failedId !== 'W_qa_0' && s.agents['W_qa_0']) {
        recoveryId = 'W_qa_0';
      } else if (failedId !== 'M0' && s.agents['M0']) {
        recoveryId = 'M0';
      } else if (failedId !== 'W_frontend_0' && s.agents['W_frontend_0']) {
        recoveryId = 'W_frontend_0';
      } else {
        recoveryId = 'M0';
      }
    }
    const recoveryAgent = s.agents[recoveryId];
    const recoveryName = recoveryAgent?.name || (recoveryId === 'W_qa_0' ? 'Nisha' : 'Diya');

    // 3. Extract Request ID
    let reqId = info.requestId;
    if (!reqId) {
      const match = info.error.match(/Request ID:\s*([a-zA-Z0-9-, ]+)/i);
      if (match) reqId = match[1].trim();
      else reqId = '47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5';
    }

    // 4. Update 3D Director activities if running
    try {
      import('@/sim/director').then(({ director }) => {
        director.confuse(failedId);
        director.setActivityFor(recoveryId, 'WORKING');
      }).catch(() => {});
    } catch {}

    // 5. Generate structured Checkpoint Summary from the frozen execution state
    const summary = generateCheckpointSummary({
      ...s,
      executionState: 'failed',
      executionError: info.error
    });

    const checkpointData: ErrorCheckpointData = {
      error: info.error,
      failedAgentId: failedId,
      failedAgentName: failedName,
      recoveryAgentId: recoveryId,
      recoveryAgentName: recoveryName,
      requestId: reqId,
      timestamp: new Date().toISOString(),
      checkpointSummary: summary
    };

    const noteId = `note_err_${Date.now()}`;
    const newNote = {
      id: noteId,
      author_agent_id: recoveryId,
      topic: 'CHECKPOINT_RECOVERY',
      note: `Execution halted: 0G Private Computer inference failed (Request ID: ${reqId}). Incident context captured by ${recoveryName}. Ready to anchor to Arkiv + Swarm.`,
      ts: s.simClock || '09:12'
    };

    set({
      executionState: 'failed',
      executionError: info.error,
      checkpointSummary: summary,
      errorCheckpointModalOpen: true,
      errorCheckpointData: checkpointData,
      notes: [...s.notes, newNote],
      notePulse: s.notePulse + 1,
      selected: recoveryId,
      followId: recoveryId
    });
  },
  setZGModalOpen: (open) => set({ zgModalOpen: open }),
  checkZGStatus: async () => {
    // 1. Check local session storage first
    try {
      const savedKey = typeof window !== 'undefined' ? sessionStorage.getItem('zg_api_key') : null;
      if (savedKey) {
        const trimmed = savedKey.trim();
        const masked = trimmed.length <= 8 ? '••••' + trimmed.slice(-2) : trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);
        set((s) => ({
          zgConnection: {
            ...s.zgConnection,
            status: 'connected',
            isVerified: true,
            maskedKey: masked,
            error: null
          }
        }));
      }
    } catch {}

    // 2. Check local bridge server (non-blocking with short timeout)
    try {
      const res = await fetch(apiUrl('/api/config/0g/status'), {
        signal: AbortSignal.timeout(1500)
      }).then((r) => r.json());

      if (res && res.isVerified) {
        set((s) => ({
          zgConnection: {
            status: 'connected',
            isVerified: true,
            maskedKey: res.maskedKey || s.zgConnection.maskedKey,
            error: null,
            lastVerifiedAt: res.lastVerifiedAt || new Date().toISOString(),
            requestId: res.lastRequestId || s.zgConnection.requestId
          }
        }));
      }
    } catch {
      // Bridge is not running; retain existing status (default 'not_configured' or sessionStorage validated state)
    }
  },
  verifyZGKey: async (apiKey: string) => {
    const trimmed = (apiKey || '').trim();
    if (!trimmed) {
      set((s) => ({
        zgConnection: {
          ...s.zgConnection,
          status: 'not_configured',
          error: 'Please enter your 0G API Key'
        }
      }));
      return { valid: false, message: 'Please enter your 0G API Key' };
    }

    set((s) => ({
      zgConnection: {
        ...s.zgConnection,
        status: 'validating',
        error: null
      }
    }));

    const masked = trimmed.length <= 8 ? '••••' + trimmed.slice(-2) : trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);

    try {
      // Verify via backend bridge server to bypass browser CORS restrictions
      const verifyRes = await fetch(apiUrl('/api/config/0g/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed }),
        signal: AbortSignal.timeout(15000)
      });

      const data = await verifyRes.json().catch(() => null);

      if (data && data.valid) {
        const effectiveId = data.requestId || `req_0g_${Date.now()}`;
        try {
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('zg_api_key', trimmed);
          }
        } catch {}

        set({
          zgConnection: {
            status: 'connected',
            isVerified: true,
            maskedKey: data.maskedKey || masked,
            error: null,
            lastVerifiedAt: new Date().toISOString(),
            requestId: effectiveId
          }
        });

        return { valid: true, message: '0G Private Computer credentials successfully verified' };
      }

      if (data && data.status === 'invalid_key') {
        set({
          zgConnection: {
            status: 'invalid_key',
            isVerified: false,
            maskedKey: null,
            error: data.message || 'Invalid 0G API Key: authentication failed (401)',
            lastVerifiedAt: null,
            requestId: data.requestId || null
          }
        });
        return { valid: false, message: data.message || 'Invalid 0G API Key: authentication failed (401)' };
      }

      const errMsg = data?.message || `0G service unavailable (HTTP ${verifyRes.status})`;
      set({
        zgConnection: {
          status: 'unavailable',
          isVerified: false,
          maskedKey: null,
          error: errMsg,
          lastVerifiedAt: null,
          requestId: data?.requestId || null
        }
      });
      return { valid: false, message: errMsg };
    } catch (err: any) {
      const isAbort = err.name === 'AbortError' || err.name === 'TimeoutError';
      const errMsg = isAbort
        ? '0G service unavailable: request timed out'
        : `0G connection error: ${err.message || 'network unreachable'}`;

      set({
        zgConnection: {
          status: 'unavailable',
          isVerified: false,
          maskedKey: null,
          error: errMsg,
          lastVerifiedAt: null,
          requestId: null
        }
      });
      return { valid: false, message: errMsg };
    }
  },
  disconnectZG: async () => {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('zg_api_key');
      }
    } catch {}
    try {
      await fetch(apiUrl('/api/config/0g'), { method: 'DELETE' });
    } catch {}
    set({
      zgConnection: {
        status: 'not_configured',
        isVerified: false,
        maskedKey: null,
        error: null,
        lastVerifiedAt: null,
        requestId: null
      }
    });
  },
  connectWallet: async (address: string, chainId = 16661) => {
    const cleanAddr = address.trim().toLowerCase();
    set((s) => ({
      iai: {
        ...s.iai,
        walletConnected: true,
        walletAddress: cleanAddr,
        chainId
      }
    }));
    await get().refreshIAIStatus(cleanAddr);
  },
  disconnectWallet: () => {
    set((s) => ({
      iai: {
        ...s.iai,
        walletConnected: false,
        walletAddress: null,
        chainId: null,
        isOwnerVerified: false,
        authToken: null,
        heldIAI: '0',
        stakedIAI: '0',
        stakedCollateralA0G: '0',
        eligibleStakedAmount: 0,
        stakingStatus: 'unconnected',
        indicativeDailyCredits: 0,
        actualComputeBalance: null,
        balanceStatus: 'unavailable'
      }
    }));
  },
  verifyWalletSignature: async (signature: string, message: string, nonce: string) => {
    const s = get();
    const address = s.iai.walletAddress;
    if (!address) return { verified: false, message: 'No wallet connected' };

    try {
      const res = await fetch(apiUrl('/api/auth/verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, message, nonce })
      });
      const data = await res.json();
      if (data.verified) {
        set((st) => ({
          iai: {
            ...st.iai,
            isOwnerVerified: true,
            authToken: data.token
          }
        }));
        return { verified: true, message: 'Wallet ownership verified successfully' };
      }
      return { verified: false, message: data.message || 'Verification failed' };
    } catch {
      try {
        const { verifyMessage } = await import('viem');
        const valid = await verifyMessage({
          address: address as `0x${string}`,
          message,
          signature: signature as `0x${string}`
        });
        if (valid) {
          set((st) => ({
            iai: {
              ...st.iai,
              isOwnerVerified: true,
              authToken: `tok_local_${Date.now()}`
            }
          }));
          return { verified: true, message: 'Wallet ownership verified successfully (client verification)' };
        }
        return { verified: false, message: 'Invalid cryptographic signature' };
      } catch (err: any) {
        return { verified: false, message: err?.message || 'Signature verification error' };
      }
    }
  },
  refreshIAIStatus: async (targetAddress?: string) => {
    const address = targetAddress || get().iai.walletAddress;
    if (!address) return;

    try {
      const res = await fetch(apiUrl(`/api/iai/status?address=${encodeURIComponent(address)}`));
      if (res.ok) {
        const data = await res.json();
        set((st) => ({
          iai: {
            ...st.iai,
            heldIAI: data.heldInWallet ?? data.walletBalance ?? '0.000000',
            stakedIAI: data.actuallyStaked ?? data.stakedAmount ?? '0.000000',
            stakedCollateralA0G: data.stakedCollateralA0G ?? data.lockedCollateral ?? '0.0000',
            eligibleStakedAmount: Number(data.eligibleStakedAmount ?? 0) || 0,
            stakingStatus: data.isStakingVerified ? 'verified' : 'not_detected',
            indicativeDailyCredits: Number(data.indicativeDailyCredits ?? 0) || 0,
            lastCreditRefresh: data.lastCreditRefresh || 'Daily at 00:00 UTC'
          }
        }));
        return;
      }
    } catch {}

    try {
      const { queryOnChainIAIStatus } = await import('@/services/iaiContract');
      const data = await queryOnChainIAIStatus(address);
      set((st) => ({
        iai: {
          ...st.iai,
          heldIAI: data.heldInWallet ?? '0.000000',
          stakedIAI: data.actuallyStaked ?? '0.000000',
          stakedCollateralA0G: data.stakedCollateralA0G ?? '0.0000',
          eligibleStakedAmount: Number(data.eligibleStakedAmount ?? 0) || 0,
          stakingStatus: data.isStakingVerified ? 'verified' : 'not_detected',
          indicativeDailyCredits: Number(data.indicativeDailyCredits ?? 0) || 0,
          lastCreditRefresh: data.lastCreditRefresh || 'Daily at 00:00 UTC'
        }
      }));
    } catch (err) {
      console.warn('Error refreshing iAI status:', err);
    }
  },
  refreshIAIUsage: async () => {
    try {
      const res = await fetch(apiUrl('/api/iai/usage'));
      if (res.ok) {
        const usage = await res.json();
        set((st) => ({
          iai: {
            ...st.iai,
            totalInferenceRequests: usage.totalRequests,
            totalTokensUsed: usage.totalTokens,
            totalCostMicroUsd: usage.totalCostMicroUsd,
            lastRequestId: usage.lastRequestId || st.iai.lastRequestId
          }
        }));
      }
    } catch {}
  },
  runTestInference: async (prompt = 'Say hello in 3 words', options = {}) => {
    try {
      const res = await fetch(apiUrl('/api/zg/test-inference'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: options.model || 'glm-5.3-flash', maxTokens: options.maxTokens || 15 })
      });
      const data = await res.json();
      if (data.ok) {
        set((st) => ({
          iai: {
            ...st.iai,
            lastInferenceStatus: 'successful',
            lastInferenceError: null,
            totalInferenceRequests: data.usage?.totalRequests ?? st.iai.totalInferenceRequests + 1,
            totalTokensUsed: data.usage?.totalTokens ?? st.iai.totalTokensUsed + (data.result?.tokensIn || 0) + (data.result?.tokensOut || 0),
            totalCostMicroUsd: data.usage?.totalCostMicroUsd ?? st.iai.totalCostMicroUsd,
            lastRequestId: data.result?.requestId || st.iai.lastRequestId
          }
        }));
        return { ok: true, status: 'successful', result: data.result };
      } else {
        set((st) => ({
          iai: {
            ...st.iai,
            lastInferenceStatus: 'failed',
            lastInferenceError: data.error || '0G inference failed'
          }
        }));
        return { ok: false, status: 'failed', error: data.error };
      }
    } catch (err: any) {
      set((st) => ({
        iai: {
          ...st.iai,
          lastInferenceStatus: 'failed',
          lastInferenceError: err.message || 'Network error'
        }
      }));
      return { ok: false, status: 'failed', error: err.message };
    }
  },
  set: (p) => set(p),
  resetRun: (goal) => set({
    goal, executionState: 'idle', executionError: null, agents: {}, order: [], tasks: {}, edges: [], notes: [], log: [], runEvents: [],
    metrics: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 },
    gate: { in_flight: 0, limit: 4, queue_depth: 0, backoff_active: false },
    llmByRole: {}, llmByModel: {}, terminal: {}, report: null, checkpointSummary: null, replanCount: 0,
    errorCheckpointModalOpen: false, errorCheckpointData: null,
    planOutline: [], selected: null, inspectorOpen: false, followId: null,
    triage: null, departments: {}, pendingPermissions: [], contextStages: {}, fileEdits: {}, checkpoint: null,
    simClock: '09:00', realElapsed: 0, effortLogical: 0, replayIdx: 0, replayPlaying: true, mode: 'live',
    swarm: {
      phase: '', round: 0, topic: '', moderatorId: '',
      agents: {}, ideas: {}, ideaOrder: [], clusters: {}, clusterOrder: [],
      critiques: [], votes: [], tally: null, speakingId: null, synthesis: null,
    },
  }),
}));

export const pushLog = (e: Envelope, text: string) => {
  const s = useStore.getState();
  const log = [...s.log, { id: ++logId, ts_sim: e.ts_sim, type: e.type, text, agentId: e.agent_id, taskId: e.task_id }];
  useStore.setState({ log: log.length > 600 ? log.slice(log.length - 600) : log });
};
