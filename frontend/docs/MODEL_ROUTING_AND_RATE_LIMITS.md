# 0G Model Routing and Rate Limits

AUTONEX uses **0G Private Computer exclusively** for hosted model inference. Every live
LLM call goes through the configured 0G Router endpoint; other model providers and
cross-provider fallbacks are not supported.

## Catalogue and role routing

`bridge/config/models.yaml` is the canonical model catalogue and role mapping. All
model IDs use the `0g/` prefix and the `zg_compute` provider. The frontend mock
catalogue and terminal-agent profile mirror those choices.

| Role | Preferred model | 0G fallback |
|---|---|---|
| `triage` | `0g/glm-5.3-flash` | `0g/qwen-flash` |
| `manager` | `0g/glm-5.3-flash` | `0g/deepseek-v4.1-flash` |
| `manager_escalation` | `0g/deepseek-v4.1-flash` | `0g/glm-5.3-flash` |
| `lead` | `0g/glm-5.3-flash` | `0g/qwen3-coder-flash` |
| `code` | `0g/qwen3-coder-flash` | `0g/deepseek-v4.1-flash` |
| `fast` | `0g/qwen-flash` | `0g/qwen3.7-flash` |
| `research` | `0g/glm-5.3-flash` | `0g/deepseek-v4.1-flash` |
| `qa` | `0g/kimi-k2.7-code` | `0g/deepseek-v4.1-flash` |
| `text` | `0g/glm-5.3-flash` | `0g/qwen-flash` |

Fallbacks are limited to models in the same 0G catalogue. If every configured 0G
model is unavailable or rejects the request, the gateway reports a failure rather
than sending prompts to another provider.

## Gateway behavior

The local gateway centralizes request queueing, rate limiting, retries, circuit
breaking, token accounting, and `llm.call_*` / `gate.state` events. It handles:

- Context-aware model selection using each catalogue entry's context window.
- `429` responses with `Retry-After`, backoff, and rate reduction.
- Transient `5xx` and timeout retries before trying the next configured 0G model.
- Authentication failures as explicit errors; credentials are never included in
  diagnostics.
- A bounded queue and clear failure when the configured wait limit is exceeded.

The configured rate limits are conservative starting values, not verified 0G
service guarantees. Runtime response headers take precedence when available.

## Context and privacy

- Admit a request only when prompt tokens plus requested output fit within 85% of
  the model's configured context window.
- Never truncate prompts silently. If no configured 0G model can fit, fail clearly
  so the caller can reduce or summarize the input.
- Configure only `ZG_API_KEY` and `ZG_BASE_URL`; no other model-provider keys are
  consumed by the application.
- Treat provider retention and privacy terms as subject to change; verify the
  current 0G terms before sending sensitive project data.

## Configuration and checks

- `bridge/config/providers.yaml`: 0G Router URL, key variable, and gateway limits.
- `bridge/config/models.yaml`: supported 0G models and all role/fallback chains.
- `backend/profiles/base.json`: 0G models available to the terminal agent.
- `frontend/src/mock/data.ts`: 0G-only demo catalogue.

Validate changes with the gateway tests and frontend checks. Model IDs should be
added only after verifying them against the 0G Router model catalogue.
