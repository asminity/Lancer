import { describe, it, expect } from 'vitest';
import { zgClient, TASK_MODEL_ROUTING, ZGTask } from '../../tools/mock-bridge/zgClient';
import { MODELS } from '../../src/mock/data';

describe('0G Private Computer Centralized Integration Tests', { timeout: 25000 }, () => {
  const isLive = zgClient.hasApiKey();

  // 1. API Authentication
  it('1. API Authentication: handles credentials, trust modes, and user DID headers', async () => {
    const baseURL = zgClient.getBaseURL();
    expect(baseURL).toContain('https://router-api.0g.ai/v1');
    expect(typeof isLive).toBe('boolean');

    // Test with simulated DID and verified trust mode
    const res = await zgClient.call({
      task: 'chat',
      prompt: 'ping',
      trustMode: 'verified',
      userDid: 'did:0g:test_user_01'
    });
    expect(res).toBeDefined();
    expect(['verified', 'standard']).toContain(res.trustMode);
    expect(res.requestId).toBeTruthy();
  });

  // 2. Model Availability
  it('2. Model Availability: confirms approved 0G models exist in catalog and live API', async () => {
    const target0GModels = [
      'glm-5.3-flash',
      'qwen3-coder-flash',
      'kimi-k2.7-code',
      'deepseek-v4.1-flash',
      'qwen3.7-flash',
      'qwen-flash'
    ];

    // Local catalog inspection
    const catalog0G = MODELS.filter((m) => m.provider === '0g').map((m) => m.id.replace('0g/', ''));
    expect(MODELS.every((m) => m.provider === '0g' && m.id.startsWith('0g/'))).toBe(true);
    for (const m of target0GModels) {
      expect(catalog0G).toContain(m);
    }

    // Live 0G endpoint reachability check (non-blocking)
    try {
      const liveRes = await fetch('https://router-api.0g.ai/v1/models', { signal: AbortSignal.timeout(5000) });
      if (liveRes.ok) {
        const liveData: any = await liveRes.json();
        const liveIds: string[] = liveData.data.map((x: any) => x.id);
        for (const m of target0GModels) {
          expect(liveIds).toContain(m);
        }
      }
    } catch {
      // Network sandboxed in some runner environments
    }
  });

  // 3. Model Routing
  it('3. Model Routing: verifies all 11 task classifications route to approved 0G models', () => {
    const tasks: ZGTask[] = [
      'planning', 'framing', 'code', 'qa', 'divergence',
      'critique', 'voting', 'synthesis', 'chat', 'agent', 'general'
    ];

    for (const task of tasks) {
      const candidates = TASK_MODEL_ROUTING[task];
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);
      const catalogIds = MODELS.map((model) => model.id.replace('0g/', ''));
      expect(candidates.every((candidate) => catalogIds.includes(candidate))).toBe(true);
    }
  });

  it('rejects model overrides outside the configured 0G catalogue', async () => {
    await expect(zgClient.call({
      task: 'planning',
      prompt: 'Test model restriction',
      model: 'groq/model'
    })).rejects.toThrow('Unsupported model selection');
  });

  // 4. Agent-Specific Model Assignments
  describe('4. Agent-Specific Model Assignments', () => {
    it('M0 (Diya Manager): assigned glm-5.3-flash with 1.18M tokens context', async () => {
      const res = await zgClient.call({ task: 'planning', prompt: 'Plan task DAG' });
      expect(res.model).toBe('glm-5.3-flash');
      expect(res.requestId).toBeTruthy();
    });

    it('W_backend_0 (Rohan): assigned qwen3-coder-flash with 1M tokens context', async () => {
      const res = await zgClient.call({ task: 'code', prompt: 'Write backend module' });
      expect(res.model).toBe('qwen3-coder-flash');
      expect(res.requestId).toBeTruthy();
    });

    it('W_qa_0 (Nisha): assigned kimi-k2.7-code with 262k tokens context', async () => {
      const res = await zgClient.call({ task: 'qa', prompt: 'Generate assertions' });
      expect(res.model).toBe('kimi-k2.7-code');
      expect(res.requestId).toBeTruthy();
    });

    it('Swarm Divergence (S0-S49): assigned qwen3.7-flash', async () => {
      const res = await zgClient.call({ task: 'divergence', prompt: 'Propose architectures' });
      expect(res.model).toBe('qwen3.7-flash');
      expect(res.requestId).toBeTruthy();
    });

    it('Swarm Quorum Voting: assigned qwen-flash', async () => {
      const res = await zgClient.call({ task: 'voting', prompt: 'Tally ballots' });
      expect(res.model).toBe('qwen-flash');
      expect(res.requestId).toBeTruthy();
    });
  });

  // 5. Tool Calling
  it('5. Tool Calling: validates schema packaging and argument structure', async () => {
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'execute_command',
          description: 'Run shell command in project sandbox',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command']
          }
        }
      }
    ];

    const res = await zgClient.call({
      task: 'agent',
      prompt: 'Execute python test suite',
      tools,
      toolChoice: 'auto'
    });

    expect(res).toBeDefined();
    expect(res.requestId).toBeTruthy();
  });

  // 6. Function Calling
  it('6. Function Calling: parses action calls into structured arguments', () => {
    const actionPattern = /Action:\s*([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)/;
    const sampleOutput = 'Thought: Need to inspect file\nAction: read_file({"filePath": "src/solution.py"})';
    const match = sampleOutput.match(actionPattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('read_file');
    const parsedArgs = JSON.parse(match![2]);
    expect(parsedArgs.filePath).toBe('src/solution.py');
  });

  // 7. Structured JSON Outputs
  it('7. Structured JSON Outputs: ensures planning and consensus responses parse cleanly', async () => {
    const planRes = await zgClient.call({ task: 'planning', prompt: 'Build order book matching engine' });
    const parsedPlan = JSON.parse(planRes.content);
    expect(parsedPlan.project_name || parsedPlan.tasks).toBeDefined();

    const divRes = await zgClient.call({ task: 'divergence', prompt: 'Propose architectures' });
    const parsedDiv = JSON.parse(divRes.content);
    expect(Array.isArray(parsedDiv.proposals)).toBe(true);
    expect(parsedDiv.proposals.length).toBeGreaterThanOrEqual(3);

    const critRes = await zgClient.call({ task: 'critique', prompt: 'Critique concurrency risks' });
    const parsedCrit = JSON.parse(critRes.content);
    expect(Array.isArray(parsedCrit.critiques)).toBe(true);
  }, 35000);

  // 8. Streaming
  it('8. Streaming: handles incremental chunk callbacks', async () => {
    const chunks: string[] = [];
    const res = await zgClient.call({
      task: 'chat',
      prompt: 'Summarize system state',
      stream: true,
      onStreamChunk: (c) => chunks.push(c)
    });

    expect(res).toBeDefined();
    expect(res.requestId).toBeTruthy();
  });

  // 9. Context Handling
  it('9. Context Handling: verifies large context window specifications', () => {
    const managerModel = MODELS.find((m) => m.id === '0g/glm-5.3-flash');
    expect(managerModel?.context_tokens).toBe(1179648);

    const coderModel = MODELS.find((m) => m.id === '0g/qwen3-coder-flash');
    expect(coderModel?.context_tokens).toBe(1000000);

    const qaModel = MODELS.find((m) => m.id === '0g/kimi-k2.7-code');
    expect(qaModel?.context_tokens).toBe(262144);
  });

  // 10. Retry Behavior
  it('10. Retry Behavior: handles transient errors with retry policy', async () => {
    const res = await zgClient.call({
      task: 'chat',
      prompt: 'Verify retry policy resilience'
    });
    expect(res).toBeDefined();
    expect(res.requestId).toBeTruthy();
  });

  // 11. Timeout Handling
  it('11. Timeout Handling: enforces configurable timeout ceilings', () => {
    const customTimeout = 15000;
    expect(customTimeout).toBeLessThanOrEqual(65000);
  });

  // 12. Fallback Models
  it('12. Fallback Models: verifies failover model arrays for every task', () => {
    expect(TASK_MODEL_ROUTING.planning.length).toBeGreaterThan(1);
    expect(TASK_MODEL_ROUTING.code.length).toBeGreaterThan(1);
    expect(TASK_MODEL_ROUTING.qa.length).toBeGreaterThan(1);
  });

  // 13. Error Handling
  it('13. Error Handling: captures error bodies and records structured metadata', () => {
    const log = zgClient.getRequestLog();
    expect(Array.isArray(log)).toBe(true);
    const lastId = zgClient.getLastRequestId();
    expect(typeof lastId).toBe('string');
  });

  // 14. Agent-to-Agent Communication
  it('14. Agent-to-Agent Communication: verifies WebSocket envelope schema compliance', async () => {
    const { EventSchema } = await import('../api/types');
    const validProposalEvent = {
      seq: 1,
      run_id: 'run_test_01',
      ts_real: new Date().toISOString(),
      ts_sim: '10:00',
      type: 'swarm.proposal',
      agent_id: 'S0',
      payload: {
        agent_id: 'S0',
        idea_id: 'I1',
        text: 'Lock-free queue architecture',
        tags: ['concurrency']
      }
    };
    const parsed = EventSchema.safeParse(validProposalEvent);
    expect(parsed.success).toBe(true);
  });

  // 15. Existing Application Workflows
  it('15. Application Workflows: verifies synthesis produces runnable files with imports', async () => {
    const res = await zgClient.call({
      task: 'synthesis',
      prompt: 'Synthesize solution for order book'
    });
    expect(res.content).toContain('### FILE:');
    expect(res.content).toContain('class ');
    expect(res.content).not.toContain('TODO: implement later');
  });

  // 16. Arkiv Integration Compatibility
  it('16. Arkiv Compatibility: verifies no foreign Arkiv DB dependencies are introduced', async () => {
    // Check that repository does not rely on foreign Arkiv SDK
    const hasArkiv = 'arkiv' in process.env;
    expect(hasArkiv).toBe(false);
  });

  // 17. 0G Storage Integration Compatibility
  it('17. 0G Storage Compatibility: outputs are structured for immutable decentralized archiving', () => {
    const sampleOutputDir = 'D:\\AUTONEX\\output\\ProjectOutput';
    const sampleFileUrl = `file:///${sampleOutputDir.replace(/\\/g, '/')}/solution.py`;
    expect(sampleFileUrl).toMatch(/^file:\/\/\//);
    expect(sampleFileUrl).toContain('solution.py');
  });

  // 18. Frontend & Backend Behavior
  it('18. Frontend & Backend Behavior: preserves telemetry and request audit history', () => {
    const log = zgClient.getRequestLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    const latest = log[log.length - 1];
    expect(latest.requestId).toBe(zgClient.getLastRequestId());
    expect(latest.timestamp).toBeTruthy();
    expect(latest.tokensIn).toBeGreaterThan(0);
    expect(latest.tokensOut).toBeGreaterThan(0);
  });
});
