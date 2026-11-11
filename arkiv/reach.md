# Arkiv Reach & User Journey Report

This document assesses the target audience, real-world utility, current testing accessibility, and development roadmap for **AUTONEX** on the **Arkiv Network**.

---

## 1. Who Is the Target Audience, and Would They Realistically Use It?

### Primary Audiences:

1. **Decentralized Autonomous Engineering Teams & DAOs:**
   - **The Problem:** DAOs and decentralized protocols frequently commission development grants, audits, and open-source bounties, but tracking verifiable milestone deliverables across distributed contributors is fragmented.
   - **How AUTONEX Solves It:** A DAO can issue a task to AUTONEX's Swarm Hall. The agents convene, debate architectures, verify requirements, and publish the final code directly to Arkiv. The DAO can independently verify the consensus proof and download the codebase directly from the Rabdi DB-Chain.

2. **Web3 Protocol Developers & Smart Contract Engineers:**
   - **The Problem:** Iterating on complex multi-contract architectures requires cross-examination of security assumptions (skeptic vs. pragmatist vs. security analyst).
   - **How AUTONEX Solves It:** Swarm Mode provides structured adversarial deliberation, voting, and code generation with verifiable on-chain outputs.

3. **Autonomous AI Researchers & Safety Auditors:**
   - **The Problem:** Monitoring autonomous multi-agent systems requires transparent visibility into agent tool executions, rate-limit backoffs, and human permissions.
   - **How AUTONEX Solves It:** AUTONEX can log permission approvals (`file.write`, `shell.exec`) to `autonex.audit_log` on Arkiv, providing an immutable audit trail of human oversight.

---

## 2. Can Users Test and Try It Out Today?

**Yes.** AUTONEX's Arkiv integration can be tested on the **Arkiv Rabdi DB-Chain Testnet**:

### Step-by-Step Testing Flow:
1. **Clone & Launch:**
   ```bash
   git clone https://github.com/pritul-singh/AUTONEX.git
   cd AUTONEX
   npm install
   npm run dev
   ```
2. **Open in Browser:** Navigate to `http://localhost:5173`.
3. **Explore Existing On-Chain Records (No Wallet Needed):**
   - Click the **`Browse Arkiv Ledger ↗`** button on the landing page or the **Database** icon in the navbar.
   - Browse the **Public Network Runs** tab to inspect on-chain runs, consensus quorum stats, and code files.
   - Click **`Download .ZIP`** to extract on-chain code directly from Arkiv `bundle_bytes`.
   - Click **`Load into Workspace`** to restore an on-chain project into the active AUTONEX workspace.
4. **Publish Your Own Project to Arkiv (Using Connected Wallet):**
   - Click **Connect Wallet** in the top-right navbar and connect MetaMask.
   - Ensure your wallet is switched to **Rabdi DB-Chain Testnet** (Chain ID: `7794095`).
   - Acquire testnet `tGLM` from the official Arkiv Hub faucet (`https://hub.arkiv.network/`).
   - Launch a simulation in Deskmates Office Mode or Swarm Hall Mode.
   - In the Final Report modal, click **Publish to Arkiv DB-Chain**.
   - Confirm the transaction in MetaMask (pays ~0.0001 `tGLM` gas).
   - Once confirmed, click the **Entity Key** link to inspect your live entity on `https://rabdi.explorer.arkiv.network`.

---

## 3. Post-Hackathon Roadmap & Maintenance Plan

### Phase 1: Mainnet Migration (Q2 2026)
- Transition schemas from Rabdi Testnet to the Arkiv Mainnet once production network parameters are finalized.
- Add multi-network configuration support so users can toggle between Rabdi Testnet and Mainnet.

### Phase 2: Autonomous Bounty Settlement via Arkiv Proofs
- Connect Arkiv entity keys to smart contract escrow pools (e.g. on Ethereum / Arbitrum / Base).
- Release bounty funds automatically when an `autonex.deliverable` entity is confirmed on Arkiv with `l2_tests_pass = true` and `l3_score >= 90.0`.

### Phase 3: Decentralized CI/CD Integration
- Publish an npm package `@autonex/arkiv-cli` allowing GitHub Actions and GitLab CI runners to pull verified codebase entities directly from Arkiv via entity key or run ID without running a local database.

### Phase 4: Long-Term Protocol Sustainability
- Sponsor dedicated community RPC endpoints and indexer nodes on Arkiv.
- Provide automated renewal bots for high-value open-source deliverables using the Arkiv `extendEntity` protocol.
