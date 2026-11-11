import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZGInferenceClient } from '../../tools/mock-bridge/zgClient';
import { callLLM } from '../../tools/mock-bridge/realRunner';

describe('Step 5 & 6: 0G-Only Pipeline & Accurate UI Error Propagation', () => {
  let client: ZGInferenceClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.VITEST; // Test production strict error paths
    client = new ZGInferenceClient();
    client.setApiKey('0g_live_verified_key_test');
  });

  afterEach(() => {
    process.env.VITEST = 'true';
  });

  it('1. Centralized Routing: sends requests to official 0G router with Bearer auth', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': '0g_req_live_abc123'
      }),
      json: async () => ({
        id: 'chatcmpl-0g-real',
        model: 'thudm/glm-5.3-flash',
        choices: [{ message: { content: 'Decomposed 3-stage DAG architecture.' } }],
        usage: { prompt_tokens: 150, completion_tokens: 45 }
      })
    } as any);

    const res = await client.call({
      task: 'planning',
      prompt: 'Decompose task DAG'
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://router-api.0g.ai/v1/chat/completions');
    expect((init.headers as any)['Authorization']).toBe('Bearer 0g_live_verified_key_test');
    expect(res.isLive0G).toBe(true);
    expect(res.requestId).toBe('0g_req_live_abc123');
    expect(res.content).toBe('Decomposed 3-stage DAG architecture.');
  });

  it('2. Model Routing: selects approved 0G models for planning, coding, and QA', async () => {
    const recordedModels: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      recordedModels.push(body.model);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'x-request-id': `0g_req_${recordedModels.length}` }),
        json: async () => ({ choices: [{ message: { content: 'verified output' } }] })
      } as any;
    });

    await client.call({ task: 'planning', prompt: 'Plan project' });
    await client.call({ task: 'code', prompt: 'Write function' });
    await client.call({ task: 'qa', prompt: 'Generate tests' });

    expect(recordedModels[0]).toBe('glm-5.3-flash');
    expect(recordedModels[1]).toBe('qwen3-coder-flash');
    expect(recordedModels[2]).toBe('kimi-k2.7-code');
  });

  it('3. Error Propagation: throws real 0G 401 error and does NOT fall back to mocks', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'x-request-id': '0g_err_401' }),
      text: async () => JSON.stringify({ error: { message: 'Unauthorized: Invalid token' } })
    } as any);

    await expect(
      client.call({ model: 'qwen3-coder-flash', task: 'code', prompt: 'Implement backend module' })
    ).rejects.toThrow(/0G Authentication Error \(401\)/);
  });

  it('4. Rate Limit Propagation: throws 429 error without conversion to success', { timeout: 15000 }, async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'x-request-id': '0g_err_429', 'retry-after': '1' }),
      text: async () => JSON.stringify({ error: { message: 'Rate limit exceeded' } })
    } as any);

    await expect(
      client.call({ task: 'general', prompt: 'Test rate limit' })
    ).rejects.toThrow(/429/);
  });

  it('5. Insufficient Balance Propagation: throws 402 insufficient credits error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 402,
      headers: new Headers({ 'x-request-id': '0g_err_402' }),
      text: async () => JSON.stringify({ error: { message: 'Out of credits' } })
    } as any);

    await expect(
      client.call({ model: 'glm-5.3-flash', task: 'chat', prompt: 'Check balance failure' })
    ).rejects.toThrow(/Insufficient 0G credits/);
  });

  it('6. Missing API Key: rejects in production without calling any alternate provider', async () => {
    client.disconnect();

    await expect(
      client.call({ task: 'planning', prompt: 'Plan without key' })
    ).rejects.toThrow(/0G Private Computer API key is not configured/);
  });
});
