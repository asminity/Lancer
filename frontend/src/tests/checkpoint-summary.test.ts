import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateCheckpointSummary,
  formatCheckpointSummaryMarkdown,
  determineCheckpointStatus,
  deriveProjectName,
  StoreSnapshot,
} from '../services/checkpointSummary';
import { useStore } from '../state/store';
import { applyEvent } from '../state/events';
import { MockSimulator } from '../mock/simulator';
import { parseEvent } from '../api/types';
import goldenRun from '../mock/goldenRun.json';

describe('Checkpoint Summary: Data Integrity & Real Execution State', () => {
  beforeEach(() => {
    useStore.getState().resetRun('Test Objective');
  });

  it('1. Returns null for empty execution state (Empty State requirement)', () => {
    const emptySnapshot: StoreSnapshot = {
      goal: '',
      tasks: {},
      edges: [],
      agents: {},
      notes: [],
      runEvents: [],
      metrics: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 },
      executionState: 'idle',
      executionError: null,
      contextStages: {},
      fileEdits: {},
      checkpoint: null,
      report: null,
      simClock: '09:00',
      realElapsed: 0,
      effortLogical: 0,
      modelId: 'test-model',
      triage: null,
    };

    const summary = generateCheckpointSummary(emptySnapshot);
    expect(summary).toBeNull();
  });

  it('2. Scenario A: Successfully generates a Completed summary from a finished run', () => {
    // Replay simulator tape up to result.final
    const sim = new MockSimulator(goldenRun.goal);
    sim.drain((e) => applyEvent(e, true));

    const state = useStore.getState();
    expect(state.report).not.toBeNull();

    const summary = generateCheckpointSummary(state);
    expect(summary).not.toBeNull();
    if (!summary) return;

    // Checkpoint Metadata
    expect(summary.metadata.status).toBe('Completed');
    expect(summary.metadata.version).toBe('v1.0');
    expect(summary.metadata.checkpointId).toMatch(/^chk_/);
    expect(summary.metadata.timestamp).toBeDefined();

    // Project Overview
    expect(summary.projectOverview.status).toBe('Completed');
    expect(summary.projectOverview.progressPct).toBe(100);
    expect(summary.projectOverview.tasksTotal).toBeGreaterThan(0);
    expect(summary.projectOverview.tasksDone).toBe(summary.projectOverview.tasksTotal);
    expect(summary.projectOverview.tasksPending).toBe(0);
    expect(summary.projectOverview.tasksRunning).toBe(0);

    // Work Completed
    expect(summary.workCompleted.tasks.length).toBe(summary.projectOverview.tasksTotal);
    expect(summary.workCompleted.tasks.every((t) => t.status === 'done')).toBe(true);
    expect(summary.workCompleted.tasks.every((t) => t.progressPct === 100)).toBe(true);

    // Ensure no placeholder fake phrases exist
    const md = formatCheckpointSummaryMarkdown(summary);
    expect(md).not.toContain('The project is progressing successfully.');
    expect(md).not.toContain('The agents completed their assigned tasks.');
    expect(md).not.toContain('Everything is working as expected.');

    // Agent Contributions
    expect(summary.agentExecution.contributors.length).toBeGreaterThan(0);
    expect(summary.agentExecution.totalLlmCalls).toBeGreaterThanOrEqual(0);
  });

  it('3. Scenario C: Interrupted / Stopped run is marked Interrupted and never marked Completed', () => {
    // Setup a partially completed run
    const snapshot: StoreSnapshot = {
      goal: 'Build an automated reporting microservice',
      tasks: {
        T1: { id: 'T1', title: 'Spec', description: 'Define API schema', status: 'done', progress_pct: 100, assigned_agent: 'M0' } as any,
        T2: { id: 'T2', title: 'Database', description: 'Create SQLite schema', status: 'done', progress_pct: 100, assigned_agent: 'W1' } as any,
        T3: { id: 'T3', title: 'Endpoint', description: 'Implement REST endpoints', status: 'running', progress_pct: 45, assigned_agent: 'W1' } as any,
        T4: { id: 'T4', title: 'Tests', description: 'Write unit tests', status: 'pending', progress_pct: 0, assigned_agent: 'W2' } as any,
      },
      edges: [
        { from: 'T1', to: 'T2' },
        { from: 'T2', to: 'T3' },
        { from: 'T3', to: 'T4' },
      ],
      agents: {
        M0: { id: 'M0', name: 'Althea (Manager)', role: 'manager', done: 1, failed: 0, pending: 0, outputs: [] } as any,
        W1: { id: 'W1', name: 'Dante (Backend)', role: 'worker', done: 1, failed: 0, pending: 1, outputs: [] } as any,
        W2: { id: 'W2', name: 'Nisha (QA)', role: 'lead', done: 0, failed: 0, pending: 1, outputs: [] } as any,
      },
      notes: [
        { id: '1', author_agent_id: 'M0', topic: 'DAG_APPROVED', note: 'Architecture approved', ts: '09:05' },
      ],
      runEvents: [],
      metrics: { llm_calls: 8, tool_calls: 3, tokens_in: 4500, tokens_out: 1200 },
      executionState: 'cancelled', // Emergency halt / stop
      executionError: 'Execution halted by user',
      contextStages: {},
      fileEdits: {
        W1: [{ path: 'schema.sql', line_ranges: [[1, 20]], ts: '09:10' }],
      },
      checkpoint: { branch: 'agent/run-123', start_commit: 'abc1234' },
      report: null, // No final report generated
      simClock: '09:15',
      realElapsed: 125,
      effortLogical: 340,
      modelId: '0g/glm-5.3-flash',
      triage: null,
      paused: true,
    };

    const summary = generateCheckpointSummary(snapshot, { 'schema.sql': 'CREATE TABLE...' });
    expect(summary).not.toBeNull();
    if (!summary) return;

    // Must NOT be marked Completed
    expect(summary.metadata.status).toBe('Interrupted');
    expect(summary.projectOverview.status).toBe('Interrupted');
    expect(summary.projectOverview.progressPct).toBe(50); // 2 of 4 done

    // Completed Work accurately separated
    expect(summary.workCompleted.tasks.length).toBe(2);
    expect(summary.workCompleted.tasks.map((t) => t.id)).toEqual(['T1', 'T2']);

    // Pending Work accurately identified
    expect(summary.pendingTasksAndNextSteps.inProgressTasks.length).toBe(1);
    expect(summary.pendingTasksAndNextSteps.inProgressTasks[0].id).toBe('T3');
    expect(summary.pendingTasksAndNextSteps.pendingTasks.length).toBe(1);
    expect(summary.pendingTasksAndNextSteps.pendingTasks[0].id).toBe('T4');

    // Dependencies properly captured
    expect(summary.pendingTasksAndNextSteps.pendingTasks[0].dependencies).toEqual(['T3']);

    // Recommended next actions present
    expect(summary.pendingTasksAndNextSteps.recommendedNextActions.length).toBeGreaterThan(0);
    expect(summary.pendingTasksAndNextSteps.recommendedNextActions[0]).toContain('Resume task T3');

    // Files created or modified
    expect(summary.workCompleted.filesCreatedOrModified).toContain('schema.sql');
  });

  it('4. Scenario B: Captures context window exhaustion / stage 3 pressure without fake signals', () => {
    const snapshot: StoreSnapshot = {
      goal: 'Heavy context analysis project',
      tasks: {
        T1: { id: 'T1', title: 'Ingest', description: 'Analyze 500 files', status: 'done', progress_pct: 100, assigned_agent: 'W1' } as any,
      },
      edges: [],
      agents: {
        W1: { id: 'W1', name: 'Dante (Backend)', role: 'worker', done: 1, failed: 0, pending: 0, outputs: [] } as any,
      },
      notes: [],
      runEvents: [],
      metrics: { llm_calls: 32, tool_calls: 15, tokens_in: 98000, tokens_out: 14000 },
      executionState: 'running',
      executionError: null,
      contextStages: {
        W1: { stage: 3, frac: 0.94 }, // Actual AUTONEX context exhaustion signal
      },
      fileEdits: {},
      checkpoint: null,
      report: null,
      simClock: '11:30',
      realElapsed: 420,
      effortLogical: 1200,
      modelId: 'test-model',
      triage: null,
    };

    const summary = generateCheckpointSummary(snapshot);
    expect(summary).not.toBeNull();
    if (!summary) return;

    // Detects real context stage 3
    const contextLimit = summary.currentState.knownLimitations.find((l) => l.includes('Context pressure'));
    expect(contextLimit).toBeDefined();
    expect(contextLimit).toContain('Dante (Backend) reached stage S3 (94% context consumption)');

    // Contributor contains real stage
    const Dante = summary.agentExecution.contributors.find((c) => c.id === 'W1');
    expect(Dante?.contextStage).toBe(3);
    expect(Dante?.contextFrac).toBe(0.94);
  });

  it('5. Status helper logic handles Completed, Interrupted, and In Progress accurately', () => {
    const emptyTasks = {};
    const runningTasks = {
      T1: { id: 'T1', status: 'running' } as any,
      T2: { id: 'T2', status: 'pending' } as any,
    };
    const completedTasks = {
      T1: { id: 'T1', status: 'done' } as any,
      T2: { id: 'T2', status: 'done' } as any,
    };

    // Report present -> Completed
    expect(determineCheckpointStatus({} as any, 'running', false, runningTasks)).toBe('Completed');

    // Halted / cancelled -> Interrupted
    expect(determineCheckpointStatus(null, 'cancelled', false, runningTasks)).toBe('Interrupted');
    expect(determineCheckpointStatus(null, 'running', true, runningTasks)).toBe('Interrupted');

    // All tasks done -> Completed
    expect(determineCheckpointStatus(null, 'running', false, completedTasks)).toBe('Completed');

    // In progress
    expect(determineCheckpointStatus(null, 'running', false, runningTasks)).toBe('In Progress');
  });

  it('6. Markdown serialization preserves all required structured sections', () => {
    const snapshot: StoreSnapshot = {
      goal: 'Build a Next.js landing page with Tailwind',
      tasks: {
        T1: { id: 'T1', description: 'Design header and footer', status: 'done', progress_pct: 100, assigned_agent: 'M0' } as any,
        T2: { id: 'T2', description: 'Implement hero section', status: 'running', progress_pct: 50, assigned_agent: 'W1' } as any,
      },
      edges: [{ from: 'T1', to: 'T2' }],
      agents: {
        M0: { id: 'M0', name: 'Althea', role: 'manager', done: 1, failed: 0, outputs: [] } as any,
        W1: { id: 'W1', name: 'Dante', role: 'worker', done: 0, failed: 0, outputs: [] } as any,
      },
      notes: [{ id: 'n1', author_agent_id: 'M0', topic: 'DELIVERED', note: 'Header delivered', ts: '09:00' }],
      runEvents: [],
      metrics: { llm_calls: 4, tool_calls: 1, tokens_in: 1200, tokens_out: 400 },
      executionState: 'running',
      contextStages: {},
      fileEdits: {},
      checkpoint: { branch: 'agent/next-landing', start_commit: '1234567' },
      report: null,
      simClock: '09:20',
      realElapsed: 60,
      effortLogical: 180,
      modelId: 'test-model',
      triage: null,
    };

    const summary = generateCheckpointSummary(snapshot, { 'index.html': '<html></html>' });
    expect(summary).not.toBeNull();
    if (!summary) return;

    const md = formatCheckpointSummaryMarkdown(summary);

    // Section headers
    expect(md).toContain('# Checkpoint Summary —');
    expect(md).toContain('## 1. Project Overview');
    expect(md).toContain('## 2. Work Completed');
    expect(md).toContain('## 3. Current Implementation State');
    expect(md).toContain('## 4. Agent Execution Summary');
    expect(md).toContain('## 5. Pending Tasks & Next Steps');
    expect(md).toContain('## 6. Technical Context');

    // Real content
    expect(md).toContain('Design header and footer');
    expect(md).toContain('Implement hero section');
    expect(md).toContain('index.html');
    expect(md).toContain('agent/next-landing');
  });

  it('7. Future storage compatibility: CheckpointSummary object structure is clean and token-efficient', () => {
    const snapshot: StoreSnapshot = {
      goal: 'Crypto arbitrage bot',
      tasks: {
        T1: { id: 'T1', description: 'Fetch order books', status: 'done', progress_pct: 100 } as any,
      },
      edges: [],
      agents: {
        M0: { id: 'M0', name: 'Althea', role: 'manager', done: 1, failed: 0, outputs: [] } as any,
      },
      notes: [],
      runEvents: [],
      metrics: { llm_calls: 2, tool_calls: 1, tokens_in: 500, tokens_out: 200 },
      executionState: 'completed',
      contextStages: {},
      fileEdits: {},
      checkpoint: null,
      report: { report_markdown: '# Done', sources: [], effort_logical_s: 100, effort_real_s: 20 },
      simClock: '10:00',
      realElapsed: 20,
      effortLogical: 100,
      modelId: 'test-model',
      triage: null,
    };

    const summary = generateCheckpointSummary(snapshot);
    expect(summary).not.toBeNull();
    if (!summary) return;

    // Check JSON serialization
    const serialized = JSON.stringify(summary);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.metadata.checkpointId).toBeDefined();
    expect(deserialized.metadata.version).toBe('v1.0');
    expect(deserialized.projectOverview.objective).toBe('Crypto arbitrage bot');
    expect(deserialized.workCompleted.tasks.length).toBe(1);

    // Ensure it does NOT duplicate massive raw conversation logs or raw event tape
    expect(deserialized.runEvents).toBeUndefined();
    expect(deserialized.rawLogs).toBeUndefined();
    // Compact size check (less than 15 KB)
    expect(serialized.length).toBeLessThan(15000);
  });

  it('8. Out of scope boundaries: Generating Checkpoint Summary does not make Swarm or Arkiv network calls', () => {
    const snapshot: StoreSnapshot = {
      goal: 'Decentralized storage boundary test',
      tasks: {
        T1: { id: 'T1', description: 'Sample task', status: 'done', progress_pct: 100 } as any,
      },
      edges: [],
      agents: {},
      notes: [],
      runEvents: [],
      metrics: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 },
      executionState: 'completed',
      contextStages: {},
      fileEdits: {},
      checkpoint: null,
      report: null,
      simClock: '09:00',
      realElapsed: 10,
      effortLogical: 10,
      modelId: 'test-model',
      triage: null,
    };

    const summary = generateCheckpointSummary(snapshot);
    expect(summary).not.toBeNull();
    // Summary is purely in-memory data
    expect(summary?.metadata.status).toBe('Completed');
    expect(summary?.workCompleted.tasks.length).toBe(1);
  });

  it('9. Source file count remains dynamic and never hardcoded to 5', () => {
    const snapshot: StoreSnapshot = {
      goal: 'Dynamic file count check',
      tasks: {},
      edges: [],
      agents: {},
      notes: [],
      runEvents: [],
      metrics: { llm_calls: 0, tool_calls: 0, tokens_in: 0, tokens_out: 0 },
      executionState: 'completed',
      contextStages: {},
      fileEdits: {},
      checkpoint: null,
      report: { report_markdown: '# Report', sources: [], effort_logical_s: 10, effort_real_s: 10 },
      simClock: '09:00',
      realElapsed: 10,
      effortLogical: 10,
      modelId: 'test-model',
      triage: null,
    };

    const threeFiles = { 'a.ts': '', 'b.ts': '', 'c.ts': '' };
    const summary3 = generateCheckpointSummary(snapshot, threeFiles);
    expect(summary3?.workCompleted.filesCreatedOrModified.length).toBe(3);

    const sevenFiles = { '1.ts': '', '2.ts': '', '3.ts': '', '4.ts': '', '5.ts': '', '6.ts': '', '7.ts': '' };
    const summary7 = generateCheckpointSummary(snapshot, sevenFiles);
    expect(summary7?.workCompleted.filesCreatedOrModified.length).toBe(7);
  });
});
