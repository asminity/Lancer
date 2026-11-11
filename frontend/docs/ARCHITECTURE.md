# AUTONEX Architecture

This document describes the current repository boundaries. AUTONEX has
multiple runtimes; the frontend, TypeScript bridge, Python service, and PAG
terminal runner are not one server.

## Component map

```text
Browser
  React + Three.js + Zustand
    ├── default: built-in event simulator
    ├── live: frontend/tools/mock-bridge (Node/TypeScript, port 8000)
    │            └── 0G Private Computer inference (ZG_API_KEY)
    └── optional: Arkiv / Ethereum Swarm checkpoint services

Python service (bridge/autonex_bridge, separate process)
  FastAPI swarm API + Python swarm components + gateway primitives

PAG terminal runner (backend/, separate process)
  OpenCode profiles/plugins; Native Windows mode or optional WSL/Docker mode
```

## Frontend execution modes

The frontend selects its engine using `VITE_USE_MOCK`.

| Mode | Behavior | Requirements |
|---|---|---|
| Simulator (default) | Runs a local scripted Office or Swarm event sequence; no server or hosted model calls | Node/npm to develop |
| TypeScript live bridge | Sends task requests to the Node server and receives sequenced events over WebSocket | Bridge running at `VITE_API_URL`; `ZG_API_KEY` for live inference |

The live bridge source is under `frontend/tools/mock-bridge/`. Its npm scripts
`bridge` and `bridge:mock` are aliases. The simulator remains a deliberate UI
development path and should not be confused with real execution.

## TypeScript bridge

The Node server exposes the frontend-facing REST and `/ws/events` interfaces,
manages run/event state, and dispatches Office or Swarm execution paths. The
Office runner includes LLM calls, worker events, file/context handling, and
permission requests. The Swarm runner produces proposal, critique, vote, and
synthesis activity. The bridge's live behavior should be checked against its
source and tests rather than assuming every event in `api-contract.md` is
emitted by every path.

Vite's development proxy forwards `/api` and `/ws` to `localhost:8000`.
`VITE_API_URL` may be set explicitly when using a different host.

## Python service

`bridge/autonex_bridge/main.py` starts the FastAPI application and mounts the
router in `swarm/api.py`. The Python service includes:

- Swarm run creation, estimates, steering, phase/board/idea queries, and
  checkpoint routes.
- WebSocket event delivery and a SQLite-backed repository.
- Round planning, personas/seats, clustering, voting, admission, scheduling,
  supervision/watchdogs, and verification components.
- Privacy/egress classification, redaction, pseudonymization, and audit
  components.
- Gateway primitives in `gateway/` for 0G model validation/routing,
  context-aware fallbacks, token estimation, rate/concurrency control,
  retries, and circuit breaking.

This FastAPI process is separate from the TypeScript server used by the
frontend. The Python Gateway package is not currently exposed as an
OpenAI-compatible proxy by the FastAPI app. The Python app also contains demo
wallet-authentication and iAI status/usage responses; do not rely on these as
production identity or billing services.

## PAG terminal runner

`backend/` contains PAG, an independent OpenCode-based terminal runner. It
provides Native mode on Windows, an optional `--docker` path through WSL, JSON
profiles, plugins, scripts, and evaluation fixtures. The frontend does not
start PAG automatically.

## Optional storage path

Frontend service modules implement wallet connection/signing, Arkiv entity
operations, and Ethereum Swarm upload/download workflows for checkpoint and
report features. These services require their respective network, wallet,
credentials, and workspace configuration. They are not prerequisites for
running either the simulator or the TypeScript bridge.

## Local ports and commands

| Process | Default port | Start command |
|---|---:|---|
| Vite frontend | 5173 | `npm run dev` from root |
| TypeScript bridge | 8000 | `npm run bridge` from `frontend/` |
| Python FastAPI | user-selected | `python -m uvicorn autonex_bridge.main:app --port 8001` from `bridge/` |

The Python service's port is independent of the Vite proxy target. When using
it, configure clients explicitly; it is not a drop-in replacement for the
TypeScript frontend bridge.

## Related documentation

- [`../README.md`](../README.md) — repository setup and component overview
- [`api-contract.md`](api-contract.md) — frontend event/API contract reference
- [`BRIDGE_SPEC.md`](BRIDGE_SPEC.md) — target bridge design
- [`00_START_HERE.md`](00_START_HERE.md) — current integration orientation
- [`../../bridge/README.md`](../../bridge/README.md) — Python service specifics
- [`../../backend/README.md`](../../backend/README.md) — PAG specifics
