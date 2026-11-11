import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZGInferenceClient } from '../../tools/mock-bridge/zgClient';

describe('0G Private Computer Real Credential & Configuration Validation', () => {
  let client: ZGInferenceClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new ZGInferenceClient();
  });

  it('1. Not Configured: rejects validation when empty key is provided', async () => {
    const res = await client.validateCredentials('');
    expect(res.valid).toBe(false);
    expect(res.status).toBe('not_configured');
    expect(res.message).toContain('No 0G API Key provided');
    expect(client.isVerified()).toBe(false);
  });

  it('2. Invalid Key (401): correctly classifies 401 response from 0G router', async () => {
    // Mock fetch returning 401 from 0G router
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': '0d6057577341495d'
      }),
      json: async () => ({
        error: { message: 'Invalid authentication token', type: 'invalid_request_error', code: 'invalid_auth' }
      }),
      text: async () => JSON.stringify({ error: { message: 'Invalid authentication token' } })
    } as any);

    const res = await client.validateCredentials('invalid_key_sample_123');
    expect(res.valid).toBe(false);
    expect(res.status).toBe('invalid_key');
    expect(res.message).toContain('authentication failed (401)');
    expect(client.isVerified()).toBe(false);
  });

  it('3. Service Unavailable: handles timeout or network failure gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'));

    const res = await client.validateCredentials('any_key_sample');
    expect(res.valid).toBe(false);
    expect(res.status).toBe('unavailable');
    expect(res.message).toContain('0G service unavailable');
    expect(client.isVerified()).toBe(false);
  });

  it('4. Successful Verification: validates against 0G, captures request ID, and sets verified state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': '7bbfce6d7fc429fa'
      }),
      json: async () => ({
        id: 'chatcmpl-0g-real-7788',
        choices: [{ message: { content: 'pong' } }]
      })
    } as any);

    const validKey = '0g_live_secret_key_987654321';
    const res = await client.validateCredentials(validKey);

    expect(res.valid).toBe(true);
    expect(res.status).toBe('connected');
    expect(res.requestId).toBe('7bbfce6d7fc429fa');
    expect(client.isVerified()).toBe(true);
    expect(client.getConnectionStatus().status).toBe('connected');
  });

  it('5. Secure Masking: never leaks the raw API key in masked outputs or logs', async () => {
    const rawKey = '0g_live_super_secret_credentials_1234';
    client.setApiKey(rawKey);

    const masked = client.getMaskedKey();
    expect(masked).toBeDefined();
    expect(masked).not.toBe(rawKey);
    expect(masked).toContain('••••');
    // Ensure the raw middle secret is completely hidden
    expect(masked).not.toContain('super_secret_credentials');
    expect(masked).toBe('0g_l••••••••1234');
  });

  it('6. Disconnect Functionality: wipes credentials and resets verified state', async () => {
    client.setApiKey('0g_test_key_abc');
    expect(client.hasApiKey()).toBe(true);

    client.disconnect();

    expect(client.hasApiKey()).toBe(false);
    expect(client.isVerified()).toBe(false);
    expect(client.getMaskedKey()).toBeNull();
    expect(client.getConnectionStatus().status).toBe('not_configured');
  });

  it('7. Authoritative Execution Gate: execution requires verified state', () => {
    expect(client.isVerified()).toBe(false);

    // Setting a key without verification is insufficient (Requirement D)
    client.setApiKey('unverified_key');
    expect(client.isVerified()).toBe(false);
  });
});

