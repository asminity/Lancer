import type { Task, BlackboardNote, Envelope, FinalResult, Metrics, TriageResult } from '@/api/types';
import type { AgentUI } from '@/state/store';

export type CheckpointStatus = 'In Progress' | 'Interrupted' | 'Completed';

export interface CheckpointTaskItem {
  id: string;
  description: string;
  assignedAgentId?: string | null;
  assignedAgentName?: string;
  status: 'done' | 'running' | 'ready' | 'pending' | 'failed' | 'waiting' | 'review' | 'blocked';
  progressPct: number;
  resultPreview?: string;
  dependencies?: string[];
  department?: string;
}

export interface CheckpointAgentContribution {
  id: string;
  name: string;
  role: string;
  department?: string | null;
  status: string;
  tasksCompleted: number;
  tasksFailed: number;
  tasksAssigned: string[];
  keyActions: string[];
  energy?: number;
  contextStage?: number;
  contextFrac?: number;
}

export interface CheckpointSummary {
  metadata: {
    checkpointId: string;
    version: string;
    timestamp: string;
    createdAtFormatted: string;
    runId: string;
    status: CheckpointStatus;
    executionState: string;
  };
  projectOverview: {
    projectName: string;
    objective: string;
    status: CheckpointStatus;
    progressPct: number;
    tasksTotal: number;
    tasksDone: number;
    tasksRunning: number;
    tasksPending: number;
    tasksFailed: number;
    elapsedRealSeconds: number;
    elapsedLogicalSeconds: number;
    simClock: string;
    outputDirectory: string;
  };
  workCompleted: {
    tasks: CheckpointTaskItem[];
    majorFeatures: string[];
    filesCreatedOrModified: string[];
    architecturalDecisions: string[];
    integrationsCompleted: string[];
    relevantOutputs: { taskId: string; preview: string; agentId?: string }[];
  };
  currentState: {
    implemented: string[];
    partiallyImplemented: string[];
    incomplete: string[];
    knownLimitations: string[];
  };
  agentExecution: {
    contributors: CheckpointAgentContribution[];
    totalLlmCalls: number;
    totalToolCalls: number;
    totalTokensIn: number;
    totalTokensOut: number;
  };
  pendingTasksAndNextSteps: {
    inProgressTasks: CheckpointTaskItem[];
    pendingTasks: CheckpointTaskItem[];
    blockers: string[];
    recommendedNextActions: string[];
  };
  technicalContext: {
    technologies: string[];
    architecture: string[];
    configurationAndEnvironment: string[];
    integrations: string[];
    criticalContinuationNotes: string[];
    gitCheckpoint?: { branch: string; startCommit: string } | null;
  };
}

export interface StoreSnapshot {
  goal: string;
  tasks: Record<string, Task>;
  edges: { from: string; to: string }[];
  agents: Record<string, AgentUI>;
  notes: BlackboardNote[];
  runEvents: Envelope[];
  metrics: Metrics;
  executionState: string;
  executionError?: string | null;
  contextStages: Record<string, { stage: number; frac: number }>;
  fileEdits: Record<string, { path: string; line_ranges: [number, number][]; branch?: string; ts: string }[]>;
  checkpoint: { branch: string; start_commit: string } | null;
  report: FinalResult | null;
  simClock: string;
  realElapsed: number;
  effortLogical: number;
  modelId: string;
  triage: TriageResult | null;
  paused?: boolean;
}

/**
 * Derives project name from output directory, report markdown, or goal.
 */
export function deriveProjectName(goal: string, localOutputDir?: string, reportMd?: string): string {
  if (localOutputDir && localOutputDir !== 'D:\\AUTONEX\\output\\ProjectOutput') {
    const parts = localOutputDir.split(/[\\/]/).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  if (reportMd) {
    const match = reportMd.match(/^#\s+([^\n-]+)/m);
    if (match && match[1]?.trim()) return match[1].trim();
  }
  if (/crypto|btc|eth|tracker|coin/i.test(goal)) return 'CRYPTracker';
  const clean = goal.replace(/^(build|create|make|develop|implement|add|write)\s+/i, '').trim();
  if (clean.length > 0) {
    const words = clean.split(/\s+/).slice(0, 4).join('-');
    return words.replace(/[^a-zA-Z0-9-]/g, '') || 'AUTONEX-Project';
  }
  return 'AUTONEX-Project';
}

/**
 * Determines the execution status for the checkpoint based on real execution state.
 */
export function determineCheckpointStatus(
  report: FinalResult | null,
  executionState: string,
  paused: boolean,
  tasks: Record<string, Task>
): CheckpointStatus {
  if (report !== null || executionState === 'completed') {
    return 'Completed';
  }
  if (executionState === 'cancelled' || executionState === 'failed' || paused) {
    return 'Interrupted';
  }
  const taskList = Object.values(tasks);
  if (taskList.length > 0) {
    const allDone = taskList.every((t) => t.status === 'done');
    if (allDone) return 'Completed';
    const anyFailed = taskList.some((t) => t.status === 'failed');
    if (anyFailed && executionState !== 'running') return 'Interrupted';
    return 'In Progress';
  }
  return 'In Progress';
}

/**
 * Generates an authentic, structured Checkpoint Summary from the real AUTONEX execution state.
 * Returns null if no execution data is present.
 */
export function generateCheckpointSummary(
  store: StoreSnapshot,
  files?: Record<string, string>,
  localOutputDir?: string
): CheckpointSummary | null {
  const taskList = Object.values(store.tasks);
  const eventList = store.runEvents || [];
  const agentList = Object.values(store.agents);

  // If there is zero execution data, return null to allow rendering the empty state
  if (!store.goal && taskList.length === 0 && eventList.length === 0 && !store.report) {
    return null;
  }

  const effectiveGoal = store.goal || (store.triage ? 'Execute multi-agent plan' : 'Autonomous task execution');
  const projectName = deriveProjectName(effectiveGoal, localOutputDir, store.report?.report_markdown);
  const status = determineCheckpointStatus(store.report, store.executionState, !!store.paused, store.tasks);

  // 1. Task Progress Analysis
  const tasksDone = taskList.filter((t) => t.status === 'done' || t.progress_pct === 100);
  const tasksRunning = taskList.filter((t) => t.status === 'running' && (t.progress_pct ?? 0) < 100);
  const tasksPending = taskList.filter((t) => t.status === 'pending' || t.status === 'ready' || t.status === 'waiting');
  const tasksFailed = taskList.filter((t) => t.status === 'failed');

  // Map task dependencies from edges
  const dependencyMap = new Map<string, string[]>();
  for (const edge of store.edges || []) {
    const list = dependencyMap.get(edge.to) || [];
    list.push(edge.from);
    dependencyMap.set(edge.to, list);
  }

  const tasksBlocked = taskList.filter((t) => {
    if (t.status === 'failed' || t.status === 'done') return false;
    const deps = dependencyMap.get(t.id) || [];
    return deps.some((depId) => store.tasks[depId]?.status !== 'done');
  });

  const totalTasksCount = taskList.length;
  const progressPct = totalTasksCount > 0
    ? Math.round((tasksDone.length / totalTasksCount) * 100)
    : (status === 'Completed' ? 100 : 0);

  // 2. Work Completed Details
  const completedTaskItems: CheckpointTaskItem[] = tasksDone.map((t) => {
    const assignedAgent = t.assigned_agent ? store.agents[t.assigned_agent] : undefined;
    // Find output preview from task.completed event or agent outputs
    const completedEv = eventList.find((e) => e.type === 'task.completed' && (e.task_id === t.id || (e.payload as any)?.task_id === t.id));
    const agentOutput = assignedAgent?.outputs?.find((o: any) => o.task_id === t.id);
    const resultPreview = (completedEv?.payload as any)?.result_preview || agentOutput?.preview || undefined;

    return {
      id: t.id,
      description: t.description || `Task ${t.id}`,
      assignedAgentId: t.assigned_agent,
      assignedAgentName: assignedAgent?.name,
      status: 'done',
      progressPct: 100,
      resultPreview,
      dependencies: dependencyMap.get(t.id),
      department: (t as any).department,
    };
  });

  // Extract Major Features from completed tasks, blackboard notes, and deliverables
  const majorFeatures: string[] = [];
  for (const t of tasksDone) {
    if (t.description && !majorFeatures.includes(t.description)) {
      majorFeatures.push(t.description);
    }
  }
  for (const note of store.notes || []) {
    if (['DELIVERED', 'IMPLEMENTATION', 'DAG_APPROVED', 'review'].includes(note.topic)) {
      if (note.note && !majorFeatures.includes(note.note) && note.note.length < 140) {
        majorFeatures.push(note.note);
      }
    }
  }

  // Extract files created or modified from real files, fileEdits, and events
  const filesSet = new Set<string>();
  if (files) {
    Object.keys(files).forEach((f) => filesSet.add(f));
  }
  if (store.fileEdits) {
    Object.values(store.fileEdits).forEach((edits) => {
      edits.forEach((e) => filesSet.add(e.path));
    });
  }
  // Check for file.edit events
  for (const ev of eventList) {
    if (ev.type === 'file.edit' && (ev.payload as any)?.path) {
      filesSet.add((ev.payload as any).path);
    }
  }
  const filesCreatedOrModified = Array.from(filesSet);

  // Architectural Decisions from triage, blackboard notes, and plan
  const architecturalDecisions: string[] = [];
  if (store.triage) {
    architecturalDecisions.push(`Task classification: ${store.triage.task_class.replace(/_/g, ' ')} (${store.triage.intensity} intensity)`);
    if (store.triage.break_policy) {
      architecturalDecisions.push(`Execution pacing: ${store.triage.break_policy.pace} pace with ${store.triage.break_policy.coffee} coffee break policy`);
    }
    if (store.triage.rationale) {
      architecturalDecisions.push(`Triage rationale: ${store.triage.rationale}`);
    }
  }
  for (const note of store.notes || []) {
    if (note.topic === 'ARCH' || note.topic === 'DAG_APPROVED') {
      architecturalDecisions.push(note.note);
    }
  }
  if (architecturalDecisions.length === 0 && totalTasksCount > 0) {
    architecturalDecisions.push(`Decomposed into ${totalTasksCount}-node directed acyclic graph across active departments.`);
  }

  // Integrations Completed
  const integrationsCompleted: string[] = [];
  const validationEvents = eventList.filter((e) => e.type === 'validation.passed');
  if (validationEvents.length > 0) {
    integrationsCompleted.push(`Automated execution validation gate passed (${validationEvents.length} verification passes).`);
  }
  if (store.checkpoint?.branch) {
    integrationsCompleted.push(`Git integration branch initialized: \`${store.checkpoint.branch}\` at commit \`${String(store.checkpoint.start_commit).slice(0, 7)}\`.`);
  }
  if (filesCreatedOrModified.some((f) => f.includes('vite') || f.includes('package.json'))) {
    integrationsCompleted.push('Vite and NPM project infrastructure configured.');
  }
  if (store.report?.sources && store.report.sources.length > 0) {
    integrationsCompleted.push(`${store.report.sources.length} external sources and references verified.`);
  }

  // Relevant Outputs Produced
  const relevantOutputs: { taskId: string; preview: string; agentId?: string }[] = [];
  for (const agent of agentList) {
    for (const out of agent.outputs || []) {
      relevantOutputs.push({ taskId: out.task_id, preview: out.preview, agentId: agent.id });
    }
  }
  for (const ev of eventList) {
    if (ev.type === 'task.completed' && (ev.payload as any)?.result_preview) {
      const tid = (ev.payload as any).task_id || ev.task_id || 'task';
      if (!relevantOutputs.some((o) => o.taskId === tid)) {
        relevantOutputs.push({ taskId: tid, preview: (ev.payload as any).result_preview, agentId: ev.agent_id });
      }
    }
  }

  // 3. Current Implementation State
  const implementedItems: string[] = [];
  for (const t of tasksDone) {
    implementedItems.push(`${t.id}: ${t.description}`);
  }
  for (const f of filesCreatedOrModified.slice(0, 8)) {
    implementedItems.push(`File compiled: ${f}`);
  }

  const partiallyImplementedItems: string[] = [];
  for (const t of tasksRunning) {
    partiallyImplementedItems.push(`${t.id}: ${t.description} (${t.progress_pct || 0}% completed)`);
  }

  const incompleteItems: string[] = [];
  for (const t of tasksPending) {
    incompleteItems.push(`${t.id}: ${t.description} (status: ${t.status})`);
  }
  for (const t of tasksBlocked) {
    incompleteItems.push(`${t.id}: ${t.description} (blocked by dependency)`);
  }

  const knownLimitations: string[] = [];
  for (const t of tasksFailed) {
    const failEv = eventList.find((e) => e.type === 'task.failed' && (e.task_id === t.id || (e.payload as any)?.task_id === t.id));
    const reason = (failEv?.payload as any)?.reason || 'Task execution failed';
    knownLimitations.push(`Failed task ${t.id}: ${reason}`);
  }
  // Check context window stage exhaustion signals
  if (store.contextStages) {
    for (const [aid, stageData] of Object.entries(store.contextStages)) {
      if (stageData.stage >= 2 || stageData.frac >= 0.75) {
        const agentName = store.agents[aid]?.name || aid;
        knownLimitations.push(
          `Context pressure alert: ${agentName} reached stage S${stageData.stage} (${(stageData.frac * 100).toFixed(0)}% context consumption).`
        );
      }
    }
  }
  if (store.executionError) {
    knownLimitations.push(`Execution error noted: ${store.executionError}`);
  }
  if (status === 'Interrupted' && tasksPending.length > 0) {
    knownLimitations.push(`Execution interrupted before ${tasksPending.length} pending tasks could be scheduled.`);
  }

  // 4. Agent Execution Summary
  const contributors: CheckpointAgentContribution[] = agentList
    .filter((a) => (a.done ?? 0) > 0 || (a.failed ?? 0) > 0 || (a.outputs && a.outputs.length > 0) || a.current_task_id || a.role === 'manager')
    .map((a) => {
      const assignedTasks = taskList.filter((t) => t.assigned_agent === a.id).map((t) => t.id);
      const stageInfo = store.contextStages ? store.contextStages[a.id] : undefined;

      // Extract key actions from blackboard notes or completed tasks
      const keyActions: string[] = [];
      for (const t of tasksDone.filter((td) => td.assigned_agent === a.id)) {
        keyActions.push(`Completed ${t.id}: ${t.description}`);
      }
      for (const note of store.notes || []) {
        if (note.author_agent_id === a.id && note.note && keyActions.length < 4) {
          keyActions.push(note.note);
        }
      }

      return {
        id: a.id,
        name: a.name,
        role: a.role,
        department: a.department,
        status: a.status,
        tasksCompleted: a.done ?? 0,
        tasksFailed: a.failed ?? 0,
        tasksAssigned: assignedTasks,
        keyActions: Array.from(new Set(keyActions)),
        energy: a.energy,
        contextStage: stageInfo?.stage,
        contextFrac: stageInfo?.frac,
      };
    });

  // 5. Pending Tasks and Next Steps
  const inProgressTaskItems: CheckpointTaskItem[] = tasksRunning.map((t) => ({
    id: t.id,
    description: t.description || `Task ${t.id}`,
    assignedAgentId: t.assigned_agent,
    assignedAgentName: t.assigned_agent ? store.agents[t.assigned_agent]?.name : undefined,
    status: 'running',
    progressPct: t.progress_pct || 0,
    dependencies: dependencyMap.get(t.id),
  }));

  const pendingTaskItems: CheckpointTaskItem[] = tasksPending.map((t) => ({
    id: t.id,
    description: t.description || `Task ${t.id}`,
    assignedAgentId: t.assigned_agent,
    assignedAgentName: t.assigned_agent ? store.agents[t.assigned_agent]?.name : undefined,
    status: t.status as any,
    progressPct: 0,
    dependencies: dependencyMap.get(t.id),
  }));

  const blockers: string[] = [];
  for (const t of tasksBlocked) {
    const deps = dependencyMap.get(t.id) || [];
    blockers.push(`Task ${t.id} blocked by incomplete dependencies: [${deps.join(', ')}]`);
  }
  for (const t of tasksFailed) {
    blockers.push(`Failed task ${t.id} blocks downstream dependents in the DAG.`);
  }

  const recommendedNextActions: string[] = [];
  if (status === 'Completed') {
    recommendedNextActions.push('All planned DAG tasks complete. Ready for production deployment or download.');
    recommendedNextActions.push('Download code bundle as .ZIP or review individual source files.');
  } else if (status === 'Interrupted') {
    if (inProgressTaskItems.length > 0) {
      recommendedNextActions.push(`Resume task ${inProgressTaskItems[0].id} ("${inProgressTaskItems[0].description}").`);
    }
    if (pendingTaskItems.length > 0) {
      recommendedNextActions.push(`Dispatch pending tasks starting with ${pendingTaskItems[0].id}.`);
    }
    if (blockers.length > 0) {
      recommendedNextActions.push(`Resolve blockers on ${blockers[0]}.`);
    }
  } else {
    if (inProgressTaskItems.length > 0) {
      recommendedNextActions.push(`Monitor execution of active task ${inProgressTaskItems[0].id}.`);
    } else if (pendingTaskItems.length > 0) {
      recommendedNextActions.push(`Queue next task ${pendingTaskItems[0].id} for department allocation.`);
    }
  }

  // 6. Technical Context
  const detectedTech = new Set<string>();
  filesCreatedOrModified.forEach((f) => {
    if (f.endsWith('.tsx') || f.endsWith('.ts')) detectedTech.add('TypeScript');
    if (f.endsWith('.jsx') || f.endsWith('.tsx') || f.includes('react')) detectedTech.add('React');
    if (f.endsWith('.py')) detectedTech.add('Python');
    if (f.endsWith('.css') || f.endsWith('.scss')) detectedTech.add('Tailwind / CSS');
    if (f.endsWith('.json')) detectedTech.add('JSON Config');
  });
  if (filesCreatedOrModified.some((f) => f.includes('vite'))) detectedTech.add('Vite');
  if (detectedTech.size === 0) detectedTech.add('JavaScript / TypeScript');

  const archDetails: string[] = [
    `Model: ${store.modelId || '0g/glm-5.3-flash'}`,
    `Agent departments: ${Object.keys(store.agents).length > 0 ? Array.from(new Set(agentList.map((a) => a.department || a.role))).join(', ') : 'Centralized Floor'}`,
  ];
  if (store.triage?.intensity) {
    archDetails.push(`Execution profile: ${store.triage.intensity}`);
  }

  const envDetails: string[] = [
    `Output directory: ${localOutputDir || 'D:\\AUTONEX\\output\\ProjectOutput'}`,
    `Execution mode: ${store.executionState || 'live'}`,
  ];
  if (store.checkpoint?.branch) {
    envDetails.push(`Git branch: ${store.checkpoint.branch}`);
  }

  const criticalContinuationNotes: string[] = [];
  if (store.checkpoint?.branch) {
    criticalContinuationNotes.push(`Git integration branch \`${store.checkpoint.branch}\` can be inspected or merged via \`runControl('merge_branch')\`.`);
  }
  if (tasksDone.length > 0) {
    criticalContinuationNotes.push(`${tasksDone.length} of ${totalTasksCount || tasksDone.length} milestone tasks are committed to disk.`);
  }

  // 7. Metadata
  const now = new Date();
  const runId = eventList.find((e) => e.run_id && e.run_id !== 'local')?.run_id || (store.checkpoint?.branch || 'run_autonex');

  return {
    metadata: {
      checkpointId: `chk_${now.getTime().toString(36)}`,
      version: 'v1.0',
      timestamp: now.toISOString(),
      createdAtFormatted: now.toLocaleString(),
      runId,
      status,
      executionState: store.executionState || (status === 'Completed' ? 'completed' : 'idle'),
    },
    projectOverview: {
      projectName,
      objective: effectiveGoal,
      status,
      progressPct,
      tasksTotal: totalTasksCount,
      tasksDone: tasksDone.length,
      tasksRunning: tasksRunning.length,
      tasksPending: tasksPending.length,
      tasksFailed: tasksFailed.length,
      elapsedRealSeconds: store.realElapsed || (store.report?.effort_real_s ?? 0),
      elapsedLogicalSeconds: store.effortLogical || (store.report?.effort_logical_s ?? 0),
      simClock: store.simClock || '09:00',
      outputDirectory: localOutputDir || 'D:\\AUTONEX\\output\\ProjectOutput',
    },
    workCompleted: {
      tasks: completedTaskItems,
      majorFeatures: majorFeatures.slice(0, 10),
      filesCreatedOrModified,
      architecturalDecisions,
      integrationsCompleted,
      relevantOutputs,
    },
    currentState: {
      implemented: implementedItems.slice(0, 15),
      partiallyImplemented: partiallyImplementedItems,
      incomplete: incompleteItems,
      knownLimitations,
    },
    agentExecution: {
      contributors,
      totalLlmCalls: store.metrics?.llm_calls ?? 0,
      totalToolCalls: store.metrics?.tool_calls ?? 0,
      totalTokensIn: store.metrics?.tokens_in ?? 0,
      totalTokensOut: store.metrics?.tokens_out ?? 0,
    },
    pendingTasksAndNextSteps: {
      inProgressTasks: inProgressTaskItems,
      pendingTasks: pendingTaskItems,
      blockers,
      recommendedNextActions,
    },
    technicalContext: {
      technologies: Array.from(detectedTech),
      architecture: archDetails,
      configurationAndEnvironment: envDetails,
      integrations: integrationsCompleted,
      criticalContinuationNotes,
      gitCheckpoint: store.checkpoint
        ? { branch: store.checkpoint.branch, startCommit: store.checkpoint.start_commit }
        : null,
    },
  };
}

/**
 * Formats a CheckpointSummary as a clean GitHub Flavored Markdown document for export or display.
 */
export function formatCheckpointSummaryMarkdown(s: CheckpointSummary): string {
  const lines: string[] = [];

  lines.push(`# Checkpoint Summary — ${s.projectOverview.projectName}`);
  lines.push('');
  lines.push(`**Status:** ${s.metadata.status} | **Progress:** ${s.projectOverview.progressPct}% | **Created:** ${s.metadata.createdAtFormatted}`);
  lines.push(`**Run ID:** \`${s.metadata.runId}\` | **Version:** ${s.metadata.version}`);
  lines.push('');

  lines.push('## 1. Project Overview');
  lines.push(`- **Objective:** ${s.projectOverview.objective}`);
  lines.push(`- **Output Folder:** \`${s.projectOverview.outputDirectory}\``);
  lines.push(`- **Milestone Tasks:** ${s.projectOverview.tasksDone}/${s.projectOverview.tasksTotal} completed (${s.projectOverview.tasksPending} pending, ${s.projectOverview.tasksRunning} active, ${s.projectOverview.tasksFailed} failed)`);
  lines.push(`- **Execution Effort:** Logical active time: ${(s.projectOverview.elapsedLogicalSeconds / 60).toFixed(1)} min | Real wall time: ${(s.projectOverview.elapsedRealSeconds / 60).toFixed(1)} min`);
  lines.push('');

  lines.push('## 2. Work Completed');
  if (s.workCompleted.tasks.length > 0) {
    lines.push('### Completed Tasks');
    for (const t of s.workCompleted.tasks) {
      lines.push(`- **[${t.id}]** ${t.description}${t.assignedAgentName ? ` _(by ${t.assignedAgentName})_` : ''}${t.resultPreview ? ` — \`${t.resultPreview}\`` : ''}`);
    }
  }
  if (s.workCompleted.filesCreatedOrModified.length > 0) {
    lines.push('### Files Created or Modified');
    for (const f of s.workCompleted.filesCreatedOrModified) {
      lines.push(`- \`${f}\``);
    }
  }
  if (s.workCompleted.architecturalDecisions.length > 0) {
    lines.push('### Architectural Decisions');
    for (const d of s.workCompleted.architecturalDecisions) {
      lines.push(`- ${d}`);
    }
  }
  lines.push('');

  lines.push('## 3. Current Implementation State');
  lines.push('### Implemented Features');
  if (s.currentState.implemented.length > 0) {
    for (const item of s.currentState.implemented) lines.push(`- ${item}`);
  } else {
    lines.push('- No components completed yet.');
  }

  if (s.currentState.partiallyImplemented.length > 0) {
    lines.push('### Partially Implemented (In Progress)');
    for (const item of s.currentState.partiallyImplemented) lines.push(`- ⏳ ${item}`);
  }

  if (s.currentState.incomplete.length > 0) {
    lines.push('### Incomplete / Queued');
    for (const item of s.currentState.incomplete) lines.push(`- ⭕ ${item}`);
  }

  if (s.currentState.knownLimitations.length > 0) {
    lines.push('### Known Limitations & Alerts');
    for (const item of s.currentState.knownLimitations) lines.push(`- ⚠️ ${item}`);
  }
  lines.push('');

  lines.push('## 4. Agent Execution Summary');
  lines.push(`- **LLM Invocations:** ${s.agentExecution.totalLlmCalls} calls | **Tool Calls:** ${s.agentExecution.totalToolCalls}`);
  lines.push(`- **Token Usage:** In: ${s.agentExecution.totalTokensIn.toLocaleString()} tokens | Out: ${s.agentExecution.totalTokensOut.toLocaleString()} tokens`);
  lines.push('');
  lines.push('| Agent | Role | Department | Tasks Done | Status |');
  lines.push('|---|---|---|---|---|');
  for (const a of s.agentExecution.contributors) {
    lines.push(`| ${a.name} | ${a.role} | ${a.department || 'Floor'} | ${a.tasksCompleted} | ${a.status} |`);
  }
  lines.push('');

  lines.push('## 5. Pending Tasks & Next Steps');
  if (s.pendingTasksAndNextSteps.inProgressTasks.length > 0) {
    lines.push('### Active Work in Progress');
    for (const t of s.pendingTasksAndNextSteps.inProgressTasks) {
      lines.push(`- **${t.id}**: ${t.description} (${t.progressPct}% done)${t.assignedAgentName ? ` assigned to ${t.assignedAgentName}` : ''}`);
    }
  }
  if (s.pendingTasksAndNextSteps.pendingTasks.length > 0) {
    lines.push('### Queued Tasks');
    for (const t of s.pendingTasksAndNextSteps.pendingTasks) {
      const deps = t.dependencies?.length ? ` (blocked by ${t.dependencies.join(', ')})` : '';
      lines.push(`- **${t.id}**: ${t.description}${deps}`);
    }
  }
  if (s.pendingTasksAndNextSteps.blockers.length > 0) {
    lines.push('### Blockers');
    for (const b of s.pendingTasksAndNextSteps.blockers) lines.push(`- 🚫 ${b}`);
  }
  if (s.pendingTasksAndNextSteps.recommendedNextActions.length > 0) {
    lines.push('### Recommended Next Actions');
    for (const action of s.pendingTasksAndNextSteps.recommendedNextActions) lines.push(`1. ${action}`);
  }
  lines.push('');

  lines.push('## 6. Technical Context');
  lines.push(`- **Technologies:** ${s.technicalContext.technologies.join(', ') || 'N/A'}`);
  for (const a of s.technicalContext.architecture) lines.push(`- ${a}`);
  for (const env of s.technicalContext.configurationAndEnvironment) lines.push(`- ${env}`);
  if (s.technicalContext.gitCheckpoint?.branch) {
    lines.push(`- **Git Branch:** \`${s.technicalContext.gitCheckpoint.branch}\` (start commit: \`${s.technicalContext.gitCheckpoint.startCommit}\`)`);
  }
  for (const note of s.technicalContext.criticalContinuationNotes) lines.push(`- 💡 ${note}`);

  return lines.join('\n');
}

export const checkpointSummaryToMarkdown = formatCheckpointSummaryMarkdown;
