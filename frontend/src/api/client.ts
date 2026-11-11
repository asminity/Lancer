import { Envelope } from './types';

export interface ApiClient {
  createTask(goal: string, model?: string, options?: { max_workers?: number }): Promise<{ task_id: string; run_id: string }>;
  getTask(id: string): Promise<any>;
  cancelTask(id: string): Promise<{ ok: boolean }>;
  getDag(id: string): Promise<{ nodes: any[]; edges: { from: string; to: string }[] }>;
  getResult(id: string): Promise<any>;
  getOrg(): Promise<any>;
  getAgent(id: string): Promise<any>;
  getAgentOutputs(id: string): Promise<any[]>;
  getBlackboard(runId?: string): Promise<any[]>;
  getMetrics(runId?: string): Promise<any>;
  getModels(): Promise<any[]>;
  getConfig(): Promise<any>;
  patchConfig(patch: any): Promise<any>;
  getRuns(): Promise<any[]>;
  getEvents(runId: string, sinceSeq: number, limit: number): Promise<{ events: Envelope[]; next_seq: number }>;
  health(): Promise<boolean>;
  get0GStatus(): Promise<{ status: string; isVerified: boolean; maskedKey: string | null; lastVerifiedAt: string | null; lastRequestId: string | null }>;
  verify0GKey(apiKey: string): Promise<{ valid: boolean; status: string; message: string; maskedKey?: string; requestId?: string }>;
  disconnect0G(): Promise<{ ok: boolean; status: string }>;
  getAuthNonce(address: string): Promise<{ nonce: string; issuedAt: string; address: string }>;
  verifyAuth(address: string, signature: string, message: string, nonce: string): Promise<{ verified: boolean; token: string; message: string }>;
  getIAIStatus(address: string): Promise<any>;
  getIAIUsage(): Promise<any>;
  test0GInference(prompt?: string): Promise<any>;
}
export interface EventStream {
  start(runId: string, sinceSeq: number, onEvent: (e: Envelope) => void): void;
  stop(): void;
  setSpeed(f: number): void;
  send(msg: any): void;
}

// FIX F19: also read process.env when present (vitest / node tooling); in the browser `process` is undefined -> unchanged.
const env = (k: string): string | undefined =>
  (import.meta as any).env?.[k] ?? (typeof process !== 'undefined' ? process.env?.[k] : undefined);
export const API_URL = env('VITE_API_URL') ?? '';
export const apiUrl = (path: string) => `${API_URL}${path}`;
// Default to built-in simulation engine unless explicitly configured with VITE_USE_MOCK=false
export const USE_MOCK = env('VITE_USE_MOCK') !== 'false';

export class HttpClient implements ApiClient {
  private base = API_URL;
  private async req(path: string, init?: RequestInit) {
    const r = await fetch(apiUrl(path), { headers: { 'Content-Type': 'application/json' }, ...init });
    if (!r.ok) {
      let errJson: any = null;
      try { errJson = await r.json(); } catch {}
      const errMsg = errJson?.error || errJson?.message || `${path} -> ${r.status}`;
      throw new Error(errMsg);
    }
    return r.json();
  }
  createTask(goal: string, model?: string, options?: any) {
    return this.req('/api/tasks', { method: 'POST', body: JSON.stringify({ goal, model, options }) });
  }
  getTask(id: string) { return this.req(`/api/tasks/${id}`); }
  cancelTask(id: string) { return this.req(`/api/tasks/${id}/cancel`, { method: 'POST' }); }
  getDag(id: string) { return this.req(`/api/tasks/${id}/dag`); }
  getResult(id: string) { return this.req(`/api/tasks/${id}/result`); }
  getOrg() { return this.req('/api/org'); }
  getAgent(id: string) { return this.req(`/api/agents/${id}`); }
  getAgentOutputs(id: string) { return this.req(`/api/agents/${id}/outputs`); }
  getBlackboard(runId?: string) { return this.req(`/api/blackboard?run_id=${runId ?? ''}`); }
  getMetrics(runId?: string) { return this.req(`/api/metrics?run_id=${runId ?? ''}`); }
  getModels() { return this.req('/api/models'); }
  getConfig() { return this.req('/api/config'); }
  patchConfig(patch: any) { return this.req('/api/config', { method: 'PATCH', body: JSON.stringify(patch) }); }
  getRuns() { return this.req('/api/runs'); }
  getEvents(runId: string, sinceSeq: number, limit: number) {
    return this.req(`/api/runs/${runId}/events?since_seq=${sinceSeq}&limit=${limit}`);
  }
  async health() { try { const r = await fetch(apiUrl('/api/health')); return r.ok; } catch { return false; } }
  get0GStatus() {
    return this.req('/api/config/0g/status');
  }
  verify0GKey(apiKey: string) {
    return this.req('/api/config/0g/verify', { method: 'POST', body: JSON.stringify({ apiKey }) });
  }
  disconnect0G() {
    return this.req('/api/config/0g', { method: 'DELETE' });
  }
  getAuthNonce(address: string) {
    return this.req(`/api/auth/nonce?address=${encodeURIComponent(address)}`);
  }
  verifyAuth(address: string, signature: string, message: string, nonce: string) {
    return this.req('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address, signature, message, nonce }) });
  }
  getIAIStatus(address: string) {
    return this.req(`/api/iai/status?address=${encodeURIComponent(address)}`);
  }
  getIAIUsage() {
    return this.req('/api/iai/usage');
  }
  test0GInference(prompt?: string) {
    return this.req('/api/zg/test-inference', { method: 'POST', body: JSON.stringify({ prompt }) });
  }
}

export class HttpStream implements EventStream {
  private ws: WebSocket | null = null;
  private onEvent: ((e: Envelope) => void) | null = null;
  private lastSeq = 0;
  private retry = 0;
  private closed = false;
  start(runId: string, sinceSeq: number, onEvent: (e: Envelope) => void) {
    this.onEvent = onEvent; this.lastSeq = sinceSeq; this.closed = false;
    this.connect(runId, sinceSeq);
  }
  private connect(runId: string, sinceSeq: number) {
    const url = API_URL
      ? API_URL.replace(/^http/, 'ws') + `/ws/events?run_id=${runId}&since_seq=${sinceSeq}`
      : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/events?run_id=${runId}&since_seq=${sinceSeq}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.retry = 0; this.send({ type: 'subscribe', run_id: runId }); };
    this.ws.onmessage = (m) => {
      try {
        const d = JSON.parse(m.data);
        if (d.type === 'heartbeat') return;
        if (d.seq != null) { if (d.seq <= this.lastSeq) return; this.lastSeq = d.seq; }
        this.onEvent?.(d as Envelope);
      } catch { /* ignore */ }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => !this.closed && this.connect(runId, this.lastSeq), 300 * 2 ** this.retry);
    };
  }
  stop() { this.closed = true; this.ws?.close(); this.ws = null; }
  setSpeed(f: number) { this.send({ type: 'set_speed', factor: f }); }
  send(msg: any) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
}
