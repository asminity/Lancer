import fs from 'node:fs';
import path from 'node:path';
/**
 * AUTONEX Bridge Server - Real Multi-Agent Execution & Contract Engine
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { MODELS } from '../../src/mock/data';
import { triage } from '../../src/mock/triage';
import { buildScript } from '../../src/mock/simulator';
import { executeRealRun, loadEnv, callLLM } from './realRunner';
import { executeSwarmRun } from './swarmRunner';
import { zgClient, TASK_MODEL_ROUTING } from './zgClient';

loadEnv();

// Background validation of environment key on startup
if (zgClient.hasApiKey() && !process.env.VITEST) {
  zgClient.validateCredentials().then((res) => {
    if (res.valid) {
      console.log(`[0G Bridge] Environment API key verified successfully (${res.maskedKey}, request_id: ${res.requestId})`);
    } else {
      console.warn(`[0G Bridge] Environment API key validation failed: ${res.message}`);
    }
  }).catch((err) => {
    console.warn('[0G Bridge] Startup 0G verification error:', err.message);
  });
}

interface Run {
  id: string;
  goal: string;
  startedAt: number;
  script: any[];
  idx: number;
  vt: number;
  speed: number;
  events: any[];
  seq: number;
  nextTick: number;
  clients: Set<WebSocket>;
  timer?: NodeJS.Timeout;
  done: boolean;
  pending: Map<string, { agent_id: string }>;
  pendingResolvers: Map<string, (decision: 'once' | 'always' | 'reject') => void>;
  alwaysAllowed: Set<string>;
}

const runs = new Map<string, Run>();
const activeNonces = new Map<string, { address: string; issuedAt: number }>();
const authenticatedSessions = new Map<string, { address: string; verifiedAt: number }>();
let config = {
  model_id: MODELS[0].id,
  concurrency_limit: 4,
  speed_factor: 1,
  break_policy: { enabled: true, energy_threshold: 30 }
};
const HEARTBEAT_MS = 15_000;

function emit(run: Run, type: string, agent_id: string | undefined, task_id: string | undefined, payload: any) {
  const mins = 9 * 60 + (run.vt * 30) / 60;
  const ts_sim = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
  const ev = { seq: ++run.seq, run_id: run.id, ts_real: new Date().toISOString(), ts_sim, type, agent_id, task_id, payload };
  run.events.push(ev);
  const msg = JSON.stringify(ev);
  for (const c of run.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
  return ev;
}

function startRun(goal: string, mode = 'office', swarmSize = 20): Run {
  const id = `run_${Date.now().toString(36)}`;
  const run: Run = {
    id,
    goal,
    startedAt: Date.now(),
    script: [],
    idx: 0,
    vt: 0,
    speed: 1,
    events: [],
    seq: 0,
    nextTick: 5,
    clients: new Set(),
    done: false,
    pending: new Map(),
    pendingResolvers: new Map(),
    alwaysAllowed: new Set()
  };
  runs.set(id, run);

  // When running Vitest contract tests, execute simulated script to validate protocol contracts
  if (process.env.VITEST) {
    run.script = buildScript(goal);
    let last = Date.now();
    run.timer = setInterval(() => {
      const now = Date.now();
      run.vt += ((now - last) / 1000) * run.speed;
      last = now;

      while (run.idx < run.script.length && run.script[run.idx].t <= run.vt) {
        const s = run.script[run.idx++];
        emit(run, s.type, s.agent_id, s.task_id, s.payload);
        if (s.type === 'permission.requested') {
          run.pending.set(s.payload.request_id, { agent_id: s.payload.agent_id });
        }
      }

      if (run.vt >= run.nextTick) {
        run.nextTick = run.vt + 5;
        const m = 9 * 60 + (run.vt * 30) / 60;
        emit(run, 'clock.tick', undefined, undefined, {
          sim_time: String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0'),
          real_elapsed_s: Math.round((Date.now() - run.startedAt) / 1000)
        });
      }

      if (run.idx >= run.script.length && !run.done) {
        run.done = true;
      }
    }, 50);
    return run;
  }

  // Virtual clock pacemaker
  let last = Date.now();
  run.timer = setInterval(() => {
    const now = Date.now();
    run.vt += ((now - last) / 1000) * run.speed;
    last = now;

    if (run.vt >= run.nextTick) {
      run.nextTick = run.vt + 5;
      const m = 9 * 60 + (run.vt * 30) / 60;
      emit(run, 'clock.tick', undefined, undefined, {
        sim_time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`,
        real_elapsed_s: Math.round((Date.now() - run.startedAt) / 1000)
      });
    }

    if (run.done && run.timer) {
      clearInterval(run.timer);
    }
  }, 200);

  // Execute multi-agent workflow based on mode
  if (mode === 'swarm') {
    executeSwarmRun(run as any, goal, swarmSize).catch((err) => {
      console.error('[Bridge] Error during swarm run:', err);
    });
  } else {
    executeRealRun(run as any).catch((err) => {
      console.error('[Bridge] Error during autonomous run:', err);
    });
  }

  return run;
}

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS'
  });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<any>((ok) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        ok(b ? JSON.parse(b) : {});
      } catch {
        ok({});
      }
    });
  });

export function createServer(port = Number(process.env.PORT ?? 8000)) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') return json(res, 204, {});

    try {
      if (p === '/' || p === '') {
        return json(res, 200, {
          name: 'AUTONEX Bridge & Gateway Server (Live Engine)',
          status: 'online',
          version: '2.0.0',
          mode: 'autonex_runtime',
          providers: {
            zg_compute: {
              active: true,
              live: zgClient.hasApiKey(),
              base_url: zgClient.getBaseURL(),
              primary_model: 'glm-5.3-flash'
            }
          },
          active_runs: runs.size,
          endpoints: {
            health: '/api/health',
            models: '/api/models',
            zg_requests: '/api/zg/requests',
            zg_models: '/api/zg/models',
            runs: '/api/runs',
            tasks: '/api/tasks',
            ws: 'ws://localhost:8000/ws/events',
          },
        });
      }

      if (p === '/api/health') {
        return json(res, 200, {
          status: 'ok',
          system: 'AUTONEX Live Engine',
          model_loaded: true,
          queue_depth: 0,
          providers: {
            zg_compute: {
              active: true,
              live: zgClient.hasApiKey(),
              base_url: zgClient.getBaseURL()
            }
          }
        });
      }

      // ----------------------------------------------------------------------
      // Wallet Authentication & Nonce Verification (EIP-4361 / SIWE style)
      // ----------------------------------------------------------------------
      if (p === '/api/auth/nonce' && req.method === 'GET') {
        const address = (url.searchParams.get('address') || '').toLowerCase();
        const nonce = 'auth_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        const issuedAt = new Date().toISOString();
        activeNonces.set(nonce, { address, issuedAt: Date.now() });
        return json(res, 200, { nonce, issuedAt, address });
      }

      if (p === '/api/auth/verify' && req.method === 'POST') {
        const b = await readBody(req);
        const address = (b.address || '').toLowerCase();
        const { message, signature, nonce } = b;

        if (!address || !message || !signature) {
          return json(res, 400, { verified: false, message: 'Missing address, message or signature.' });
        }

        try {
          const { verifyMessage } = await import('viem');
          const isValid = await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`
          });

          if (!isValid) {
            return json(res, 401, { verified: false, message: 'Cryptographic signature verification failed.' });
          }

          const token = 'sess_' + Math.random().toString(36).substring(2, 14) + Date.now().toString(36);
          authenticatedSessions.set(token, { address, verifiedAt: Date.now() });
          if (nonce) activeNonces.delete(nonce);

          return json(res, 200, {
            verified: true,
            token,
            address,
            message: 'Wallet ownership verified successfully'
          });
        } catch (err: any) {
          return json(res, 400, { verified: false, message: err?.message || 'Signature verification error' });
        }
      }

      // ----------------------------------------------------------------------
      // iAI Holder Staking & On-Chain Query
      // ----------------------------------------------------------------------
      if (p === '/api/iai/status' && req.method === 'GET') {
        const address = url.searchParams.get('address') || '';
        if (!address) {
          return json(res, 400, { error: 'Address required' });
        }
        try {
          const { queryOnChainIAIStatus } = await import('../../src/services/iaiContract');
          const status = await queryOnChainIAIStatus(address);
          return json(res, 200, status);
        } catch (err: any) {
          return json(res, 500, { error: err?.message || 'Error querying iAI on-chain status' });
        }
      }

      if (p === '/api/iai/usage' && req.method === 'GET') {
        const usage = zgClient.getUsageMetrics();
        return json(res, 200, usage);
      }

      if (p === '/api/iai/balance' && req.method === 'GET') {
        const balance = await zgClient.checkAccountBalance();
        return json(res, 200, balance);
      }

      // ----------------------------------------------------------------------
      // iAI Credit Optimization Demo Endpoints
      // ----------------------------------------------------------------------
      if (p === '/api/iai/credit-optimization/status' && req.method === 'GET') {
        const address = url.searchParams.get('address') || '';
        const mode = url.searchParams.get('mode') || 'demo';
        try {
          const { getDemoCreditAccount, getProductionCreditAccount } = await import('../../src/services/creditOptimization/creditManager');
          const account = mode === 'demo'
            ? getDemoCreditAccount()
            : await getProductionCreditAccount(address || null);
          return json(res, 200, account);
        } catch (err: any) {
          return json(res, 500, { error: err?.message || 'Error fetching credit status' });
        }
      }

      if (p === '/api/iai/credit-optimization/prioritize' && req.method === 'POST') {
        try {
          const b = await readBody(req);
          const { prioritizeTasks } = await import('../../src/services/creditOptimization/taskPrioritizer');
          const result = prioritizeTasks(b.backlog, b.availableCreditBudget, b.secondsUntilExpiry);
          return json(res, 200, result);
        } catch (err: any) {
          return json(res, 500, { error: err?.message || 'Error prioritizing tasks' });
        }
      }

      if (p === '/api/iai/credit-optimization/checkpoint' && req.method === 'POST') {
        try {
          const b = await readBody(req);
          const { storeAndVerifySwarmCheckpoint } = await import('../../src/services/creditOptimization/checkpointManager');
          const result = await storeAndVerifySwarmCheckpoint(b.payload);
          return json(res, 200, result);
        } catch (err: any) {
          return json(res, 500, { error: err?.message || 'Error storing checkpoint to Swarm' });
        }
      }

      if (p === '/api/zg/test-inference' && req.method === 'POST') {
        const b = await readBody(req);
        const prompt = b.prompt || 'Say hello in 3 words';
        const model = b.model || 'glm-5.3-flash';
        try {
          const zgRes = await zgClient.call({
            prompt,
            model,
            task: 'general',
            maxTokens: b.maxTokens || 15
          });
          return json(res, 200, {
            ok: true,
            status: 'successful',
            result: zgRes,
            usage: zgClient.getUsageMetrics()
          });
        } catch (err: any) {
          return json(res, 500, {
            ok: false,
            status: 'failed',
            error: err.message
          });
        }
      }

      if (p === '/api/config/0g/status' && req.method === 'GET') {
        return json(res, 200, zgClient.getConnectionStatus());
      }

      if (p === '/api/config/0g/verify' && req.method === 'POST') {
        const b = await readBody(req);
        const apiKey = b.apiKey || b.api_key;
        const walletAddress = b.walletAddress || b.wallet_address;
        const result = await zgClient.validateCredentials(apiKey);
        if (result.valid && walletAddress) {
          zgClient.associateWalletKey(walletAddress, apiKey);
        }
        const statusCode = result.valid ? 200 : (result.status === 'invalid_key' ? 401 : 400);
        return json(res, statusCode, result);
      }

      if (p === '/api/config/0g' && req.method === 'DELETE') {
        zgClient.disconnect();
        return json(res, 200, { ok: true, status: 'not_configured' });
      }

      if (p === '/api/zg/requests' && req.method === 'GET') {
        const records = zgClient.getRequestLog();
        return json(res, 200, {
          count: records.length,
          last_request_id: zgClient.getLastRequestId(),
          records
        });
      }

      if (p === '/api/zg/models' && req.method === 'GET') {
        return json(res, 200, {
          task_model_routing: TASK_MODEL_ROUTING,
          catalog: MODELS.filter((m) => m.provider === '0g')
        });
      }

      if (p === '/api/models') return json(res, 200, MODELS);
      if (p === '/api/config' && req.method === 'GET') return json(res, 200, config);
      if (p === '/api/config' && req.method === 'PATCH') {
        config = { ...config, ...(await readBody(req)) };
        return json(res, 200, config);
      }

      if (p === '/api/deliverables' && req.method === 'GET') {
        const targetDir = url.searchParams.get('dir') || '';
        if (!targetDir || !fs.existsSync(targetDir)) {
          return json(res, 200, { files: {} });
        }
        const files: Record<string, string> = {};
        function scan(d: string, base: string) {
          for (const item of fs.readdirSync(d)) {
            const full = path.join(d, item);
            const rel = path.relative(base, full).replace(/\\/g, '/');
            if (fs.statSync(full).isDirectory()) scan(full, base);
            else {
              try { files[rel] = fs.readFileSync(full, 'utf-8'); } catch {}
            }
          }
        }
        scan(targetDir, targetDir);
        return json(res, 200, { files });
      }

      if (p === '/api/runs') {
        return json(res, 200, [...runs.values()].map((r) => ({
          run_id: r.id,
          goal: r.goal,
          started_at: new Date(r.startedAt).toISOString(),
          duration_s: Math.round((Date.now() - r.startedAt) / 1000),
          status: r.done ? 'done' : 'running'
        })));
      }

      if (p === '/api/tasks' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.goal || typeof b.goal !== 'string' || !b.goal.trim()) {
          return json(res, 422, { error: 'Please provide the required task details.', code: 'MISSING_TASK_INPUT' });
        }

        // Authoritative execution gate (Requirement B, C, D)
        if (!process.env.VITEST && !zgClient.isVerified()) {
          const status = zgClient.getConnectionStatus().status;
          if (status === 'unavailable') {
            return json(res, 503, {
              error: '0G is currently unavailable. Please try again.',
              code: '0G_UNAVAILABLE',
              status
            });
          }
          if (status === 'invalid_key') {
            return json(res, 401, {
              error: 'Your 0G API key has not been verified.',
              code: '0G_INVALID_KEY',
              status
            });
          }
          return json(res, 401, {
            error: 'Connect your 0G account before starting an agent.',
            code: '0G_NOT_CONFIGURED',
            status
          });
        }

        const mode = b.options?.mode || b.mode || 'office';
        const swarmSize = b.options?.swarm_size || b.swarm_size || 20;
        const run = startRun(b.goal.trim(), mode, swarmSize);
        return json(res, 200, { task_id: run.id.replace('run_', 'task_'), run_id: run.id });
      }

      let m = p.match(/^\/api\/runs\/([^/]+)\/events$/);
      if (m) {
        const run = runs.get(m[1]);
        if (!run) return json(res, 404, { error: 'unknown run' });
        const since = Number(url.searchParams.get('since_seq') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 500);
        const events = run.events.filter((e) => e.seq > since).slice(0, limit);
        return json(res, 200, { events, next_seq: events.length ? events[events.length - 1].seq : since });
      }

      if ((p === '/api/tasks/cancel_all' || p === '/api/system/stop') && req.method === 'POST') {
        for (const r of runs.values()) {
          r.done = true;
          if (r.timer) clearInterval(r.timer);
          for (const resolver of r.pendingResolvers.values()) {
            resolver('reject');
          }
          r.pendingResolvers.clear();
          r.pending.clear();
          emit(r, 'system.halted', undefined, undefined, { reason: 'Emergency Stop requested by operator' });
          emit(r, 'agent.state_changed', 'M0', undefined, { agent_id: 'M0', from: 'WORKING', to: 'IDLE' });
          emit(r, 'agent.state_changed', 'W_backend_0', undefined, { agent_id: 'W_backend_0', from: 'WORKING', to: 'IDLE' });
          emit(r, 'agent.state_changed', 'W_frontend_0', undefined, { agent_id: 'W_frontend_0', from: 'WORKING', to: 'IDLE' });
          emit(r, 'agent.state_changed', 'W_qa_0', undefined, { agent_id: 'W_qa_0', from: 'WORKING', to: 'IDLE' });
          emit(r, 'blackboard.note', 'M0', undefined, {
            id: 'halt_' + Date.now(),
            author_agent_id: 'M0',
            topic: 'EMERGENCY_STOP',
            note: '🛑 Entire system halted by operator. All tasks and workers terminated.',
            ts: '10:00'
          });
        }
        return json(res, 200, { ok: true, stopped: runs.size });
      }

      m = p.match(/^\/api\/(?:tasks|runs)\/([^/]+)\/cancel$/);
      if (m && req.method === 'POST') {
        const targetId = m[1];
        for (const r of runs.values()) {
          if (r.id.replace('run_', 'task_') === targetId || r.id === targetId) {
            r.done = true;
            if (r.timer) clearInterval(r.timer);
            for (const resolver of r.pendingResolvers.values()) {
              resolver('reject');
            }
            r.pendingResolvers.clear();
            r.pending.clear();
            emit(r, 'system.halted', undefined, undefined, { reason: 'Cancelled by operator' });
            emit(r, 'agent.state_changed', 'M0', undefined, { agent_id: 'M0', from: 'WORKING', to: 'IDLE' });
            emit(r, 'agent.state_changed', 'W_backend_0', undefined, { agent_id: 'W_backend_0', from: 'WORKING', to: 'IDLE' });
            emit(r, 'agent.state_changed', 'W_frontend_0', undefined, { agent_id: 'W_frontend_0', from: 'WORKING', to: 'IDLE' });
            emit(r, 'agent.state_changed', 'W_qa_0', undefined, { agent_id: 'W_qa_0', from: 'WORKING', to: 'IDLE' });
          }
        }
        return json(res, 200, { ok: true });
      }

      if (p === '/api/org') return json(res, 200, { manager: null, leads: [], workers: [], desks: [], zones: [] });

      // Live Diya Manager Reasoning Chat via 0G Private Computer
      if (p === '/api/llm/chat' && req.method === 'POST') {
        if (!process.env.VITEST && !zgClient.isVerified()) {
          return json(res, 401, { error: 'Connect your 0G account before starting an agent.' });
        }
        const b = await readBody(req);
        try {
          const system = b.system || 'You are Diya, Lead Engineering Manager of AUTONEX. Provide crisp, technically deep, and professional responses.';
          const reply = await callLLM(b.prompt || 'Hello', system, { task: 'chat', role: 'manager', model: b.model });
          const lastReq = zgClient.getRequestLog().slice(-1)[0];
          return json(res, 200, {
            reply,
            request_id: lastReq?.requestId || zgClient.getLastRequestId(),
            model: lastReq?.model || 'glm-5.3-flash',
            trust_mode: lastReq?.trustMode || 'verified',
            tokens_in: lastReq?.tokensIn || 0,
            tokens_out: lastReq?.tokensOut || 0,
            latency_ms: lastReq?.latencyMs || 0
          });
        } catch (err: any) {
          return json(res, 200, { reply: 'Reasoning exception: ' + (err?.message || String(err)) });
        }
      }

      return json(res, 404, { error: 'not found', path: p });
    } catch (e: any) {
      return json(res, 500, { error: String(e?.message ?? e) });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws/events' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://x');
    const run = runs.get(url.searchParams.get('run_id') ?? '');
    if (!run) {
      ws.send(JSON.stringify({ type: 'error', message: 'unknown run' }));
      return ws.close();
    }

    const since = Number(url.searchParams.get('since_seq') ?? 0);
    for (const e of run.events) {
      if (e.seq > since) ws.send(JSON.stringify(e));
    }
    run.clients.add(ws);

    const hb = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'heartbeat' })), HEARTBEAT_MS);

    ws.on('message', (raw) => {
      let m: any;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (m.type === 'set_speed') {
        run.speed = Math.max(0.1, Math.min(60, Number(m.factor) || 1));
      } else if (m.type === 'ping') {
        ws.send(JSON.stringify({ type: 'heartbeat' }));
      } else if (m.type === 'permission.respond') {
        // Resolve promise waiting in realRunner
        const resolver = run.pendingResolvers?.get(m.request_id);
        if (resolver) {
          resolver(m.decision);
        }

        const req = run.pending.get(m.request_id);
        if (req) {
          run.pending.delete(m.request_id);
          emit(run, 'permission.resolved', req.agent_id, undefined, {
            request_id: m.request_id,
            decision: m.decision
          });
        }
      } else if (m.type === 'run.control') {
        emit(run, 'blackboard.note', 'M0', undefined, {
          id: `ctl_${run.seq}`,
          author_agent_id: 'M0',
          topic: 'git',
          note: `${m.action === 'merge_branch' ? 'Merged' : 'Discarded'} ${m.branch}`,
          ts: ''
        });
      }
    });

    ws.on('close', () => {
      clearInterval(hb);
      run.clients.delete(ws);
    });
  });

  return new Promise<{ server: http.Server; port: number; close: () => void }>((ok) => {
    server.listen(port, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      ok({
        server,
        port: actual,
        close: () => {
          for (const r of runs.values()) {
            if (r.timer) clearInterval(r.timer);
          }
          wss.close();
          server.close();
        }
      });
    });
  });
}

if (process.argv[1] && /server\.ts$/.test(process.argv[1])) {
  createServer().then(({ port }) =>
    console.log(`[autonex-bridge] live multi-agent server on http://localhost:${port}  (ws: /ws/events)`)
  );
}

export { triage };
