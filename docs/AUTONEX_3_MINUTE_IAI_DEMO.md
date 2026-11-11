# AUTONEX: 3-Minute iAI Credit Optimization Demo Walkthrough

> **Autonomous Engineering Floor · 0G Private Computer · iAI Staking & Ethereum Swarm Storage**  
> A guided, 3-minute, judge-ready walkthrough demonstrating how AUTONEX eliminates token waste and prevents daily 00:00 UTC compute credit expiration.

---

## 1. Executive Summary & Core Objective

### The Problem AUTONEX Solves
iAI token holders staking collateral in the official 0G Mainnet Vault (`0x94a5d41dfae4f2ee7c61a80f33a5085c8c252c70`) unlock daily **0G Private Computer credits** at a mathematical entitlement rate of **1.271 credits per staked iAI per day**.

However, **all unused daily credits strictly expire at 00:00 UTC**. Without proactive scheduling:
1. **Unspent Allowances Expire**: Users lose 40% to 70% of their daily compute entitlement every 24 hours.
2. **Context Inefficiency Burns Quota**: Un-optimized prompts dump massive raw codebases into LLM contexts, exhausting credits on duplicate tokens.
3. **Mid-Flight Expiration & State Loss**: Jobs cut off mid-execution lose all intermediate reasoning without decentralized checkpoints.

### What AUTONEX Demonstrates in 3 Minutes
AUTONEX provides an autonomous optimization pipeline that:
1. **Monitors Credit Expiry**: Tracks daily allowance, reserves safety buffers, and counts down to 00:00 UTC.
2. **Deduplicates & Prioritizes Backlogs**: Detects and prunes redundant tasks before any inference is billed.
3. **Optimizes Swarm Tokens**: Achieves over **70% context token reduction** via AST semantic slicing, blackboard cross-agent context sharing, and role-specialized 0G models.
4. **Governs Authoritative Utilization**: Records live provider telemetry (`x_0g_trace`) and defers low-priority tasks rather than risking out-of-budget failures.
5. **Decentralized Checkpoint & Resume**: Anchors compact state to **Ethereum Swarm (BZZ)** with bit-level SHA-256 verification and allows resuming deferred work.

---

## 2. Five-Stage Guided Walkthrough (Timeline: 0:00 – 3:00)

```
0:00                    0:30                   1:00                 1:40               2:20             3:00
┌───────────────────────┬──────────────────────┬────────────────────┬──────────────────┬────────────────┐
│   STAGE 1 (30s)       │   STAGE 2 (30s)      │   STAGE 3 (40s)    │   STAGE 4 (40s)  │  STAGE 5 (40s) │
│  iAI Credit Dashboard │  Task Prioritization │ Swarm Token Opt.   │ Credit Ledger    │ Swarm Storage  │
│  • Staked Position    │  • Deduplication     │ • 70.7% Token Cut  │ • Actual Usage   │ • SHA-256 Hash │
│  • 00:00 UTC Expiry   │  • Budget Envelope   │ • 4 Model Roles    │ • Safety Buffer  │ • State Resume │
└───────────────────────┴──────────────────────┴────────────────────┴──────────────────┴────────────────┘
```

---

### Stage 1: iAI Credit Dashboard (0:00 – 0:30)

#### What Judges See:
- **Connected Wallet Badge**: Proves connection to 0G Mainnet (Aristotle, Chain ID `16661`).
- **Staked iAI Balance**: Sourced from the verified Vault debt position (`positionOf(account)`). Shows 5,000 staked iAI backed by 10,000 a0G collateral.
- **Daily Entitlement Rate**: Accurately displays $5,000 \times 1.271 = 6,355.00\text{ credits/day}$.
- **Next 00:00 UTC Expiry Countdown**: Live tick timer displaying exact hours, minutes, and seconds until the daily reset.
- **Credit Allocation Breakdown**:
  - Confirmed Consumed: `1,420.50 cr` (22.4%)
  - Reserved for Planned Tasks: `850.00 cr` (13.4%)
  - Remaining Available: `4,084.50 cr` (64.2%)
- **Honest Accounting Distinction**: Clearly explains that 0G `sk-` inference keys bill directly per-request, while account introspection requires `mk-` management keys; no fabricated balances are shown.

---

### Stage 2: Intelligent Task Prioritization (0:30 – 1:00)

#### What Judges See:
- **Backlog Ingestion**: AUTONEX scans 7 pending engineering tasks totaling 136,000 raw tokens.
- **Pruning Redundant Work**: Identifies and removes 2 redundant tasks upfront:
  1. *Full AST Codebase Re-index Sweep #1*: Duplicate of recent cache; static vendor files unchanged. Saved: 32,000 tokens (450 cr).
  2. *Duplicate Schema Validation Pass*: Redundant with live TypeScript compiler & Viem runtime validation. Saved: 14,500 tokens (210 cr).
- **Value & Dependency Matrix**: Evaluates remaining tasks by priority (Critical > High > Medium > Low) and value score (1–100).
- **Expiry Window Envelope**: Determines that 4 high-value tasks can cleanly execute within 15 minutes—well before the 00:00 UTC deadline.
- **Scheduled vs. Deferred**:
  - Scheduled: 4 tasks (535.0 credits / 37,100 tokens).
  - Deferred: 1 heavy benchmark simulation (`TASK-106`, est. 620 credits), preserved for future budget.

---

### Stage 3: Token-Efficient Swarm Execution (1:00 – 1:40)

#### What Judges See:
- **Specialized Multi-Agent Floor**:
  | Agent | Role | 0G Model | Responsibility |
  |---|---|---|---|
  | **Diya** | Planner | `0g/glm-5.3-flash` | Architectural decomposition & DAG planning |
  | **SearXNG** | Researcher | `0g/deepseek-v4.1-flash` | Relevant symbol extraction & deduplication |
  | **Rohan** | Senior Coder | `0g/qwen3-coder-flash` | Modular code synthesis & AST diff generation |
  | **Nisha** | QA Verifier | `0g/kimi-k2.7-code` | Consensus verification, test gates & assertions |
- **Quantifiable Token Savings**:
  - Naive Context: `61,900 tokens`
  - Optimized Context: `18,150 tokens`
  - **Measured Context Reduction: 70.7% (43,750 tokens saved)**
- **Techniques in Action**:
  - *AST Semantic Slicing*: Omits unchanged vendor files and passing only targeted signatures.
  - *Blackboard Deduplication*: Cross-agent findings are shared without repeating prompts.
  - *Prompt Compression*: Strips boilerplate framing across rounds.
- **Live Interactive Step**: Judges can click "Step Swarm Execution ⚡" to trigger live 0G inference and observe token telemetry in real time.

---

### Stage 4: Intelligent Credit Utilization (1:40 – 2:20)

#### What Judges See:
- **Authoritative Provider Accounting**: Displays usage matched to 0G Private Computer `x_0g_trace` micro-cost metadata.
- **Credit Allocation Ledger**:
  - Initial Authorized: `6,355.00 credits`
  - Confirmed Consumed: `1,955.50 credits` (after Swarm step)
  - Remaining Authorized: `3,864.50 credits`
- **15% Safety Buffer**: Demonstrates how AUTONEX reserves `953.25 credits` as a safety cushion to prevent in-flight out-of-budget model errors.
- **Safe Task Deferral**: Explains why `TASK-106` (620 credits) was deferred rather than executed recklessly: starting it would have breached the safety buffer. Its progress is cleanly queued for checkpointing.

---

### Stage 5: Checkpoint Storage & Recovery (2:20 – 3:00)

#### What Judges See:
- **Compact Checkpoint Serialization**: Serializes metadata, completed task IDs, deferred tasks, token usage, and credit accounting into a lightweight JSON payload (no massive raw repo dumps).
- **Real Ethereum Swarm Storage**:
  - Uploads payload directly to Ethereum Swarm (`/bzz`).
  - Receives deterministic 64-hex **Swarm Content Reference (BZZ)**.
  - Generates immutable bit-level **SHA-256 Digest**.
- **Cryptographic Retrieval & Verification**:
  - Fetches the raw file back from Swarm.
  - Computes `crypto.subtle.digest('SHA-256', bytes)`.
  - Confirms bit-for-bit authenticity with a green badge: `✓ Checkpoint Cryptographically Verified on Swarm`.
- **Incomplete Task Resume**:
  - Judges click "Resume Incomplete Task ↻".
  - AUTONEX re-hydrates `TASK-106` from the Swarm checkpoint, demonstrating that deferred or interrupted work is preserved without losing previous reasoning or re-paying for completed tokens.
- **Final Results Grid**:
  - 4 Tasks Completed
  - 1 Task Deferred & Recovered
  - 2 Redundant Tasks Pruned
  - 43,750 Tokens Saved (70.7% Context Reduction)
  - 535.0 Credits Consumed (Exact Telemetry)
  - 100% Swarm Verification

---

## 3. How to Launch the Demonstration

1. **From the Landing Page**:
   - Click the **"⚡ iAI Demo (3m)"** button in the top navbar, OR
   - Click the **"3-Minute iAI Credit Optimization Demo"** banner in the hero section.
2. **From the 3D Virtual Office Toolbar**:
   - Click the **"⚡ iAI Demo"** button on the right side of the toolbar.
3. **Demo Controls**:
   - Use **"Next Stage →"** and **"← Previous Stage"** to control the presentation speed.
   - Click **"▶ Auto-Play 3-Min Flow"** for a hands-free timed walkthrough.
   - Toggle between **Demo Mode** (sample fixtures) and **Production Mode** (live on-chain 0G Mainnet & 0G Router).

