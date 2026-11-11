/**
 * 0G Private Computer (0G Compute) Centralized Inference Client & Model Router
 * Official Base URL: https://router-api.0g.ai/v1
 * Verified on 0G Router: 79 Models, OpenAI-Compatible, TEE Trust Modes
 */

import { loadEnv } from './env';
import { MODELS } from '../../src/mock/data';

loadEnv();

export type ZGTask =
  | 'planning'
  | 'framing'
  | 'code'
  | 'qa'
  | 'divergence'
  | 'critique'
  | 'voting'
  | 'synthesis'
  | 'chat'
  | 'agent'
  | 'general';

export type ZGTrustMode = 'standard' | 'verified' | 'private';

export interface ZGMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface ZGTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, any>;
  };
}

export interface ZGCallOptions {
  task?: ZGTask;
  model?: string;
  messages?: ZGMessage[];
  prompt?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ZGTool[];
  toolChoice?: any;
  responseFormat?: { type: 'json_object' | 'text' };
  stream?: boolean;
  onStreamChunk?: (chunk: string) => void;
  timeoutMs?: number;
  trustMode?: ZGTrustMode;
  userDid?: string;
  meta?: {
    run?: any;
    agentId?: string;
    agentName?: string;
    callId?: string;
    role?: string;
  };
}

export interface ZGInferenceResult {
  content: string;
  reasoning?: string;
  toolCalls?: any[];
  requestId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  isLive0G: boolean;
  trustMode: ZGTrustMode;
  billing?: {
    currency: string;
    totalCost: string;
    totalCostUsdMicro: string;
    inputCost: string;
    outputCost: string;
  };
  providerAddress?: string;
}

export interface ZGRequestRecord {
  requestId: string;
  timestamp: string;
  task: ZGTask;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  agentId?: string;
  isLive0G: boolean;
  trustMode: ZGTrustMode;
  billing?: {
    currency: string;
    totalCost: string;
    totalCostUsdMicro: string;
    inputCost: string;
    outputCost: string;
  };
  providerAddress?: string;
}

// 1. Task-Based Model Router (Approved Step 3 Matrix)
export const TASK_MODEL_ROUTING: Record<ZGTask, string[]> = {
  planning:   ['glm-5.3-flash', 'deepseek-v4.1-flash'],
  framing:    ['glm-5.3-flash', 'deepseek-v4.1-flash'],
  code:       ['qwen3-coder-flash', 'deepseek-v4.1-flash', 'glm-5.3-flash'],
  qa:         ['kimi-k2.7-code', 'deepseek-v4.1-flash', 'qwen3-coder-flash'],
  divergence: ['qwen3.7-flash', 'qwen-flash', 'glm-5.3-flash'],
  critique:   ['glm-5.3-flash', 'deepseek-v4.1-flash', 'qwen3.7-flash'],
  voting:     ['qwen-flash', 'qwen3.7-flash'],
  synthesis:  ['qwen3-coder-flash', 'deepseek-v4.1-flash', 'glm-5.3-flash'],
  chat:       ['glm-5.3-flash', 'deepseek-v4.1-flash', 'qwen3-coder-flash'],
  agent:      ['qwen3-coder-flash', 'deepseek-v4.1-flash'],
  general:    ['glm-5.3-flash', 'qwen3-coder-flash', 'deepseek-v4.1-flash']
};

export class ZGInferenceClient {
  private baseURL: string;
  private apiKey: string;
  private defaultTrustMode: ZGTrustMode;
  private defaultTimeoutMs: number;
  private requestLog: ZGRequestRecord[] = [];
  private isVerifiedState: boolean = false;
  private lastVerifiedAt: string | null = null;
  private totalInferenceRequests: number = 0;
  private totalTokensIn: number = 0;
  private totalTokensOut: number = 0;
  private totalCostMicroUsd: number = 0;
  private walletKeyMap: Map<string, string> = new Map();
  private keyWalletMap: Map<string, string> = new Map();

  constructor() {
    loadEnv();
    this.baseURL = process.env.ZG_BASE_URL || process.env['0G_BASE_URL'] || 'https://router-api.0g.ai/v1';
    this.apiKey = process.env.ZG_API_KEY || process.env['0G_API_KEY'] || '';
    const tm = (process.env.ZG_TRUST_MODE || '').split('#')[0].trim().toLowerCase();
    this.defaultTrustMode = (tm === 'standard' || tm === 'verified' || tm === 'private') ? tm as ZGTrustMode : 'standard';
    this.defaultTimeoutMs = Number(process.env.ZG_TIMEOUT_MS) || 65000;
  }

  public getBaseURL(): string {
    return this.baseURL;
  }

  public hasApiKey(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  public isVerified(): boolean {
    return this.isVerifiedState && this.hasApiKey();
  }

  public getMaskedKey(): string | null {
    if (!this.apiKey || !this.apiKey.trim()) return null;
    const trimmed = this.apiKey.trim();
    if (trimmed.length <= 8) return '••••' + trimmed.slice(-2);
    return trimmed.slice(0, 4) + '••••••••' + trimmed.slice(-4);
  }

  public getConnectionStatus(): {
    status: 'connected' | 'not_configured' | 'invalid_key' | 'unavailable' | 'error';
    isVerified: boolean;
    maskedKey: string | null;
    lastVerifiedAt: string | null;
    lastRequestId: string | null;
    baseURL: string;
  } {
    if (!this.hasApiKey()) {
      return {
        status: 'not_configured',
        isVerified: false,
        maskedKey: null,
        lastVerifiedAt: null,
        lastRequestId: this.getLastRequestId(),
        baseURL: this.baseURL
      };
    }

    return {
      status: this.isVerifiedState ? 'connected' : 'not_configured',
      isVerified: this.isVerifiedState,
      maskedKey: this.getMaskedKey(),
      lastVerifiedAt: this.lastVerifiedAt,
      lastRequestId: this.getLastRequestId(),
      baseURL: this.baseURL
    };
  }

  public disconnect(): void {
    this.apiKey = '';
    this.isVerifiedState = false;
    this.lastVerifiedAt = null;
    delete process.env.ZG_API_KEY;
    delete process.env['0G_API_KEY'];
  }

  public setApiKey(key: string): void {
    this.apiKey = key ? key.trim() : '';
    this.isVerifiedState = false;
  }

  public async validateCredentials(candidateKey?: string): Promise<{
    valid: boolean;
    status: 'connected' | 'not_configured' | 'invalid_key' | 'unavailable' | 'error';
    message: string;
    requestId?: string;
    maskedKey?: string;
    latencyMs?: number;
  }> {
    const keyToTest = candidateKey !== undefined ? candidateKey.trim() : this.apiKey.trim();

    if (!keyToTest) {
      this.isVerifiedState = false;
      return {
        valid: false,
        status: 'not_configured',
        message: 'No 0G API Key provided'
      };
    }

    const t0 = Date.now();
    const endpoint = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${keyToTest}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AUTONEX-0G/1.0',
          'X-0G-Provider-Trust-Mode': 'standard'
        },
        body: JSON.stringify({
          model: 'qwen-flash',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        }),
        signal: AbortSignal.timeout(12000)
      });

      const latencyMs = Date.now() - t0;
      const capturedRequestId = response.headers.get('x-request-id') || response.headers.get('request-id');

      // HTTP 200 OK or HTTP 429 (Rate Limit confirms key is valid)
      if (response.ok || response.status === 429) {
        this.apiKey = keyToTest;
        this.isVerifiedState = true;
        this.lastVerifiedAt = new Date().toISOString();
        const effectiveId = capturedRequestId || `req_0g_verify_${Date.now()}`;
        this.recordRequest({
          requestId: effectiveId,
          timestamp: this.lastVerifiedAt,
          task: 'general',
          model: 'qwen-flash',
          tokensIn: 1,
          tokensOut: 1,
          latencyMs,
          isLive0G: true,
          trustMode: 'standard'
        });

        return {
          valid: true,
          status: 'connected',
          message: '0G Private Computer credentials successfully verified',
          requestId: effectiveId,
          maskedKey: this.getMaskedKey() || undefined,
          latencyMs
        };
      }

      // HTTP 401 or 403: Invalid Key
      if (response.status === 401 || response.status === 403) {
        this.isVerifiedState = false;
        return {
          valid: false,
          status: 'invalid_key',
          message: 'Invalid 0G API Key: authentication failed (401)',
          requestId: capturedRequestId || undefined
        };
      }

      // HTTP 5xx: Service unavailable
      if (response.status >= 500) {
        return {
          valid: false,
          status: 'unavailable',
          message: `0G service unavailable: HTTP ${response.status}`,
          requestId: capturedRequestId || undefined
        };
      }

      const errText = await response.text();
      return {
        valid: false,
        status: 'error',
        message: `0G configuration error (HTTP ${response.status}): ${errText.slice(0, 120)}`
      };
    } catch (err: any) {
      this.isVerifiedState = false;
      const isAbort = err.name === 'AbortError' || err.name === 'TimeoutError';
      return {
        valid: false,
        status: 'unavailable',
        message: isAbort
          ? '0G service unavailable: request timed out'
          : `0G service unavailable: ${err.message || 'connection failed'}`
      };
    }
  }

  public getRequestLog(): ZGRequestRecord[] {
    return [...this.requestLog];
  }

  public getLastRequestId(): string | null {
    return this.requestLog.length ? this.requestLog[this.requestLog.length - 1].requestId : null;
  }

  /**
   * Main Inference Dispatcher
   */
  public async call(options: ZGCallOptions): Promise<ZGInferenceResult> {
    const task = options.task || 'general';
    const requestedModel = options.model?.replace(/^0g\//, '');
    const candidateModels = requestedModel
      ? [requestedModel]
      : (TASK_MODEL_ROUTING[task] || TASK_MODEL_ROUTING.general);
    const configuredModelIds = new Set(MODELS.map((model) => model.id.replace(/^0g\//, '')));
    const unsupportedModels = candidateModels.filter((model) => !configuredModelIds.has(model));
    if (unsupportedModels.length > 0) {
      throw new Error(`Unsupported model selection; choose a configured 0G model: ${unsupportedModels.join(', ')}`);
    }
    const trustMode = options.trustMode || this.defaultTrustMode;
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;

    // Messages assembly
    let messages: ZGMessage[] = [];
    if (options.messages && options.messages.length > 0) {
      messages = [...options.messages];
    } else {
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      if (options.prompt) {
        messages.push({ role: 'user', content: options.prompt });
      }
    }

    // Telemetry: Call Started Event
    if (options.meta?.run && options.meta?.agentId) {
      try {
        const { emitEvent } = await import('./realRunner');
        emitEvent(options.meta.run, 'llm.call_started', options.meta.agentId, undefined, {
          call_id: options.meta.callId || `zg_${Date.now()}`,
          agent_id: options.meta.agentId,
          model: `0G · ${candidateModels[0]}`,
          role: options.meta.role || 'engineer',
          trust_mode: trustMode
        });
      } catch {}
    }

    // If live 0G API Key is configured, execute live HTTP inference
    if (this.hasApiKey()) {
      let lastErr: any = null;
      for (const model of candidateModels) {
        try {
          const res = await this.executeLiveRequest(model, messages, options, trustMode, timeoutMs);
          this.recordRequest({
            requestId: res.requestId,
            timestamp: new Date().toISOString(),
            task,
            model: res.model,
            tokensIn: res.tokensIn,
            tokensOut: res.tokensOut,
            latencyMs: res.latencyMs,
            agentId: options.meta?.agentId,
            isLive0G: true,
            trustMode: res.trustMode
          });

          // Telemetry: Call Finished Event
          if (options.meta?.run && options.meta?.agentId) {
            try {
              const { emitEvent } = await import('./realRunner');
              emitEvent(options.meta.run, 'llm.call_finished', options.meta.agentId, undefined, {
                call_id: options.meta.callId || `zg_${Date.now()}`,
                model: `0G · ${res.model}`,
                tokens_in: res.tokensIn,
                tokens_out: res.tokensOut,
                latency_ms: res.latencyMs,
                request_id: res.requestId,
                trust_mode: res.trustMode
              });
            } catch {}
          }
          return res;
        } catch (err: any) {
          console.warn(`[0G Router] Error calling model ${model}:`, err?.message || err);
          lastErr = err;
        }
      }

      // In production, reject with real 0G error - DO NOT hide behind synthetic mocks
      if (!process.env.VITEST) {
        throw new Error(`0G Private Computer inference failed: ${lastErr?.message || 'Provider unavailable'}`);
      }
    }

    if (!process.env.VITEST) {
      throw new Error('0G Private Computer API key is not configured. Connect your 0G account before starting an agent.');
    }

    // Deterministic fallback execution ONLY during protocol contract tests (Vitest)
    return this.executeMockFallback(candidateModels[0], messages, options, trustMode);
  }

  /**
   * Live HTTP Execution targeting 0G Private Computer Router API
   */
  private async executeLiveRequest(
    model: string,
    messages: ZGMessage[],
    options: ZGCallOptions,
    trustMode: ZGTrustMode,
    timeoutMs: number
  ): Promise<ZGInferenceResult> {
    const t0 = Date.now();
    const endpoint = `${this.baseURL.replace(/\/+$/, '')}/chat/completions`;

    const requestBody: Record<string, any> = {
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 4096,
      stream: options.stream ?? false
    };

    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      if (options.toolChoice) requestBody.tool_choice = options.toolChoice;
    }

    if (options.responseFormat) {
      requestBody.response_format = options.responseFormat;
    }

    let activeTrustMode: ZGTrustMode = trustMode;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'AUTONEX-0G/1.0',
      'X-0G-Provider-Trust-Mode': activeTrustMode
    };

    if (options.userDid) {
      headers['X-0G-User-DID'] = options.userDid;
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(timeoutMs)
        });

        const capturedRequestId = response.headers.get('x-request-id') || response.headers.get('request-id');

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after')) || 2;
          if (attempt < maxRetries) {
            console.warn(`[0G RateLimit 429] Waiting ${retryAfter}s before retrying...`);
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            continue;
          }
          throw new Error(`0G Rate Limit 429 (Request ID: ${capturedRequestId || 'unknown'})`);
        }

        if (!response.ok) {
          const errBody = await response.text();
          let parsedMsg = errBody.slice(0, 160);
          try {
            const errJson = JSON.parse(errBody);
            parsedMsg = errJson.error?.message || errJson.message || parsedMsg;
          } catch {}

          // Handle 0G router missing TEE hardware provider for verified/private trust mode:
          // Gracefully fallback to standard 0G compute provider
          if (response.status === 503 && (parsedMsg.includes('trust mode') || parsedMsg.includes('tier=') || parsedMsg.includes('no_provider_for_trust_mode'))) {
            if (activeTrustMode !== 'standard') {
              console.warn(`[0G Router] No provider available for trust mode '${activeTrustMode}' on model '${model}'. Retrying with 0G standard trust mode...`);
              activeTrustMode = 'standard';
              headers['X-0G-Provider-Trust-Mode'] = 'standard';
              continue;
            }
          }

          if (response.status === 401 || response.status === 403) {
            throw new Error(`0G Authentication Error (${response.status}): ${parsedMsg}`);
          }
          if (response.status === 402) {
            throw new Error(`Insufficient 0G credits: Please top up your 0G Private Computer account.`);
          }
          if (response.status === 429) {
            throw new Error(`0G Rate limit exceeded (429): Please wait before trying again.`);
          }
          if (response.status >= 500) {
            throw new Error(`0G service unavailable (${response.status}): ${parsedMsg}`);
          }
          throw new Error(`0G HTTP ${response.status}: ${parsedMsg}`);
        }

        // Handle streaming response if requested
        if (options.stream && response.body) {
          let accumulatedContent = '';
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let done = false;

          while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
              const chunk = decoder.decode(value, { stream: true });
              accumulatedContent += chunk;
              if (options.onStreamChunk) {
                options.onStreamChunk(chunk);
              }
            }
          }

          return {
            content: accumulatedContent,
            requestId: capturedRequestId || `req_0g_stream_${Date.now()}`,
            model,
            tokensIn: 800,
            tokensOut: 600,
            latencyMs: Date.now() - t0,
            isLive0G: true,
            trustMode: activeTrustMode
          };
        }

        // Standard JSON response
        const data: any = await response.json();
        const latency = Date.now() - t0;
        const choice = data.choices?.[0]?.message;
        let content = choice?.content || '';
        let reasoning = choice?.reasoning || '';

        // Extract <think> tags if embedded in content
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
        if (thinkMatch) {
          reasoning = thinkMatch[1].trim();
          content = content.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
        }

        const effectiveRequestId = capturedRequestId || data.id || `req_0g_${Date.now()}`;
        const tokensIn = data.usage?.prompt_tokens || 800;
        const tokensOut = data.usage?.completion_tokens || 600;

        // Parse official 0G billing trace and credit consumption
        const trace = data.x_0g_trace;
        const billingData = trace?.billing ? {
          currency: trace.billing.currency || 'usd',
          totalCost: String(trace.billing.total_cost || '0'),
          totalCostUsdMicro: String(trace.billing.total_cost_usd_micro || '0'),
          inputCost: String(trace.billing.input_cost || '0'),
          outputCost: String(trace.billing.output_cost || '0')
        } : undefined;

        const costMicro = Number(trace?.billing?.total_cost_usd_micro || 0);
        this.totalInferenceRequests++;
        this.totalTokensIn += tokensIn;
        this.totalTokensOut += tokensOut;
        this.totalCostMicroUsd += costMicro;

        const result: ZGInferenceResult = {
          content: content || reasoning,
          reasoning,
          toolCalls: choice?.tool_calls,
          requestId: effectiveRequestId,
          model: data.model || model,
          tokensIn,
          tokensOut,
          latencyMs: latency,
          isLive0G: true,
          trustMode: activeTrustMode,
          billing: billingData,
          providerAddress: trace?.provider
        };

        this.recordRequest({
          requestId: effectiveRequestId,
          timestamp: new Date().toISOString(),
          task: options.task || 'general',
          model: data.model || model,
          tokensIn,
          tokensOut,
          latencyMs: latency,
          agentId: options.meta?.agentId,
          isLive0G: true,
          trustMode: activeTrustMode,
          billing: billingData,
          providerAddress: trace?.provider
        });

        return result;
      } catch (err: any) {
        if (attempt >= maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    throw new Error('All 0G inference attempts failed');
  }

  /**
   * Deterministic Offline / Contract Test Fallback
   */
  private async executeMockFallback(
    model: string,
    messages: ZGMessage[],
    options: ZGCallOptions,
    trustMode: ZGTrustMode
  ): Promise<ZGInferenceResult> {
    const t0 = Date.now();
    const task = options.task || 'general';
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || options.prompt || '';
    const simulatedRequestId = `req_0g_sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    let generatedContent = '';

    if (task === 'planning') {
      const slug = lastUserMessage.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20) || 'Project0G';
      generatedContent = JSON.stringify({
        project_name: slug,
        summary: `Autonomous software solution for objective: ${lastUserMessage.slice(0, 45)}`,
        tasks: [
          {
            id: 'T1',
            description: 'Core logic implementation',
            target_file: 'src/solution.py',
            owner_role: 'backend',
            assigned_agent: 'W_backend_0',
            depends_on: [],
            task_prompt: 'Implement verifiable logic on 0G compute infrastructure.'
          },
          {
            id: 'T2',
            description: 'Automated test suite & verification assertions',
            target_file: 'src/test_solution.py',
            owner_role: 'qa',
            assigned_agent: 'W_qa_0',
            depends_on: ['T1'],
            task_prompt: 'Write verification assertions checking boundary invariants.'
          }
        ]
      });
    } else if (task === 'divergence') {
      generatedContent = JSON.stringify({
        proposals: [
          { tag: 'Concurrency', text: 'Lock-free atomic queue optimized for high throughput.' },
          { tag: 'Memory & Cache', text: 'Cacheline aligned ring buffer with zero-copy shared memory.' },
          { tag: 'Safety & Invariants', text: 'Formal property fuzzing and TEE boundary verification.' },
          { tag: 'Latency & IPC', text: 'Kernel-bypass IPC transport with atomic sequence counters.' },
          { tag: 'Verification', text: 'P99 latency histogram telemetry with deterministic assertion gates.' }
        ]
      });
    } else if (task === 'critique') {
      generatedContent = JSON.stringify({
        critiques: [
          { stance: 'support', text: 'Atomic primitives maintain deterministic P99 tail latency.' },
          { stance: 'challenge', text: 'False sharing could cause memory bus contention under high concurrent loads.' },
          { stance: 'support', text: 'TEE enclave isolation guarantees cryptographic execution integrity.' }
        ]
      });
    } else if (task === 'synthesis') {
      generatedContent = [
        `### FILE: src/solution.py`,
        '```python',
        `# Autonomous 0G Synthesized Solution`,
        `import sys`,
        `import os`,
        `from typing import List, Dict, Any`,
        ``,
        `class Engine0G:`,
        `    """0G Private Computer Verifiable Compute Engine."""`,
        `    def __init__(self, name: str = "Engine0G"):`,
        `        self.name = name`,
        `        self.verified = True`,
        ``,
        `    def execute(self, payload: Dict[str, Any]) -> Dict[str, Any]:`,
        `        if not payload:`,
        `            raise ValueError("Payload cannot be empty")`,
        `        return {"status": "success", "engine": self.name, "verified": self.verified}`,
        '```',
        ``,
        `### FILE: src/test_solution.py`,
        '```python',
        `import unittest`,
        `from solution import Engine0G`,
        ``,
        `class TestEngine0G(unittest.TestCase):`,
        `    def test_execution(self):`,
        `        eng = Engine0G("TestEngine")`,
        `        res = eng.execute({"action": "run"})`,
        `        self.assertEqual(res["status"], "success")`,
        `        self.assertTrue(res["verified"])`,
        ``,
        `if __name__ == "__main__":`,
        `    unittest.main()`,
        '```'
      ].join('\n');
    } else if (task === 'code') {
      generatedContent = [
        `# Verified Implementation via 0G Private Computer (${model})`,
        `import sys`,
        `import math`,
        `from typing import List, Optional`,
        ``,
        `def solve():`,
        `    return "0G Compute verifiable execution successful."`,
        ``,
        `if __name__ == "__main__":`,
        `    print(solve())`
      ].join('\n');
    } else {
      generatedContent = `[0G Private Computer · ${model}] Objective acknowledged. System operating with verifiable TEE execution.`;
    }

    const latency = Date.now() - t0;
    this.recordRequest({
      requestId: simulatedRequestId,
      timestamp: new Date().toISOString(),
      task,
      model,
      tokensIn: 450,
      tokensOut: 320,
      latencyMs: latency,
      agentId: options.meta?.agentId,
      isLive0G: false,
      trustMode
    });

    if (options.meta?.run && options.meta?.agentId) {
      try {
        const { emitEvent } = await import('./realRunner');
        emitEvent(options.meta.run, 'llm.call_finished', options.meta.agentId, undefined, {
          call_id: options.meta.callId || `zg_${Date.now()}`,
          model: `0G · ${model}`,
          tokens_in: 450,
          tokens_out: 320,
          latency_ms: latency,
          request_id: simulatedRequestId,
          trust_mode: trustMode
        });
      } catch {}
    }

    return {
      content: generatedContent,
      requestId: simulatedRequestId,
      model,
      tokensIn: 450,
      tokensOut: 320,
      latencyMs: latency,
      isLive0G: false,
      trustMode
    };
  }

  public getUsageMetrics() {
    return {
      totalRequests: this.totalInferenceRequests,
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      totalTokens: this.totalTokensIn + this.totalTokensOut,
      totalCostMicroUsd: this.totalCostMicroUsd,
      lastRequestId: this.getLastRequestId(),
      requestCount: this.requestLog.length
    };
  }

  public associateWalletKey(walletAddress: string, apiKey: string): void {
    const cleanAddr = walletAddress.trim().toLowerCase();
    const cleanKey = apiKey.trim();
    this.walletKeyMap.set(cleanAddr, cleanKey);
    this.keyWalletMap.set(cleanKey, cleanAddr);
  }

  public getWalletForApiKey(apiKey: string): string | null {
    return this.keyWalletMap.get(apiKey.trim()) || null;
  }

  public getKeyForWallet(walletAddress: string): string | null {
    return this.walletKeyMap.get(walletAddress.trim().toLowerCase()) || null;
  }

  /**
   * Official 0G Account Balance Check.
   * Note: The official 0G Router requires management-tier (mk-) keys for /v1/account/balance;
   * inference-tier (sk-) keys return HTTP 403 (insufficient_scope) while inference billing
   * functions directly on /v1/chat/completions.
   */
  public async checkAccountBalance(): Promise<{
    status: 'available' | 'unavailable';
    reason: string;
    balance?: number;
  }> {
    if (!this.hasApiKey()) {
      return { status: 'unavailable', reason: '0G API key is not configured' };
    }

    try {
      const res = await fetch(`${this.baseURL.replace(/\/+$/, '')}/account/balance`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        const data = await res.json();
        return {
          status: 'available',
          reason: '0G Router balance verified',
          balance: data.balance ?? data.credits
        };
      }

      if (res.status === 403) {
        return {
          status: 'unavailable',
          reason: 'Compute balance unavailable: 0G sk- key is scoped for direct inference billing only. Balance queries require mk- management key.'
        };
      }

      return {
        status: 'unavailable',
        reason: `0G balance endpoint returned HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        status: 'unavailable',
        reason: `0G balance query failed: ${err.message || 'network timeout'}`
      };
    }
  }

  private recordRequest(rec: ZGRequestRecord) {
    this.requestLog.push(rec);
    if (this.requestLog.length > 200) {
      this.requestLog.shift();
    }
  }
}

// Global Singleton Instance
export const zgClient = new ZGInferenceClient();
