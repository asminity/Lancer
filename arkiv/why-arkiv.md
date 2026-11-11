# Why Arkiv? Architectural Justification

This document evaluates the architectural rationale for choosing **Arkiv Network** as the decentralized persistence layer for **AUTONEX**, specifically answering the core ETHGlobal Arkiv judging evaluation:

> *"If you swapped out Arkiv for traditional databases like Postgres or standard backend storage, how would your architecture break or change?"*

---

## 1. What Breaks If We Swap Arkiv for Postgres or Centralized Cloud Storage?

If AUTONEX were rebuilt using a traditional relational database (e.g. PostgreSQL, MongoDB, or AWS S3):

```
┌──────────────────────────────────────────────┐       ┌──────────────────────────────────────────────┐
│           TRADITIONAL POSTGRESQL             │       │             ARKIV NETWORK (RABDI)            │
├──────────────────────────────────────────────┤       ├──────────────────────────────────────────────┤
│ ❌ Centralized trust in server admin         │       │ ✅ Cryptographic decentralization            │
│ ❌ Server operator can tamper with code/logs │       │ ✅ Immutability anchored on Rabdi DB-Chain   │
│ ❌ No native Web3 wallet ownership           │       │ ✅ True user ownership via connected wallet  │
│ ❌ Requires backend API server to read code  │       │ ✅ Zero-gas public JSON-RPC direct reads     │
│ ❌ Requires custom indexing & DB cron jobs   │       │ ✅ Native protocol-enforced TTL expiration   │
│ ❌ Vulnerable to server downtime & censorship│       │ ✅ Distributed, permissionless verification  │
└──────────────────────────────────────────────┘       └──────────────────────────────────────────────┘
```

### Specific Breakages:
1. **Loss of Verifiable Autonomous Provenance:**
   - In AUTONEX, autonomous agents deliberate in Swarm Hall, cast Borda ballots, and generate code without human intervention.
   - Storing these consensus proofs in Postgres would reduce trust to zero: a central server administrator could alter quorum numbers, modify test pass rates, or silently inject malicious code into generated files.
   - With Arkiv, every deliverable and swarm consensus proof is cryptographically sealed by the user's wallet on Rabdi DB-Chain.
2. **Loss of Direct Client-to-Database Decentralization:**
   - With Postgres or MongoDB, every client, CI/CD runner, or auditor must make authenticated requests through a central backend web server.
   - Arkiv allows any client anywhere in the world to query `arkivPublicClient.query()` over standard JSON-RPC without an intermediary backend server and without paying gas.
3. **Loss of Native Wallet Ownership & Non-Custodial Control:**
   - In traditional architectures, "ownership" is just a foreign key in a database table owned by the platform operator.
   - On Arkiv, entity ownership is enforced at the consensus layer by the user's cryptographic wallet key (`$owner`). Only the signing wallet can extend storage duration or prune entities.

---

## 2. Why Not Smart Contracts (EVM Storage) or IPFS?

### The EVM Smart Contract Dilemma:
- Storing multi-file codebases (10–30 KiB) and full JSON deliberation graphs directly in EVM storage (`SSTORE`) is economically unviable, costing hundreds of dollars per simulation run.
- EVM storage does not support expressive, SQL-like querying over non-trivial attributes without spinning up a complex custom indexing layer (such as The Graph or Goldsky).

### The IPFS / Arweave Dilemma:
- IPFS is a content-addressed file system, not a database: it does not support SQL-style filtering (`where agreement > 90.0 and mode = 'swarm'`), entity patching, or protocol-enforced TTL expiration.
- Arweave requires permanent storage payments, which is wasteful for ephemeral simulation logs or intermediate deliberation rounds.

### The Arkiv Solution:
Arkiv combines the best of both worlds:
1. **SQL-Like Expressive Filtering:** Queries such as `and(eq('arkiv.schema', 'autonex.run'), eq('owner', userAddress))` execute directly against the RPC without external indexing middleware.
2. **Native Expiration (TTL):** Simulation records naturally expire after 90 days, keeping storage fees minimal.
3. **Wallet-Authorized Writes & Zero-Gas Reads:** Users pay micro-fees in `tGLM` to commit entities, while anyone can read and download deliverables for free.

---

## 3. How AUTONEX Leverages Arkiv's Specific Capabilities

| Arkiv Capability | How AUTONEX Employs It |
|---|---|
| **SQL-Like Querying** | Filters public network runs, user runs, deliverable files, and swarm deliberation rounds by indexed attributes (`run_id`, `owner`, `round`, `l2_tests_pass`). |
| **Typed Schemas (`defineSchema`)** | Defines strict contracts (`autonex.run`, `autonex.deliverable`, `autonex.swarm_round`, `autonex.audit_log`) ensuring verified integrity of all agent outputs. |
| **`bundle_bytes` Non-Indexed Storage** | Packs entire multi-file codebases and markdown reports into non-indexed byte arrays up to 128 KiB, keeping write fees low while allowing live in-browser ZIP extraction. |
| **Native Protocol Expiration** | Enforces a 90-day retention period for testnet simulation runs with an interactive **"+90d Preserve"** button calling `extendArkivEntity()`. |
| **Connected Wallet Signing** | Reuses the user's browser wallet (MetaMask) on Rabdi Testnet (`7794095`) with `tGLM` native currency, guaranteeing zero private key exposure. |
| **Zero-Gas Public Reads** | Powers the public **Arkiv Verifiable Project Explorer** where anyone can inspect code, review test scores, and load on-chain projects into their workspace with zero gas. |
