import { Envelope, parseEvent } from '@/api/types';
import { apiUrl, USE_MOCK, HttpStream, EventStream, HttpClient, ApiClient } from '@/api/client';
import { MockSimulator } from '@/mock/simulator';
import { applyEvent } from './events';
import { useStore } from './store';
import { director } from '@/sim/director';
import { triage } from '@/mock/triage';
import goldenRun from '@/mock/goldenRun.json';
import { generateCheckpointSummary } from '@/services/checkpointSummary';

export interface RunEngine {
  start(goal: string): Promise<void> | void;
  stop(): void;
  setSpeed(f: number): void;
  pause(p: boolean): void;
  seek(idx: number): void;
  respondPermission(requestId: string, decision: 'once' | 'always' | 'reject'): void;
  runControl(action: 'merge_branch' | 'discard_branch', branch: string): void;
  replayTape: Envelope[];
}

function pushLogSafe(text: string) {
  const s = useStore.getState();
  useStore.setState({
    log: [...s.log, { id: Date.now(), ts_sim: s.simClock, type: 'run.control', text }],
  });
}

class MockEngine implements RunEngine {
  private sim: MockSimulator | null = null;
  private raf = 0;
  private paused = false;
  private speed = 1;
  replayTape: Envelope[] = [];
  private lastTick = 0;
  private startedAt = 0;

  async start(goal: string) {
    this.stop();
    director.reset();
    useStore.getState().resetRun(goal);
    director.pace = triage(goal).break_policy.pace;
    const st = useStore.getState();
    if (st.appMode === 'swarm') {
      const { rebuildSwarmDirector } = await import('@/swarm/directorRef');
      const { buildSwarmScript } = await import('@/swarm/mockSwarm');
      const { applyRoleColors } = await import('@/swarm/roles');
      rebuildSwarmDirector(st.swarmSize);
      applyRoleColors(st.accent);
      this.sim = new MockSimulator(goal, buildSwarmScript(goal, st.swarmSize));
    } else {
      this.sim = new MockSimulator(goal);
    }
    this.replayTape = [];
    this.startedAt = performance.now();
    this.lastTick = 0;
    this.sim.start((e) => this.handle(e));
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.paused && this.sim) this.sim.setSpeed(this.speed), this.sim.poll();
      const el = (performance.now() - this.startedAt) / 1000;
      if (el - this.lastTick > 5) {
        this.lastTick = el;
        this.handle(fakeTick(el));
      }
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.sim?.stop(); this.sim = null; }
  setSpeed(f: number) { this.speed = f; }
  pause(p: boolean) { this.paused = p; useStore.setState({ paused: p }); }
  private handle(e: Envelope) {
    const ev = parseEvent(e);
    if (!ev) { console.warn('dropped invalid event', e); return; }
    this.replayTape.push(ev);
    useStore.setState({ runEvents: [...useStore.getState().runEvents, ev] });
    applyEvent(ev, false);
  }
  seek(idx: number) {
    // instant rebuild of world + state up to idx
    director.reset();
    useStore.getState().resetRun(useStore.getState().goal);
    const tape = this.replayTape.slice(0, idx);
    for (const ev of tape) applyEvent(ev, true);
    useStore.setState({ runEvents: tape, replayIdx: idx });
  }
  respondPermission(requestId: string, decision: 'once' | 'always' | 'reject') {
    // resolve instantly so the UI never hangs in mock mode
    const pending = useStore.getState().pendingPermissions;
    const req = pending.find((p) => p.request_id === requestId);
    if (!req) return;
    const env = {
      seq: -2, run_id: this.sim?.runId ?? 'local', ts_real: new Date().toISOString(),
      ts_sim: useStore.getState().simClock, type: 'permission.resolved',
      agent_id: req.agent_id, payload: { request_id: requestId, decision },
    } as any;
    this.handle(env as Envelope);
  }
  runControl(action: string, branch: string) {
    pushLogSafe(`${action === 'merge_branch' ? 'Merged' : 'Discarded'} branch ${branch}`);
  }
}

// FIX F8: the original put the (empty) string '' in sim_time, which blanked the toolbar clock every 5 s.
function fakeTick(elapsed: number): Envelope {
  const mins = 9 * 60 + (elapsed * 30) / 60;
  const hhmm = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
  return {
    seq: -1, run_id: 'local', ts_real: new Date().toISOString(),
    ts_sim: hhmm,
    type: 'clock.tick', payload: { sim_time: hhmm, real_elapsed_s: elapsed },
  } as any;
}

class LiveEngine implements RunEngine {
  private stream: EventStream | null = null;
  private client: ApiClient = new HttpClient();
  private currentRunId: string | null = null;
  replayTape: Envelope[] = [];
  async start(goal: string) {
    this.stop();
    director.reset();
    useStore.getState().resetRun(goal);
    this.replayTape = [];
    useStore.setState({ executionState: 'waiting_0g', executionError: null });
    try {
      const st = useStore.getState();
      if (st.appMode === 'swarm') {
        const { rebuildSwarmDirector } = await import('@/swarm/directorRef');
        const { applyRoleColors } = await import('@/swarm/roles');
        rebuildSwarmDirector(st.swarmSize);
        applyRoleColors(st.accent);
      }
      const { run_id } = await this.client.createTask(
        goal,
        st.modelId,
        { profile: st.profile, mode: st.appMode, swarm_size: st.swarmSize } as any
      );
      this.currentRunId = run_id;
      useStore.setState({ executionState: 'running' });
      let eventCount = 0;
      this.stream = new HttpStream();
      this.stream.start(run_id, 0, (e) => {
        eventCount++;
        const ev = parseEvent(e);
        if (!ev) { console.warn('dropped invalid event', e); return; }
        this.replayTape.push(ev);
        useStore.setState({ runEvents: [...useStore.getState().runEvents, ev] });

        if (ev.type === 'final.result' || ev.type === 'run.completed') {
          useStore.setState({ executionState: 'completed' });
        } else if (ev.type === 'system.halted') {
          useStore.setState({ executionState: 'cancelled' });
        }

        applyEvent(ev, false);
      });
      useStore.setState({ offline: false, demoMode: false });

      // Watchdog: If no events received within 2s (e.g. serverless hosting without WebSockets), fall back to built-in simulation
      setTimeout(() => {
        if (eventCount === 0 && this.currentRunId === run_id) {
          console.warn('[LiveEngine] No streaming events arrived over WebSocket; activating simulation engine.');
          const fallback = new MockEngine();
          fallback.start(goal);
        }
      }, 2000);
    } catch (err: any) {
      console.warn('[LiveEngine] Bridge unavailable, falling back to simulation engine:', err);
      const fallback = new MockEngine();
      fallback.start(goal);
    }
  }
  stop() {
    if (this.currentRunId) {
      this.client.cancelTask(this.currentRunId).catch(() => {});
      this.currentRunId = null;
    }
    this.stream?.stop();
    this.stream = null;
    if (useStore.getState().executionState === 'running' || useStore.getState().executionState === 'waiting_0g') {
      useStore.setState({ executionState: 'cancelled' });
      const summary = generateCheckpointSummary(useStore.getState());
      if (summary) {
        useStore.setState({ checkpointSummary: summary });
      }
    }
  }
  setSpeed(f: number) { this.stream?.setSpeed(f); }
  pause(p: boolean) { useStore.setState({ paused: p }); }
  seek(_idx: number) { /* live runs are not scrubbable */ }
  respondPermission(requestId: string, decision: 'once' | 'always' | 'reject') {
    this.stream?.send({ type: 'permission.respond', request_id: requestId, decision });
  }
  runControl(action: 'merge_branch' | 'discard_branch', branch: string) {
    this.stream?.send({ type: 'run.control', action, branch });
  }
}

export const engine: RunEngine = USE_MOCK ? new MockEngine() : new LiveEngine();

export async function haltEntireSystem() {
  const s = useStore.getState();
  const now = s.simClock || '10:00';

  useStore.setState({
    log: [
      ...s.log,
      {
        id: Date.now(),
        ts_sim: now,
        type: 'system.halt',
        text: '🛑 EMERGENCY STOP: Entire system halted. All agent workflows, tasks, and file operations terminated.',
      },
    ],
    pendingPermissions: [],
    paused: true,
  });

  engine.stop();

  const updatedTasks = { ...s.tasks };
  for (const tid of Object.keys(updatedTasks)) {
    if (updatedTasks[tid].status === 'running' || updatedTasks[tid].status === 'pending') {
      updatedTasks[tid] = { ...updatedTasks[tid], status: 'failed' };
    }
  }

  const updatedAgents = { ...s.agents };
  for (const aid of Object.keys(updatedAgents)) {
    updatedAgents[aid] = { ...updatedAgents[aid], status: 'IDLE' };
  }

  useStore.setState({
    tasks: updatedTasks,
    agents: updatedAgents,
    swarm: { ...s.swarm, speakingId: null },
  });

  const interruptedSummary = generateCheckpointSummary(useStore.getState());
  if (interruptedSummary) {
    useStore.setState({ checkpointSummary: interruptedSummary });
  }

  try {
    await fetch(apiUrl('/api/tasks/cancel_all'), { method: 'POST' });
  } catch {}

  try {
    const { managerAgent } = await import('@/sim/managerAgent');
    managerAgent.reset();
  } catch {}
}
export const GOLDEN_GOAL = goldenRun.goal;
