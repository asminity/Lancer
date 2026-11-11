# Arkiv Developer Friction & Feedback Report

This document records the developer experience, hurdles, edge cases, and constructive recommendations encountered while building **AUTONEX** on the **Arkiv Rabdi DB-Chain Testnet** (`Chain ID: 7794095`) using `@arkiv-network/sdk` v1.0.1.

---

## 1. What Did You Run Into That Got in Your Way?

### 1.1. Strict EIP-55 Address Checksum Requirement in `addr()`
- **What We Expected:** Passing a valid Ethereum hex address string (e.g., `'0x71c6793f1e602757a0a23b27732890539129e924'`) to `addr(userAddress)` would automatically normalize or checksum the string before insertion.
- **What Actually Happened:** The SDK immediately threw a runtime error:  
  `Invalid addr value fails its EIP-55 checksum`.
- **How We Solved It:** We had to wrap every address with `getAddress(rawAddress)` from `viem` to enforce checksumming prior to calling `addr()`.
- **Recommendation:** `addr()` should automatically format or normalize valid hex addresses using EIP-55 internally rather than failing with an exception.

---

### 1.2. TypeScript Typing Mismatch for `BytesValue`
- **What We Expected:** Accessing a `bytes` column on a retrieved entity row would provide standard `Uint8Array` or `ArrayBufferView` types that directly pass to `TextDecoder.prototype.decode()`.
- **What Actually Happened:** In `@arkiv-network/sdk`, the return type is typed as `BytesValue` which does not satisfy TypeScript's `AllowSharedBufferSource` without an explicit `as any` or manual cast.
- **How We Solved It:** Used `decoder.decode(entity.bundle_bytes as any)` to satisfy TypeScript compilation during `tsc --noEmit`.
- **Recommendation:** Add a helper method on `BytesValue`, such as `entity.bundle_bytes.asUint8Array()` or `entity.bundle_bytes.asText()`, to make decoding text or JSON payloads ergonomic.

---

### 1.3. Untagged String Query Syntax in Raw JSON-RPC vs SDK Expressions
- **What We Expected:** In raw JSON-RPC calls to `arkiv_query`, standard SQL-like string syntax like `arkiv.schema = 'autonex.run'` would be parsed as a string value.
- **What Actually Happened:** The node rejected the query with:  
  `RPC Error (-32002): untagged strings are only valid for system attributes — write str('…')`.
- **How We Solved It:** In raw JSON-RPC scripts, queries must explicitly write `arkiv.schema = str('autonex.run')`, whereas in the SDK one uses `eq('arkiv.schema', 'autonex.run')`.
- **Recommendation:** Clarify in the JSON-RPC documentation that all user attributes and schemas in raw query strings require typed wrapper functions like `str('value')` and `u64(123)`.

---

### 1.4. Wagmi v2 / Viem Wallet Client Custom Transport Wiring
- **What We Expected:** Standard `createWalletClient({ chain: rabdiTestnet, ... })` with an injected connector would seamlessly interface with Wagmi's `useWalletClient()`.
- **What Actually Happened:** Wagmi v2 manages its own account connection and transport state. To construct a working Arkiv wallet client without prompting users multiple times, we wrapped `walletClient.transport` with `custom(walletClient.transport)` from `viem`:
  ```typescript
  return createWalletClient({
    account: walletClient.account,
    chain: rabdi({ accessKey }),
    transport: custom(walletClient.transport),
  });
  ```
- **Recommendation:** Provide an official `@arkiv-network/wagmi` adapter or hook (`useArkivWalletClient()`) that eliminates boilerplate custom transport wrapping in React/Vite frontends.

---

## 2. What Features Are Missing That Would Make Building Easier?

1. **Native Blob / Multi-file Packaging Helpers:**
   - Many applications (including AUTONEX) store multi-file codebases, artifacts, or JSON graphs. Having a first-class utility in `@arkiv-network/sdk` like `ArkivBundle.encode(files)` and `ArkivBundle.decode(entity.bundle_bytes)` would save developers from writing repetitive encoding logic.
2. **Built-in Balance & Gas Estimator:**
   - Developers currently query balance via standard `eth_getBalance` or Viem `client.getBalance(address)`. Adding a `client.getTglmBalance(address)` and `client.estimateEntityStorageCost(bytes, expiration)` helper would allow frontends to display precise storage cost estimates before triggering the user's wallet signature.
3. **Paginated Cursor Support in Queries:**
   - Currently, pagination relies on `{ limit: N }`. Adding an explicit cursor or offset pagination (e.g. `{ limit: 25, cursor: entity.$key }`) would make browsing large datasets more predictable.
4. **Interactive Schema Explorer in Arkiv Hub:**
   - The Arkiv Hub currently displays access keys and testnet faucets. Adding a Web UI table explorer where developers can browse all registered schemas, test query filters interactively, and view live entity states would dramatically speed up debugging.

---

## 3. Roadblocks & Reproducibility Table

| Roadblock | Expected Behavior | Actual Behavior | How to Reproduce | Fix Implemented |
|---|---|---|---|---|
| **EIP-55 Address Checksum** | Case-insensitive hex address accepted in `addr()` | Throws `Invalid addr value fails its EIP-55 checksum` | Call `addr('0x71c6...e924')` with lowercase hex | Wrapped with `getAddress()` in Viem |
| **BytesValue in TypeScript** | Compatible with `TextDecoder.decode()` | Type error TS2345: `BytesValue` not assignable to buffer | Pass entity byte column to `decoder.decode()` under `tsc --noEmit` | Cast with `as any` before decoding |
| **Raw JSON-RPC Query Syntax** | `arkiv.schema = 'name'` accepted | Error `-32002`: `untagged strings are only valid for system attributes` | Send raw `arkiv_query` with untagged string parameter | Enforced `str('autonex.run')` in raw RPC params |
| **Public Rate-Limit Notice** | Silent default | Emits console warning when `accessKey` is omitted | Initialize `rabdi({ accessKey: '' })` without key | Handled gracefully via `VITE_ARKIV_ACCESS_KEY` fallback |

---

## 4. Overall Impression & Strengths

Despite minor friction around type ergonomics, the core Arkiv experience is exceptionally strong:
- **Fast 2-second block times** on the Rabdi testnet allow write transactions to confirm almost instantaneously.
- **Zero-gas public reads** remove all onboarding friction for users wanting to verify and download codebase deliverables.
- **SQL-like entity filtering** (`eq`, `and`) provides expressive querying capabilities that are impossible on standard smart contract storage without running an external indexer (like The Graph).
- Combining decentralized database storage with native wallet authentication makes Arkiv an ideal fit for verifiable autonomous AI workflows.
