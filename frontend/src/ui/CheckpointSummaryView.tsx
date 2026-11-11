import React from 'react';
import { Icon, I } from './Icons';
import type { CheckpointSummary } from '@/services/checkpointSummary';
import { fmtEffort } from '@/state/events';

interface CheckpointSummaryViewProps {
  summary: CheckpointSummary | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onCopyJson?: () => void;
  jsonCopied?: boolean;
}

export function CheckpointSummaryView({
  summary,
  loading = false,
  error = null,
  onRefresh,
  onCopyJson,
  jsonCopied = false,
}: CheckpointSummaryViewProps) {
  if (loading) {
    return (
      <div className="py-16 flex flex-col items-center justify-center space-y-3">
        <div className="w-7 h-7 rounded-full border-2 border-ink/20 border-t-[var(--accent)] animate-spin" />
        <span className="font-heading text-xs font-semibold text-ink/75">
          Generating structured checkpoint from live execution state...
        </span>
        <span className="font-mono text-[11px] text-ink/40">
          Inspecting task DAG, agent assignments, and disk deliverables
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 space-y-3">
        <div className="flex items-center gap-2 text-rose-800 font-heading font-bold text-sm">
          <Icon d={I.bug} size={16} />
          <span>Checkpoint Generation Error</span>
        </div>
        <p className="font-mono text-xs text-rose-700 leading-relaxed">{error}</p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors"
          >
            Retry Checkpoint Generation
          </button>
        )}
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="p-8 rounded-2xl bg-ink/3 border border-ink/10 text-center space-y-3 max-w-lg mx-auto my-6">
        <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 text-amber-700 mb-1">
          <Icon d={I.chart} size={24} />
        </div>
        <h3 className="font-heading font-bold text-base text-ink">
          No Checkpoint Data Available
        </h3>
        <p className="text-xs font-body text-ink/70 leading-relaxed">
          A checkpoint summary cannot currently be generated because no agent execution data, tasks, or completed milestones were found.
        </p>
        <p className="text-[11px] font-mono text-ink/50">
          Run an autonomous task or start a project to generate live execution checkpoints.
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="px-3.5 py-1.5 rounded-xl text-xs font-heading font-semibold bg-[var(--accent)] text-white hover:opacity-90 shadow-xs"
          >
            Check Again
          </button>
        )}
      </div>
    );
  }

  const { metadata, projectOverview, workCompleted, currentState, agentExecution, pendingTasksAndNextSteps, technicalContext } = summary;

  return (
    <div className="space-y-6 pb-6 text-ink">
      {/* Top Header Card */}
      <div className="p-4 rounded-xl bg-ink/3 border border-ink/10 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h3 className="font-heading font-bold text-base text-ink">
              {projectOverview.projectName}
            </h3>
            <span
              className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
                metadata.status === 'Completed'
                  ? 'bg-emerald-500/15 text-emerald-800 border border-emerald-500/20'
                  : metadata.status === 'Interrupted'
                  ? 'bg-amber-500/15 text-amber-800 border border-amber-500/20'
                  : 'bg-blue-500/15 text-blue-800 border border-blue-500/20'
              }`}
            >
              {metadata.status}
            </span>
            <span className="text-[11px] font-mono text-ink/50">
              Run: {metadata.runId}
            </span>
          </div>
          <p className="text-xs font-body text-ink/70">
            {projectOverview.objective}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-heading bg-paper border border-ink/15 hover:bg-ink/5 text-ink/80 transition-colors shadow-2xs"
              title="Refresh checkpoint from current execution state"
            >
              <Icon d={I.sun} size={12} />
              <span>Refresh</span>
            </button>
          )}

          {onCopyJson && (
            <button
              onClick={onCopyJson}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-heading bg-paper border border-ink/15 hover:bg-ink/5 text-ink/80 transition-colors shadow-2xs"
              title="Copy structured checkpoint summary as JSON"
            >
              <Icon d={I.code} size={12} />
              <span>{jsonCopied ? 'JSON Copied!' : 'Copy JSON'}</span>
            </button>
          )}
        </div>
      </div>

      {/* A. Project Overview Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-paper border border-ink/10 shadow-2xs space-y-1">
          <span className="text-[10px] font-mono uppercase text-ink/45">Execution Progress</span>
          <div className="flex items-baseline gap-2">
            <span className="font-heading font-bold text-lg text-ink">{projectOverview.progressPct}%</span>
            <span className="text-[11px] font-mono text-ink/50">
              ({projectOverview.tasksDone}/{projectOverview.tasksTotal} tasks)
            </span>
          </div>
          <div className="w-full bg-ink/10 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${projectOverview.progressPct}%`,
                background: metadata.status === 'Completed' ? '#10B981' : 'var(--accent)',
              }}
            />
          </div>
        </div>

        <div className="p-3 rounded-xl bg-paper border border-ink/10 shadow-2xs space-y-1">
          <span className="text-[10px] font-mono uppercase text-ink/45">Active Workload</span>
          <div className="font-heading font-bold text-lg text-ink">
            {projectOverview.tasksRunning} active
          </div>
          <p className="text-[11px] font-mono text-ink/50">
            {projectOverview.tasksPending} queued · {projectOverview.tasksFailed} failed
          </p>
        </div>

        <div className="p-3 rounded-xl bg-paper border border-ink/10 shadow-2xs space-y-1">
          <span className="text-[10px] font-mono uppercase text-ink/45">Computational Effort</span>
          <div className="font-heading font-bold text-lg text-ink">
            {fmtEffort(projectOverview.elapsedLogicalSeconds)}
          </div>
          <p className="text-[11px] font-mono text-ink/50">
            Real wall time: {(projectOverview.elapsedRealSeconds / 60).toFixed(1)} min
          </p>
        </div>

        <div className="p-3 rounded-xl bg-paper border border-ink/10 shadow-2xs space-y-1">
          <span className="text-[10px] font-mono uppercase text-ink/45">Last Checkpoint</span>
          <div className="font-heading font-bold text-xs text-ink truncate" title={metadata.createdAtFormatted}>
            {metadata.createdAtFormatted.split(',')[1]?.trim() || metadata.createdAtFormatted}
          </div>
          <p className="text-[11px] font-mono text-ink/50 truncate" title={metadata.checkpointId}>
            ID: {metadata.checkpointId}
          </p>
        </div>
      </div>

      {/* B. Work Completed Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-ink/10 pb-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <h4 className="font-heading font-bold text-sm text-ink uppercase tracking-wide">
            Work Completed ({workCompleted.tasks.length} Milestones)
          </h4>
        </div>

        {workCompleted.tasks.length > 0 ? (
          <div className="space-y-2">
            {workCompleted.tasks.map((task) => (
              <div
                key={task.id}
                className="p-3 rounded-xl bg-paper border border-ink/10 flex items-start justify-between gap-3 text-xs shadow-2xs"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-ink/80 bg-ink/5 px-1.5 py-0.5 rounded text-[11px]">
                      {task.id}
                    </span>
                    <span className="font-body font-semibold text-ink text-sm">
                      {task.description}
                    </span>
                    {task.assignedAgentName && (
                      <span className="text-[10px] font-mono text-ink/60 bg-ink/3 px-1.5 py-0.5 rounded border border-ink/10">
                        by {task.assignedAgentName}
                      </span>
                    )}
                  </div>
                  {task.resultPreview && (
                    <p className="font-mono text-[11px] text-ink/65 pl-2 border-l border-ink/20">
                      Output: {task.resultPreview}
                    </p>
                  )}
                </div>
                <span className="text-[10px] font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shrink-0">
                  ✓ DONE
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-mono text-ink/50 italic py-2">
            No completed tasks recorded in current execution state.
          </p>
        )}

        {/* Files Created or Modified */}
        {workCompleted.filesCreatedOrModified.length > 0 && (
          <div className="p-3 rounded-xl bg-ink/2 border border-ink/10 space-y-1.5 text-xs">
            <span className="font-heading font-semibold text-ink/80 text-[11px] uppercase tracking-wider">
              Source Deliverables Created / Modified ({workCompleted.filesCreatedOrModified.length} files)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {workCompleted.filesCreatedOrModified.map((f) => (
                <span
                  key={f}
                  className="font-mono text-[11px] bg-paper border border-ink/15 px-2 py-0.5 rounded-md text-ink/80 flex items-center gap-1"
                >
                  <Icon d={I.code} size={11} className="text-ink/40" />
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Architectural Decisions & Integrations */}
        {(workCompleted.architecturalDecisions.length > 0 || workCompleted.integrationsCompleted.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {workCompleted.architecturalDecisions.length > 0 && (
              <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-1 shadow-2xs">
                <span className="font-heading font-semibold text-ink/80 text-[11px] uppercase tracking-wider">
                  Architectural Decisions
                </span>
                <ul className="space-y-1 text-ink/75 font-body">
                  {workCompleted.architecturalDecisions.map((dec, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-ink/40">•</span>
                      <span>{dec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {workCompleted.integrationsCompleted.length > 0 && (
              <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-1 shadow-2xs">
                <span className="font-heading font-semibold text-ink/80 text-[11px] uppercase tracking-wider">
                  Verified Integrations & Gates
                </span>
                <ul className="space-y-1 text-ink/75 font-body">
                  {workCompleted.integrationsCompleted.map((integ, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-emerald-600 font-bold">✓</span>
                      <span>{integ}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* C. Current Implementation State */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-ink/10 pb-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <h4 className="font-heading font-bold text-sm text-ink uppercase tracking-wide">
            Current Implementation State
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-1.5 shadow-2xs">
            <span className="font-heading font-semibold text-emerald-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Verified / Functional Components
            </span>
            {currentState.implemented.length > 0 ? (
              <ul className="space-y-1 text-ink/75 font-body">
                {currentState.implemented.map((item, i) => (
                  <li key={i} className="truncate" title={item}>
                    • {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] font-mono text-ink/40">None functional yet.</p>
            )}
          </div>

          <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-1.5 shadow-2xs">
            <span className="font-heading font-semibold text-amber-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Partially Implemented / In Flight
            </span>
            {currentState.partiallyImplemented.length > 0 ? (
              <ul className="space-y-1 text-ink/75 font-body">
                {currentState.partiallyImplemented.map((item, i) => (
                  <li key={i} className="truncate" title={item}>
                    ⏳ {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] font-mono text-ink/40">No partially implemented tasks.</p>
            )}
          </div>

          {currentState.incomplete.length > 0 && (
            <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-1.5 shadow-2xs">
              <span className="font-heading font-semibold text-ink/70 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-ink/30" />
                Incomplete / Queued
              </span>
              <ul className="space-y-1 text-ink/65 font-body">
                {currentState.incomplete.map((item, i) => (
                  <li key={i} className="truncate" title={item}>
                    ⭕ {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {currentState.knownLimitations.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5 shadow-2xs">
              <span className="font-heading font-semibold text-amber-900 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                <Icon d={I.bug} size={12} className="text-amber-700" />
                Limitations & Operational Alerts
              </span>
              <ul className="space-y-1 text-amber-900 font-body text-[11px]">
                {currentState.knownLimitations.map((item, i) => (
                  <li key={i}>⚠️ {item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* D. Agent Execution Summary */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-ink/10 pb-1.5">
          <div className="w-2 h-2 rounded-full bg-violet-500" />
          <h4 className="font-heading font-bold text-sm text-ink uppercase tracking-wide">
            Agent Execution Summary
          </h4>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
          <div className="p-2.5 rounded-lg bg-ink/2 border border-ink/10">
            <span className="text-[10px] text-ink/40 uppercase">LLM Calls</span>
            <div className="font-bold text-ink">{agentExecution.totalLlmCalls}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-ink/2 border border-ink/10">
            <span className="text-[10px] text-ink/40 uppercase">Tool Calls</span>
            <div className="font-bold text-ink">{agentExecution.totalToolCalls}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-ink/2 border border-ink/10">
            <span className="text-[10px] text-ink/40 uppercase">Tokens In</span>
            <div className="font-bold text-ink">{agentExecution.totalTokensIn.toLocaleString()}</div>
          </div>
          <div className="p-2.5 rounded-lg bg-ink/2 border border-ink/10">
            <span className="text-[10px] text-ink/40 uppercase">Tokens Out</span>
            <div className="font-bold text-ink">{agentExecution.totalTokensOut.toLocaleString()}</div>
          </div>
        </div>

        {agentExecution.contributors.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
            {agentExecution.contributors.map((agent) => (
              <div
                key={agent.id}
                className="p-3 rounded-xl bg-paper border border-ink/10 space-y-1.5 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-heading font-bold text-ink">{agent.name}</span>
                  <span className="text-[9.5px] font-mono font-medium px-1.5 py-0.5 rounded bg-ink/5 border border-ink/10 text-ink/70">
                    {agent.role}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-ink/60 flex justify-between">
                  <span>{agent.department || 'Floor'}</span>
                  <span>{agent.tasksCompleted} done</span>
                </div>
                {agent.contextStage !== undefined && (
                  <div className="text-[10px] font-mono text-ink/50 flex justify-between">
                    <span>Context Stage:</span>
                    <span className="font-bold text-ink/70">
                      S{agent.contextStage} ({((agent.contextFrac ?? 0) * 100).toFixed(0)}%)
                    </span>
                  </div>
                )}
                {agent.keyActions.length > 0 && (
                  <div className="pt-1 border-t border-ink/5">
                    <p className="text-[10px] font-mono text-ink/40 uppercase">Key actions:</p>
                    <ul className="text-[10.5px] text-ink/75 space-y-0.5 mt-0.5 font-body">
                      {agent.keyActions.slice(0, 2).map((act, i) => (
                        <li key={i} className="truncate" title={act}>
                          • {act}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-mono text-ink/50 italic py-1">
            No agent contributions recorded yet.
          </p>
        )}
      </div>

      {/* E. Pending Tasks & Next Steps */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-ink/10 pb-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <h4 className="font-heading font-bold text-sm text-ink uppercase tracking-wide">
            Pending Tasks & Next Steps
          </h4>
        </div>

        {pendingTasksAndNextSteps.inProgressTasks.length > 0 && (
          <div className="space-y-2">
            <span className="text-[11px] font-heading font-semibold text-ink/75 uppercase tracking-wider">
              Currently Running
            </span>
            {pendingTasksAndNextSteps.inProgressTasks.map((t) => (
              <div
                key={t.id}
                className="p-3 rounded-xl bg-blue-50/50 border border-blue-200 text-xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-bold text-blue-900">{t.id}: {t.description}</span>
                  <span className="text-[10px] font-mono text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">
                    {t.progressPct}% IN PROGRESS
                  </span>
                </div>
                {t.assignedAgentName && (
                  <p className="text-[11px] text-blue-800">
                    Assigned Agent: {t.assignedAgentName}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {pendingTasksAndNextSteps.pendingTasks.length > 0 && (
          <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-2 text-xs shadow-2xs">
            <span className="text-[11px] font-heading font-semibold text-ink/75 uppercase tracking-wider">
              Queued Tasks ({pendingTasksAndNextSteps.pendingTasks.length})
            </span>
            <ul className="space-y-1.5 text-ink/80 font-body">
              {pendingTasksAndNextSteps.pendingTasks.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center justify-between border-b border-ink/5 pb-1">
                  <span>
                    <strong className="font-mono text-ink/90">[{t.id}]</strong> {t.description}
                  </span>
                  {t.dependencies && t.dependencies.length > 0 && (
                    <span className="text-[10px] font-mono text-ink/40">
                      depends on: {t.dependencies.join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {pendingTasksAndNextSteps.recommendedNextActions.length > 0 && (
          <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-2 text-xs">
            <span className="font-heading font-bold text-emerald-900 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <span>👉</span> Recommended Next Actions
            </span>
            <ol className="list-decimal ml-4 space-y-1 text-emerald-900 font-body">
              {pendingTasksAndNextSteps.recommendedNextActions.map((action, i) => (
                <li key={i} className="leading-relaxed">
                  {action}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* F. Technical Context */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 border-b border-ink/10 pb-1.5">
          <div className="w-2 h-2 rounded-full bg-cyan-500" />
          <h4 className="font-heading font-bold text-sm text-ink uppercase tracking-wide">
            Technical Context
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-2 shadow-2xs">
            <span className="text-[11px] font-heading font-semibold text-ink/75 uppercase tracking-wider">
              Technologies & Frameworks
            </span>
            <div className="flex flex-wrap gap-1.5">
              {technicalContext.technologies.map((t) => (
                <span key={t} className="px-2 py-0.5 rounded-full bg-ink/5 border border-ink/10 font-mono text-[11px]">
                  {t}
                </span>
              ))}
            </div>

            <span className="text-[11px] font-heading font-semibold text-ink/75 uppercase tracking-wider block pt-2">
              Architecture & Pacing
            </span>
            <ul className="space-y-1 text-ink/75 font-body">
              {technicalContext.architecture.map((a, i) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-paper border border-ink/10 space-y-2 shadow-2xs">
            <span className="text-[11px] font-heading font-semibold text-ink/75 uppercase tracking-wider">
              Environment & Continuation Details
            </span>
            <ul className="space-y-1 text-ink/75 font-body">
              {technicalContext.configurationAndEnvironment.map((e, i) => (
                <li key={i} className="font-mono text-[11px] truncate" title={e}>
                  • {e}
                </li>
              ))}
              {technicalContext.gitCheckpoint && (
                <li className="font-mono text-[11px] text-amber-800">
                  • Branch: {technicalContext.gitCheckpoint.branch} (commit {String(technicalContext.gitCheckpoint.startCommit).slice(0, 7)})
                </li>
              )}
            </ul>

            {technicalContext.criticalContinuationNotes.length > 0 && (
              <div className="pt-2 border-t border-ink/5 space-y-1">
                <span className="text-[10px] font-mono text-ink/40 uppercase">Continuation Guidance:</span>
                <ul className="space-y-1 text-ink/80 text-[11px] font-body">
                  {technicalContext.criticalContinuationNotes.map((note, i) => (
                    <li key={i}>💡 {note}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* G. Checkpoint Metadata Footer */}
      <div className="p-3 rounded-xl bg-ink/2 border border-ink/10 flex flex-wrap items-center justify-between text-[11px] font-mono text-ink/50">
        <div>
          <span>Checkpoint ID: </span>
          <span className="text-ink/80 font-bold">{metadata.checkpointId}</span>
          <span className="mx-2">|</span>
          <span>Version: </span>
          <span className="text-ink/80 font-bold">{metadata.version}</span>
        </div>
        <div>
          <span>Timestamp: </span>
          <span className="text-ink/80">{metadata.timestamp}</span>
        </div>
      </div>
    </div>
  );
}

