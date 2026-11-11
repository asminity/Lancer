import { LAYOUT } from '@/config/layout';
import { Dept } from '@/config/office';
import { ModelInfo } from '@/api/types';
import { TriageOut } from './triage';
import { BAY_ZONES } from '@/state/departments';

export interface AgentDef {
  id: string; name: string; role: 'manager' | 'lead' | 'worker'; department: Dept | null;
  parent_id: string | null; engine: { kind: 'llm' | 'tool' | 'code'; label: string };
  avatar_seed: number; chairId: string;
}

const NAMES = [
  'Aanya', 'Rohan', 'Meera', 'Kabir', 'Isha', 'Vikram', 'Nisha', 'Arjun',
  'Tara', 'Dev', 'Kavya', 'Farhan', 'Anaya', 'Zoya', 'Neel', 'Riya',
  'Sameer', 'Divya', 'Karan', 'Pooja', 'Yash', 'Sneha', 'Aryan', 'Lata',
];

const llmBig = { kind: 'llm' as const, label: '0G · glm-5.3-flash (manager)' };

function wsChair(bay: string, i: number): string {
  // bays are physical wings: map a run department's wing -> that wing's workstation chairs
  const bayZone = BAY_ZONES[bay] ?? 'researchBay';
  const zoneChairs = LAYOUT.items.filter((it) => it.zone === bayZone && it.type === 'wchair' && it.data?.wsId);
  return (zoneChairs[i] ?? zoneChairs[0]).id;
}

function leadChairFor(bay: string): string {
  const map: Record<string, string> = {
    NW: LAYOUT.leadChairs.research, NE: LAYOUT.leadChairs.engineering,
    SW: LAYOUT.leadChairs.data, SE: LAYOUT.leadChairs.content,
  };
  return map[bay] ?? LAYOUT.leadChairs.research;
}

export function buildOrg(t: TriageOut): { org: AgentDef[]; leads: AgentDef[]; workers: AgentDef[]; manager: AgentDef } {
  const org: AgentDef[] = [];
  let nameIdx = 0, seed = 10;

  const manager: AgentDef = {
    id: 'M0', name: 'Diya', role: 'manager', department: null, parent_id: null,
    engine: llmBig, avatar_seed: 1, chairId: LAYOUT.execChair,
  };
  org.push(manager);

  const leads: AgentDef[] = [], workers: AgentDef[] = [];
  for (const d of t.departments) {
    const leadId = `L_${d.id}`;
    const lead: AgentDef = {
      id: leadId, name: NAMES[nameIdx++ % NAMES.length], role: 'lead', department: d.id,
      parent_id: 'M0',
      engine: { kind: 'llm', label: `llm:${d.lead_model.split('/').pop()}` },
      avatar_seed: seed++, chairId: leadChairFor(d.bay),
    };
    org.push(lead); leads.push(lead);
    const n = Math.max(1, Math.min(d.est_workers, 4));
    for (let i = 0; i < n; i++) {
      const isCode = d.id === 'backend' || d.id === 'frontend';
      const w: AgentDef = {
        id: `W_${d.id}_${i}`, name: NAMES[nameIdx++ % NAMES.length], role: 'worker',
        department: d.id, parent_id: leadId,
        engine: {
          kind: isCode ? 'code' : d.id === 'research' || d.id === 'data' ? 'tool' : 'llm',
          label: `${isCode ? 'code' : 'llm'}:${d.worker_model.split('/').pop()}`,
        },
        avatar_seed: seed++, chairId: wsChair(d.bay, i),
      };
      org.push(w); workers.push(w);
    }
  }
  return { org, leads, workers, manager };
}

export function deskOf(id: string, org: AgentDef[]): { x: number; z: number } {
  const it = LAYOUT.items.find((i) => i.id === org.find((a) => a.id === id)?.chairId);
  return it?.seat ? { x: it.seat.x, z: it.seat.z } : { x: it!.x, z: it!.z };
}

// All model selections and fallbacks are served by 0G Private Computer.
export const MODELS: ModelInfo[] = [
  { id: '0g/glm-5.3-flash', label: '0G Private Computer · GLM 5.3 Flash (manager default)', provider: '0g', context_tokens: 1179648 },
  { id: '0g/qwen3-coder-flash', label: '0G Private Computer · Qwen 3 Coder Flash (engineer)', provider: '0g', context_tokens: 1000000 },
  { id: '0g/kimi-k2.7-code', label: '0G Private Computer · Kimi K2.7 Code (QA / verifier)', provider: '0g', context_tokens: 262144 },
  { id: '0g/deepseek-v4.1-flash', label: '0G Private Computer · DeepSeek V4.1 Flash', provider: '0g', context_tokens: 1441792 },
  { id: '0g/qwen3.7-flash', label: '0G Private Computer · Qwen 3.7 Flash (swarm divergence)', provider: '0g', context_tokens: 1000000 },
  { id: '0g/qwen-flash', label: '0G Private Computer · Qwen Flash (quorum voting)', provider: '0g', context_tokens: 1000000 },
];
export const modelContext = (id: string) => MODELS.find((m) => id.endsWith(m.id) || m.id.endsWith(id))?.context_tokens ?? 32768;

export const DAG_NODES = [
  { id: 'T1', parent_id: 'M0', description: 'Verify the 0G model integration and routing', owner_role: 'research', assigned_agent: 'W1', status: 'ready', priority: 2, depends_on: [], attempts: 0, progress_pct: 0, est_effort_s: 1800 },
];
export const DAG_EDGES: { from: string; to: string }[] = [];

export const REPORT_MD = `# 0G Model Integration

## Summary
AUTONEX routes planning, coding, QA, and swarm requests through the 0G Private Computer Router.

## Findings
Each role selects from the supported 0G model catalogue, and all retries remain within that catalogue.

## Recommendation
Configure a 0G API key and choose an approved 0G model for each task role.
`;

export const SOLO_REPORT_MD = `# Quick draft

Here is a short, self-contained draft written directly by the manager — no team was needed for a single-output task.

> AUTONEX runs a terminal-first coding agent on 0G Private Computer models, with a permission-gated sandbox, staged context discipline, and one-command rollback.
`;

export const SOURCES = [
  { title: '0G Private Computer Router', url: 'https://router-api.0g.ai/v1/models', verified: true },
];
