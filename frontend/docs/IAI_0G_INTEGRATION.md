# AUTONEX: iAI Holder Integration & 0G Private Computer

This document specifies the technical architecture, smart contract interfaces, wallet verification protocols, and credit consumption mechanics for the **iAI Holder Integration** in **AUTONEX** using **0G Private Computer**, qualifying for the ETHGlobal Mumbai bonus track.

---

## 1. Network & Smart Contract Specifications

### A. Network Architecture
- **Network Name:** 0G Mainnet (Aristotle)
- **Chain ID:** `16661` (`0x4115`)
- **Official EVM RPC:** `https://evmrpc.0g.ai`
- **Block Explorer:** [https://chainscan.0g.ai](https://chainscan.0g.ai) / [https://comfyscan.io](https://comfyscan.io)
- **Currency Symbol:** `0G` (18 decimals)

### B. Official Smart Contracts
| Contract Role | Address | Interface & Methods |
| :--- | :--- | :--- |
| **iAI Token (ERC-20)** | `0xc77FBd3824cc68e612b26114D176879aDdc29463` | `balanceOf(address)`, `symbol() = "iAI"`, `decimals() = 18` |
| **iAI Staking & Collateral Vault** | `0x94a5d41dfae4f2ee7c61a80f33a5085c8c252c70` | `positionOf(address) returns (uint256 collateral, uint256 debt, uint256 epoch)` |

---

## 2. iAI Staking Eligibility & Allowance Formulation

### A. Distinguishing Held Tokens from Staked Position
- **Held in Wallet (`heldInWallet`):** Computed by calling `balanceOf(account)` on the iAI ERC-20 contract (`0xc77FBd3824cc68e612b26114D176879aDdc29463`).
- **Actually Staked (`actuallyStaked`):** Computed by calling `positionOf(account)` on the vault contract (`0x94a5d41dfae4f2ee7c61a80f33a5085c8c252c70`). The second return parameter (`debt`) records the minted/staked iAI position backed by locked `a0G` collateral.
- **Eligibility Criterion:** **Token ownership alone does NOT grant compute credits.** Only verified staked iAI (`eligibleStakedAmount > 0`) is eligible for daily compute allowances.

### B. Allowance Formula
$$\text{Indicative Daily Credits} = \text{Eligible Staked iAI} \times 1.271$$
- **Official Parameter Rate:** $1.271$ compute credits per eligible staked iAI per day.
- **Refresh Schedule:** Refreshed daily at **00:00 UTC**. Unused daily credits expire according to protocol parameters.

---

## 3. Cryptographic Wallet Authentication (SIWE)

Users authenticate ownership of their 0G wallet without gas transactions or exposing private keys:

1. **Nonce Generation:** Client requests a fresh cryptographic nonce from `/api/auth/nonce?address=0x...`.
2. **Challenge Message:** The frontend constructs an EIP-4361 challenge:
   ```text
   AUTONEX AI Virtual Office Authentication
   Sign in to verify 0G Private Computer & iAI Holder Staking eligibility.

   Wallet: 0x...
   Nonce: auth_...
   Issued At: 2026-11-06T...
   Chain ID: 16661 (0G Mainnet)

   Notice: This action will not cost gas or perform an on-chain transaction.
   ```
3. **Signing:** User signs via `personal_sign` in their browser wallet (MetaMask, Rabby, Coinbase).
4. **Verification:** Backend verifies the signature with `verifyMessage` from `viem`, establishes an authenticated session, and associates the user's 0G Private Computer credentials with that wallet address.

---

## 4. 0G Private Computer Router & Credit Consumption

### A. Endpoint Specifications
- **Router Endpoint:** `https://router-api.0g.ai/v1`
- **Inference Route:** `POST https://router-api.0g.ai/v1/chat/completions`
- **Supported Catalog:** 125+ models, including:
  - `glm-5.3-flash` (Lead Manager & Planner)
  - `qwen3-coder-flash` (Code Synthesis Engineer)
  - `kimi-k2.7-code` (QA Verifier & Critique)
  - `deepseek-v4.1-flash` (Swarm Consensus & Logic)

### B. Real 0G Consumption & Billing Telemetry (`x_0g_trace`)
Every live inference request executed against 0G Private Computer returns execution metadata:
```json
{
  "choices": [...],
  "id": "as-18nkxifpad",
  "model": "glm-5.3-flash",
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 10,
    "total_tokens": 28
  },
  "x_0g_trace": {
    "billing": {
      "currency": "usd",
      "input_cost": "2",
      "output_cost": "3",
      "total_cost": "5",
      "total_cost_usd_micro": "5"
    },
    "provider": "0x000000003f486c7198d6203568a98d02b91f8044",
    "provider_identity": "baidu",
    "request_id": "69fbd20c-368e-4d4f-b0f9-4da855bdaef7"
  }
}
```
The AUTONEX Bridge captures `x_0g_trace` to record real-time credit consumption, micro-USD billing, and request IDs without simulations or mock balances.

### C. 0G Account Balance Limitation Documentation
- **Observation:** `GET /v1/account` and `GET /v1/account/balance` return HTTP `403 Insufficient permissions (insufficient_scope)` when queried with inference keys (`sk-`).
- **Explanation:** The 0G Private Computer Router architecture restricts account balance introspection to management-tier (`mk-`) keys or authenticated dashboard sessions at [pc.0g.ai](https://pc.0g.ai). Inference keys (`sk-`) are scoped solely to execute and bill inferences directly against the user's unified compute balance.
- **Compliant Handling:** The UI and API explicitly display the required state:
  $$\text{Compute balance unavailable}$$
  with tooltips and documentation clarifying this 0G scope restriction. No fabricated or simulated balances are ever displayed.

---

## 5. UI Integration & 10 Explicit State Badges

The **0G Private Computer & iAI Hub** modal ([`frontend/src/ui/ZGConfigModal.tsx`](file:///d:/AUTONEX/frontend/src/ui/ZGConfigModal.tsx)) implements the 10 explicit states:

| Required State | Badge Condition & Display |
| :--- | :--- |
| `Wallet not connected` | Displayed when user has not yet connected an EVM wallet. |
| `Wallet connected` | Active address displayed with link to 0G ChainScan. |
| `iAI staking not detected` | Account holds 0 staked iAI in the vault contract. |
| `iAI staking verified` | Account holds $>0$ staked iAI; displays daily credit rate ($1.271 \times \text{staked}$). |
| `API key missing` | No 0G API key has been entered into the system. |
| `API key invalid` | Key rejected with HTTP 401 (`invalid_auth`) by 0G Router. |
| `API connection verified` | Key validated against live 0G Router catalog. |
| `Compute balance unavailable` | Accurately displayed due to 0G `sk-` permission scope. |
| `Inference successful` | Displayed upon successful 0G completion with request ID. |
| `Inference failed` | Displayed upon inference error or network timeout. |

---

## 6. End-to-End Verification Test Results

Test suite: [`frontend/src/tests/iai-integration.test.ts`](file:///d:/AUTONEX/frontend/src/tests/iai-integration.test.ts)

```text
✓ src/tests/iai-integration.test.ts (7 tests) 9196ms
  ✓ 1. Wallet Authentication: proves wallet ownership via nonce challenge signature
  ✓ 2. Scenario 1: User without iAI staking has valid API access and executes inference
  ✓ 3. Scenario 2: Eligible staked account earns exactly 1.271 credits/staked iAI daily
  ✓ 4. Scenario 3: Distinguishes held iAI from staked iAI; token holding alone != eligibility
  ✓ 5. Scenario 4: Invalid API key is rejected by 0G Router with 401
  ✓ 6. Scenario 5: Balance query correctly reports "Compute balance unavailable" for sk- key
  ✓ 7. Scenario 6: Real model inference confirms consumption of tokens and records billing trace

Test Files: 1 passed (1)
Tests:      7 passed (7)
Duration:   11.20s
```

