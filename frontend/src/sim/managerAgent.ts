import { useStore } from '@/state/store';
import { director } from '@/sim/director';
import { apiUrl } from '@/api/client';

export interface ChatMessage {
  role: 'user' | 'manager';
  text: string;
  ts: string;
}

class ManagerMemoryAgent {
  public reset(): void {
    const mgr = director.rt('M0');
    if (mgr) mgr.bubble = undefined;
  }
  private history: ChatMessage[] = [];

  public getHistory(): ChatMessage[] {
    return [...this.history];
  }

  public async processDirective(userText: string): Promise<string> {
    const s = useStore.getState();
    const now = s.simClock || '10:00';
    const goal = s.goal || 'Build a real-time crypto price tracker in React with the name of project as "CRYPTracker"';
    const isCrypto = /crypto|btc|eth|tracker|coin/i.test(goal);
    const projectName = isCrypto ? 'CRYPTracker' : goal.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'AutonexProject';
    const localDir = `D:\\AUTONEX\\output\\${projectName}`;

    this.history.push({ role: 'user', text: userText, ts: now });

    const lower = userText.toLowerCase().trim();
    let reply = '';
    let blackboardNote = '';

    // 1. Emergency Stop / Cancel
    if (lower.includes('stop') || lower.includes('halt') || lower.includes('cancel') || lower.includes('pause')) {
      reply = `Emergency Stop acknowledged. Halting entire system across all workers, tasks, manager loops, and processes.`;
      blackboardNote = `Entire system halted by operator directive.`;

      import('@/state/engine').then(({ haltEntireSystem }) => {
        haltEntireSystem();
      });
    }
    // 2. Real 0G Private Computer Reasoning & Conversation
    else {
      try {
        const systemPrompt = `You are Diya, the Lead Engineering Manager of the AUTONEX autonomous software development team on 0G Private Computer.
Current project: "${goal}" (Project name: ${projectName}).
Team members under your direction:
- Aanya: Architecture & Lead Systems Engineer
- Kabir: Lead Frontend Architect (React, TypeScript, WebSocket streaming, Tailwind)
- Nisha: QA & Verification Lead (Vitest, assertions, boundary checks)
- Tara: Technical Research & Documentation Lead
- Rohan: Senior Backend Engineer (APIs, WebSockets, rate limiters)
- Isha & Vikram: Frontend Core Developers
Deliverables destination: ${localDir}
Answer the user's inquiry with technical depth, crisp operational clarity, and professional leadership. Keep your response concise (2-4 sentences max).`;

        const resp = await fetch(apiUrl('/api/llm/chat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: userText,
            system: systemPrompt,
            model: s.modelId
          })
        });

        if (resp.ok) {
          const d = await resp.json();
          reply = d.reply || 'Reasoning complete.';
        } else {
          const errData = await resp.json().catch(() => ({}));
          reply = `[0G Router]: ${errData.error || '0G Inference failed'}`;
        }
      } catch (err: any) {
        reply = `0G Private Computer communication error: ${err?.message || 'Bridge offline'}`;
      }
      blackboardNote = `Diya responded to user directive via 0G Private Computer.`;
    }

    this.history.push({ role: 'manager', text: reply, ts: now });

    // 3D Office visual feedback: Speech bubble over Diya
    const mgr = director.rt('M0');
    if (mgr) {
      mgr.bubble = { text: reply.length > 90 ? reply.slice(0, 87) + '...' : reply, until: director.time + 6 };
    }

    // Update store log and blackboard
    setTimeout(() => {
      const st = useStore.getState();
      useStore.setState({
        log: [
          ...st.log,
          { id: Date.now() + 1, ts_sim: st.simClock, type: 'manager.response', text: `Diya ? You: "${reply}"` },
        ],
        notes: [
          ...st.notes,
          {
            id: `note_${Date.now()}`,
            author_agent_id: 'M0',
            topic: 'DIRECTIVE',
            note: blackboardNote || `Diya: ${reply}`,
            ts: st.simClock,
          },
        ],
        notePulse: Date.now(),
      });
    }, 250);

    return reply;
  }
}

export const managerAgent = new ManagerMemoryAgent();
