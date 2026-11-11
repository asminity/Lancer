# ETHGlobal Arkiv Track Qualification Checklist

This checklist maps each **ETHGlobal Arkiv Track** requirement to its exact implementation files, documentation, verification methods, and verifiable evidence in **AUTONEX**.

---

## Qualification Matrix

| Requirement | Implementation Location | Documentation Location | Verification Method | Verifiable Evidence |
|---|---|---|---|---|
| **1. Write to Arkiv Testnet** | `frontend/src/services/arkiv/operations.ts` (`createArkivRun`, `createArkivDeliverable`, `createArkivSwarmRound`) | `README.md` & `arkiv/schema.md` | Connected wallet submission on Rabdi DB-Chain (`7794095`) paying `tGLM` gas | System contract call to `0x4400000000000000000000000000000000000044` with confirmed `txHash` & `entityKey` |
| **2. Read from Arkiv Testnet** | `frontend/src/ui/ArkivHistoryModal.tsx`, `operations.ts` (`queryPublicRuns`, `getDeliverableByRunId`) | `README.md` & `arkiv/why-arkiv.md` | Public JSON-RPC read queries (`arkiv_query`, `arkiv_getEntity`) | Live UI rendering in **Arkiv Verifiable Project Explorer** modal without wallet connection |
| **3. Wallet Authorization & tGLM** | `frontend/src/ui/ConnectWalletButton.tsx`, `frontend/src/config/chain.ts`, `frontend/src/services/arkiv/balance.ts` | `README.md` & `arkiv/schema.md` | Wagmi v2 injected connector + Viem `custom(transport)` | Live `tGLM` balance display, Rabdi chain ID switch prompt, explicit user transaction approval |
| **4. Reproducible Query** | `scripts/reproduce-query.mjs` | `README.md` | Automated Node.js verification script: `node scripts/reproduce-query.mjs` | Queries `arkiv.schema = str('autonex.run')` at block height ~264,500; exits code 0 |
| **5. Complete Schema Specification** | `frontend/src/services/arkiv/schemas.ts` | `arkiv/schema.md` | Typed schemas using `defineSchema()` with `str`, `addr`, `u64`, `dec`, `bytes` | `autonex.run`, `autonex.deliverable`, `autonex.swarm_round`, `autonex.audit_log` |
| **6. Developer Friction & Feedback (25%)** | N/A (Documentation & Developer Experience) | `arkiv/friction.md` | Comprehensive analysis of SDK v1.0.1, TypeScript types, EIP-55 checksumming, raw query tags | Concrete bugs, reproduction steps, expected vs. actual behaviors, and feature recommendations |
| **7. Architectural Justification / Why Arkiv (25%)** | System-wide decentralized data flow | `arkiv/why-arkiv.md` | Direct contrast against PostgreSQL, MongoDB, EVM smart contracts, and IPFS | Multi-agent cryptographic quorum, zero-gas reads, native TTL, wallet-owned codebases |
| **8. Reach & Target Audience (25%)** | Dual-engine simulation (Office & Swarm) | `arkiv/reach.md` | End-to-end user journey walkthrough and live testing guide | DAOs, autonomous AI engineers, protocol architects, and post-hackathon roadmap |
| **9. Test Suite & Code Quality** | `frontend/src/tests/arkiv.test.ts` (19 Arkiv tests) | `frontend/src/tests/` | Automated test runner: `npm run check` / `npx vitest run` | 59/59 Vitest unit tests passed (10/10 test files), 0 TypeScript errors |
| **10. Open-Source License & AI Disclosure** | `LICENSE` (MIT) | `README.md` | Root MIT license file + AI usage disclosure in `README.md` | Permissive open-source license; transparent AI disclosure for simulation and coding assistance |
