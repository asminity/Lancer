import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../tools/mock-bridge/server';
import { zgClient } from '../../tools/mock-bridge/zgClient';

describe('AUTONEX Execution Guards & Open Office Validation', () => {
  let bridge: { server: any; port: number; close: () => void };
  let baseUrl: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    zgClient.disconnect();

    // Disable VITEST bypass during these guard checks to test real production enforcement
    delete process.env.VITEST;

    const testPort = 8011 + Math.floor(Math.random() * 100);
    bridge = await createServer(testPort);
    baseUrl = `http://localhost:${bridge.port}`;
  });

  afterEach(() => {
    process.env.VITEST = 'true';
    if (bridge) {
      bridge.close();
    }
  });

  it('Guard 1: No API key blocks execution with 401', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Build a payment microservice' })
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Connect your 0G account before starting an agent.');
    expect(body.code).toBe('0G_NOT_CONFIGURED');
  });

  it('Guard 2: Missing task input (empty goal) blocks execution with 422', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: '   ' })
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Please provide the required task details.');
    expect(body.code).toBe('MISSING_TASK_INPUT');
  });

  it('Guard 3: Invalid / unverified API key blocks execution with 401', async () => {
    zgClient.setApiKey('invalid_fake_key_123');

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Analyze security logs' })
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Connect your 0G account before starting an agent.');
  });

  it('Guard 4: Chat endpoint also blocks unverified execution with 401', async () => {
    const res = await fetch(`${baseUrl}/api/llm/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Hello manager Diya' })
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Connect your 0G account before starting an agent.');
  });

  it('Guard 5: Valid configuration and complete input permits execution', async () => {
    const originalFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      if (typeof url === 'string' && url.includes('router-api.0g.ai')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-request-id': '0g_test_req_999' }),
          json: async () => ({ id: 'chatcmpl-test', choices: [{ message: { content: 'pong' } }] })
        } as any;
      }
      return originalFetch(url, init);
    });

    const verifyResult = await zgClient.validateCredentials('0g_valid_test_secret_key');
    expect(verifyResult.valid).toBe(true);
    expect(zgClient.isVerified()).toBe(true);

    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Refactor high-concurrency event stream' })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task_id).toBeDefined();
    expect(body.run_id).toBeDefined();
  });
});
