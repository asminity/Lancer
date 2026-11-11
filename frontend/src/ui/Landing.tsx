import { useState, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/state/store';
import { Icon, I } from './Icons';
import { OfficeCanvas } from '@/three/OfficeCanvas';
import { SwarmCanvas } from '@/swarm/SwarmCanvas';
import { GOLDEN_GOAL, engine } from '@/state/engine';
import { USE_MOCK } from '@/api/client';
import { setAccent, resetAccentBlend } from '@/three/materials';
import { sfx } from '@/sim/sound';
import { triage } from '@/mock/triage';
import { ZGConfigModal } from './ZGConfigModal';
import { ConnectWalletButton } from './ConnectWalletButton';

const CHIPS = [
  'Research 0G Private Computer models and build a small routing verifier',
  'Add dark mode to the dashboard',
  'Summarize this repo README in one paragraph',
  'Build a REST API with auth and tests',
];

const SWARM_CHIPS = [
  'How should a small team cut cloud costs by 30%?',
  'Should we migrate our monolith to event-driven microservices?',
  'Draft the engineering roadmap for SOC-2 Type II compliance.',
  'Evaluate Rust vs Go for our high-throughput ingest pipeline.',
];

const ESTIMATES: Record<number, { calls: number; tokens: string; time: string; warning?: string }> = {
  10: { calls: 43, tokens: '120k', time: '1–2 min' },
  20: { calls: 78, tokens: '210k', time: '2–4 min' },
  30: { calls: 114, tokens: '290k', time: '3–6 min' },
  40: { calls: 150, tokens: '380k', time: '4–8 min', warning: 'High 0G request volume; the gateway may queue calls' },
  50: { calls: 185, tokens: '460k', time: '5–10 min', warning: 'Very high 0G request volume; the gateway may queue calls' },
};

const PROFILES = [
  { id: 'strict', label: 'Strict', hint: 'Ask before every edit — for new/untrusted repos' },
  { id: 'assist', label: 'Assist', hint: 'Auto-approve edits, ask for risky shell — recommended' },
  { id: 'turbo', label: 'Turbo', hint: 'Full auto-pilot — requires a clean git repo' },
] as const;

export function Landing() {
  const models = useStore((s) => s.models);
  const modelId = useStore((s) => s.modelId);
  const accent = useStore((s) => s.accent);
  const profile = useStore((s) => s.profile);
  const appMode = useStore((s) => s.appMode);
  const swarmSize = useStore((s) => s.swarmSize);
  const zgConn = useStore((s) => s.zgConnection);
  const iai = useStore((s) => s.iai);
  const executionState = useStore((s) => s.executionState);
  const setZGModal = useStore((s) => s.setZGModalOpen);
  const checkZGStatus = useStore((s) => s.checkZGStatus);
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [validationError, setValidationError] = useState<string | null>(null);

  const isExecuting = executionState === 'validating' || executionState === 'waiting_0g' || executionState === 'running';

  useEffect(() => {
    checkZGStatus();
  }, [checkZGStatus]);

  const preview = useMemo(() => (appMode === 'office' && goal.trim().length > 12 ? triage(goal) : null), [goal, appMode]);

  const validateGuards = (): { ok: boolean; reason?: string } => {
    // 1. Missing required task details
    if (!goal.trim()) {
      return { ok: false, reason: 'Please provide the required task details.' };
    }

    if (mode === 'live') {
      // 2. 0G Service Unavailable
      if (zgConn.status === 'unavailable') {
        return { ok: false, reason: '0G is currently unavailable. Please try again.' };
      }
      // 3. Invalid or unverified credentials
      if (zgConn.status === 'invalid_key') {
        return { ok: false, reason: 'Your 0G API key has not been verified.' };
      }
      // 4. No API key or not verified
      if (!zgConn.isVerified) {
        return { ok: false, reason: 'Connect your 0G account before starting an agent.' };
      }
    }

    return { ok: true };
  };

  const handleStartTask = () => {
    if (isExecuting) return; // Prevent duplicate execution (Requirement 4)
    const check = validateGuards();
    if (!check.ok) {
      setValidationError(check.reason!);
      if (!goal.trim()) {
        document.getElementById('task-input')?.focus();
      } else if (!zgConn.isVerified) {
        setZGModal(true);
      }
      return;
    }

    setValidationError(null);
    useStore.setState({ phase: 'workspace', mode, goal: goal.trim() });
    sfx.setEnabled(useStore.getState().settings.sound);
    engine.start(mode === 'replay' ? GOLDEN_GOAL : goal.trim());
  };

  const handleHeaderAction = () => {
    if (goal.trim()) {
      handleStartTask();
      return;
    }

    // Open workspace in idle mode without triggering an agent (Requirement B)
    setValidationError(null);
    engine.stop();
    useStore.setState({ phase: 'workspace', mode, goal: '' });
    sfx.setEnabled(useStore.getState().settings.sound);
  };

  const chips = appMode === 'swarm' ? SWARM_CHIPS : CHIPS;

  return (
    <div className="relative h-full w-full overflow-hidden flex flex-col">
      {/* 1. Dedicated Fixed Top Header Navbar */}
      <header className="fixed top-0 left-0 right-0 z-30 h-14 border-b border-ink/10 bg-[#FAF7F2]/90 backdrop-blur-md px-6 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="AUTONEX Logo"
            className="w-8 h-8 object-contain drop-shadow-sm cursor-pointer transition-transform hover:scale-105"
          />
          <div className="flex items-baseline gap-2">
            <span className="font-heading font-bold text-lg tracking-tight text-ink">AUTONEX</span>
            <span className="text-[10px] font-mono text-ink/40 uppercase tracking-widest hidden sm:inline">Autonomous Floor</span>
          </div>
          <div className="h-4 w-px bg-ink/10 mx-1 hidden sm:block" />
          <button
            type="button"
            onClick={() => setZGModal(true)}
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono transition-transform hover:scale-105 ${
              zgConn.isVerified
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-700'
                : 'bg-amber-500/10 border border-amber-500/30 text-amber-800'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                zgConn.isVerified ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span>0G Compute · iAI Hub</span>
            <span className="opacity-40">·</span>
            <span className="text-[10px] font-semibold uppercase">
              {iai?.stakingStatus === 'verified'
                ? `iAI Verified (${(iai?.indicativeDailyCredits ?? 0).toFixed(2)} cr/d)`
                : zgConn.isVerified
                ? (zgConn.maskedKey ? `Active (${zgConn.maskedKey})` : 'Active')
                : 'Configure & Verify'}
            </span>
          </button>
          {USE_MOCK && (
            <span className="text-[10px] font-mono uppercase tracking-wider rounded-full border border-ink/20 px-2 py-0.5 text-ink/60">
              3D Mesh Active
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Quick mode switcher */}
          <div className="flex rounded-lg border border-ink/15 p-0.5 bg-paper/80 shadow-xs text-xs font-heading">
            <button
              type="button"
              onClick={() => useStore.setState({ appMode: 'office' })}
              className={`rounded-md px-2.5 py-1 transition-all ${
                appMode === 'office' ? 'text-white shadow-xs font-medium' : 'text-ink/60 hover:text-ink'
              }`}
              style={appMode === 'office' ? { background: 'var(--accent)' } : {}}
            >
              Office
            </button>
            <button
              type="button"
              onClick={() => useStore.setState({ appMode: 'swarm' })}
              className={`rounded-md px-2.5 py-1 transition-all ${
                appMode === 'swarm' ? 'text-white shadow-xs font-medium' : 'text-ink/60 hover:text-ink'
              }`}
              style={appMode === 'swarm' ? { background: 'var(--accent)' } : {}}
            >
              Swarm
            </button>
          </div>

          {/* Accent picker */}
          <label className="relative cursor-pointer flex items-center" title="Theme accent color">
            <input
              type="color"
              value={accent}
              onChange={(e) => {
                useStore.setState({ accent: e.target.value });
                document.documentElement.style.setProperty('--accent', e.target.value);
                setAccent(e.target.value);
                resetAccentBlend();
              }}
              className="sr-only"
            />
            <div
              className="w-5 h-5 rounded-full border-2 border-white shadow-xs transition-transform hover:scale-110"
              style={{ background: accent }}
            />
          </label>

          {/* Arkiv & Swarm Ledger */}
          <button
            type="button"
            onClick={() => useStore.setState({ arkivHistoryOpen: true })}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-ink/15 bg-white/70 hover:bg-white text-xs font-heading text-ink/80 transition-all shadow-xs"
            title="Browse verified runs and context files stored on Arkiv and Ethereum Swarm"
          >
            <Icon d={I.database} size={12} />
            <span>Arkiv & Swarm</span>
          </button>

          {/* 3-Minute iAI Credit Optimization Demo */}
          <button
            type="button"
            onClick={() => useStore.setState({ creditDemoOpen: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-mono font-semibold text-emerald-800 transition-transform hover:scale-105 shadow-xs"
            title="Launch 3-Minute iAI Credit Optimization Demo"
          >
            <span>⚡</span>
            <span>iAI Demo (3m)</span>
          </button>

          {/* Connected Web3 Wallet for Arkiv */}
          <ConnectWalletButton />

          {/* Direct Header CTA */}
          <button
            onClick={handleHeaderAction}
            disabled={isExecuting}
            className="rounded-lg px-3.5 py-1.5 font-heading font-semibold text-xs text-white shadow-xs transition-transform hover:scale-105 disabled:opacity-60 disabled:pointer-events-none"
            style={{ background: 'var(--accent)' }}
            title={goal.trim() ? 'Launch agent with specified task' : 'Open 3D office in idle mode without executing tasks'}
          >
            {isExecuting ? 'Starting...' : (goal.trim() ? (appMode === 'swarm' ? 'Convene Swarm' : 'Start Task') : 'Open Office (Idle)')}
          </button>
        </div>
      </header>

      {/* 2. Background 3D Viewport */}
      <div className="absolute inset-0">
        {appMode === 'swarm' ? <SwarmCanvas ambient /> : <OfficeCanvas ambient />}
      </div>
      <div className="absolute inset-0 blueprint-grid pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#FAF7F2]/95 via-[#FAF7F2]/75 to-transparent pointer-events-none" />

      {/* 3. Hero Content Container with Safe Top Clearance & Scrollability */}
      <div className="relative h-full pt-16 flex flex-col justify-start overflow-y-auto no-scrollbar z-10">
        <div className="max-w-2xl lg:max-w-3xl px-6 sm:px-8 lg:px-12 py-6 lg:py-8">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <div className="inline-flex items-center gap-2 mb-3 px-2.5 py-1 rounded-full bg-white/70 border border-ink/10 text-xs font-heading text-ink/70 shadow-xs">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
              <span>Decentralized AI Floor on 0G Private Computer</span>
            </div>

            <h1 className="font-heading font-bold text-4xl lg:text-5xl leading-tight tracking-tight mb-4">
              {appMode === 'swarm' ? (
                <>
                  Convene {swarmSize} agents at the round table.<br />
                  <span style={{ color: 'var(--accent)' }}>Watch them debate</span>, vote, and build consensus.
                </>
              ) : (
                <>
                  Hand one manager a task.<br />
                  <span style={{ color: 'var(--accent)' }}>Watch a whole team</span> sit down, argue, grab coffee, and ship it.
                </>
              )}
            </h1>
            <p className="font-body text-ink/70 mb-5 max-w-md">
              {appMode === 'swarm'
                ? 'Structured six-round deliberation protocol: Frame → Diverge → Cluster → Critique → Vote → Synthesize with diversity preservation.'
                : 'The manager triages your task herself — a quick summary gets done solo before the coffee cools; a full build hires a team for a whole workday, breaks and all.'}
            </p>

            {/* 3-Minute iAI Credit Optimization Demo Banner */}
            <div
              onClick={() => useStore.setState({ creditDemoOpen: true })}
              className="cursor-pointer mb-5 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15 transition-all shadow-xs flex items-center justify-between gap-3 group"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-xl">⚡</span>
                <div>
                  <div className="text-xs font-heading font-bold text-emerald-950 flex items-center gap-2">
                    <span>3-Minute iAI Credit Optimization Demo</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-600 text-white uppercase font-bold">Judge Ready</span>
                  </div>
                  <div className="text-[11px] text-emerald-900/80 mt-0.5">
                    See how AUTONEX eliminates token waste & prevents daily 00:00 UTC credit expiry.
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-800 group-hover:translate-x-1 transition-transform whitespace-nowrap">Launch →</span>
            </div>

            {/* Mode toggle */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-ink/10">
              <div className="flex rounded-xl border border-ink/15 p-0.5 bg-paper">
                <button
                  type="button"
                  onClick={() => useStore.setState({ appMode: 'office' })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-heading transition-all ${
                    appMode === 'office' ? 'text-white shadow-xs' : 'text-ink/60 hover:text-ink'
                  }`}
                  style={appMode === 'office' ? { background: 'var(--accent)' } : {}}
                >
                  Office mode
                </button>
                <button
                  type="button"
                  onClick={() => useStore.setState({ appMode: 'swarm' })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-heading transition-all ${
                    appMode === 'swarm' ? 'text-white shadow-xs' : 'text-ink/60 hover:text-ink'
                  }`}
                  style={appMode === 'swarm' ? { background: 'var(--accent)' } : {}}
                >
                  Swarm mode
                </button>
              </div>

              {appMode === 'swarm' && (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-mono text-ink/50 mr-1">Agents:</span>
                  {([10, 20, 30, 40, 50] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => useStore.setState({ swarmSize: n })}
                      className={`rounded-md px-2 py-1 text-xs font-mono border transition-all ${
                        swarmSize === n
                          ? 'border-transparent text-white font-bold'
                          : 'border-ink/15 text-ink/70 hover:border-ink/40'
                      }`}
                      style={swarmSize === n ? { background: 'var(--accent)' } : {}}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Validation Guard Alert Banner (Requirement E) */}
            {validationError && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-900 text-xs font-body flex items-center justify-between shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold shrink-0">⚠️</span>
                  <span className="font-medium">{validationError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setValidationError(null)}
                  className="text-amber-900/40 hover:text-amber-900 text-xs px-1 font-bold"
                >
                  ✕
                </button>
              </motion.div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 mb-1">
              <input
                id="task-input"
                value={goal}
                title={goal}
                onChange={(e) => {
                  setGoal(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleStartTask()}
                placeholder={appMode === 'swarm' ? 'Topic for the swarm to deliberate…' : 'Describe a task for the manager…'}
                className="flex-1 min-w-0 rounded-xl border border-ink/15 bg-white/90 px-4 py-3 font-body text-sm outline-none focus:border-ink/40 shadow-sm"
              />
              <button
                type="button"
                onClick={handleStartTask}
                disabled={isExecuting}
                className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-heading font-semibold text-sm text-white shadow-md transition-all hover:scale-[1.02] disabled:opacity-60 disabled:pointer-events-none shrink-0"
                style={{ background: 'var(--accent)' }}
              >
                {isExecuting ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <span>{executionState === 'waiting_0g' ? 'Connecting 0G...' : 'Starting...'}</span>
                  </>
                ) : (
                  <span>{appMode === 'swarm' ? 'Convene swarm' : 'Open the office'}</span>
                )}
              </button>
            </div>

            {/* Quick access to decentralized Arkiv + Swarm Ledger & 0G Checkpoint Simulator */}
            <div className="flex items-center gap-2 mt-2.5 mb-1 flex-wrap">
              <button
                type="button"
                onClick={() => useStore.setState({ arkivHistoryOpen: true, arkivActiveTab: 'swarm_context' })}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 text-xs font-mono transition-transform hover:scale-105 shrink-0"
                title="Browse decentralized simulation runs and context deliverables on Arkiv Rabdi DB-Chain & Swarm"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Browse Arkiv & Swarm Ledger ↗</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  useStore.getState().triggerErrorCheckpoint({
                    error: 'Execution halted: 0G Private Computer inference failed (Request ID: 47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5)',
                    failedAgentId: 'W_backend_0',
                    recoveryAgentId: 'W_qa_0',
                    requestId: '47fe2489886d5d85, 588da584-73b2-4dff-9c17-66609f61c2b5'
                  });
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-800 text-xs font-mono transition-transform hover:scale-105 shrink-0"
                title="Test 0G Private Computer Error Checkpoint & Save Context to Arkiv + Swarm"
              >
                <Icon d={I.alert} size={11} />
                <span>Simulate 0G Error Checkpoint</span>
              </button>
            </div>

            {/* live preview or swarm estimate */}
            {preview && (
              <div className="min-h-[28px] mt-1 text-[11px] font-body text-ink/55 flex items-center gap-2 flex-wrap">
                <span className="font-mono">≈</span>
                <span className="capitalize font-medium">{preview.task_class.replace(/_/g, ' ')} · {preview.intensity}</span>
                {preview.intensity === 'light' && <span className="text-ink/40">· sprint, no coffee breaks</span>}
                {preview.departments.length > 0 && (
                  <span className="text-ink/40">· {preview.departments.map((d) => d.name).join(', ')}</span>
                )}
                <span className="text-ink/35">(manager confirms on launch)</span>
              </div>
            )}

            {appMode === 'swarm' && (
              <div className="rounded-xl border border-ink/10 p-2.5 my-2.5 bg-white/60 font-mono text-xs flex items-center justify-between">
                <div className="flex gap-3 text-ink/70">
                  <span>~{ESTIMATES[swarmSize].calls} calls</span>
                  <span>~{ESTIMATES[swarmSize].tokens} tokens</span>
                  <span>~{ESTIMATES[swarmSize].time}</span>
                </div>
                {ESTIMATES[swarmSize].warning && (
                  <span className="text-[10px] text-[#e0a13a] font-semibold">{ESTIMATES[swarmSize].warning}</span>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-6 mt-3">
              {chips.map((c) => (
                <button key={c} onClick={() => setGoal(c)}
                  className="rounded-full border border-ink/15 bg-white/70 px-3 py-1 text-xs font-body hover:border-ink/40 transition-colors">
                  {c.length > 44 ? c.slice(0, 43) + '…' : c}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs font-body text-ink/70">
                Model
                <select value={modelId} onChange={(e) => useStore.setState({ modelId: e.target.value })}
                  className="rounded-lg border border-ink/15 bg-white/90 px-2 py-1 text-xs max-w-[170px]">
                  {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
              <div className="flex rounded-lg border border-ink/15 overflow-hidden text-xs font-heading">
                {PROFILES.map((p) => (
                  <button key={p.id} title={p.hint} onClick={() => useStore.setState({ profile: p.id })}
                    className={`px-3 py-1 ${profile === p.id ? 'text-white' : 'text-ink/70'}`}
                    style={profile === p.id ? { background: 'var(--accent)' } : {}}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-ink/15 overflow-hidden text-xs font-heading">
                {(['live', 'replay'] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`px-3 py-1 ${mode === m ? 'text-white' : 'text-ink/70'}`}
                    style={mode === m ? { background: 'var(--accent)' } : {}}>
                    {m === 'live' ? 'Live' : 'Replay'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs font-body text-ink/70">
                Company color
                <input type="color" value={accent} onChange={(e) => {
                  useStore.setState({ accent: e.target.value });
                  document.documentElement.style.setProperty('--accent', e.target.value);
                  setAccent(e.target.value); resetAccentBlend();
                }} className="w-7 h-7 rounded-lg" />
              </label>
            </div>
            <p className="mt-3 text-[10px] font-body text-ink/45">
              Profile: {PROFILES.find((p) => p.id === profile)!.hint}
            </p>
          </motion.div>
        </div>
      </div>
      <div className="absolute bottom-4 right-6 flex items-center gap-3 text-[11px] font-mono text-ink/50">
        <Icon d={I.cube} size={13} /> triage → multi-agent floor → 0G Private Computer · {zgConn.isVerified ? '0G live router' : '0G config required'}
      </div>
      <ZGConfigModal />
    </div>
  );
}
