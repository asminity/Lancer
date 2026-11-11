# AUTONEX - Project Description

## Overview

AUTONEX is a collection of cooperating prototypes for AI-assisted software
engineering. It combines an observable 3D workspace, a TypeScript live-run
bridge, a Python multi-agent swarm service and gateway core, decentralized
checkpoint/storage integrations, and an independent terminal coding runner
called PAG.

The repository does not currently have one unified runtime that connects every
component end to end. The browser simulator, TypeScript live bridge, Python
service, PAG runner, and optional web3 storage features have separate entry
points and integration boundaries.

## Goals

- Make simulated or live agent activity easier to inspect through a 3D office,
  task views, agent details, event logs, and reports.
- Experiment with multi-agent engineering workflows, including swarm
  deliberation, proposal clustering, critique, voting, and verification.
- Provide resilient model-routing primitives and configurable 0G model
  catalogues.
- Explore operator controls, permissions, privacy/egress handling, and
  checkpoint persistence.
- Provide PAG as a separate terminal-based coding assistant with configurable
  safety profiles and an optional container sandbox.

## System overview

```text
                              AUTONEX repository
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Frontend (React / Three.js / Zustand)                              │
 │  Default: local simulator      Live mode: TypeScript Bridge         │
 └───────────────────┬──────────────────────────┬─────────────────────┘
                     │ REST + WebSocket          │ optional storage
                     ▼                           ▼
 ┌───────────────────────────────┐       ┌─────────────────────────────┐
 │ TypeScript live bridge        │       │ Arkiv / Ethereum Swarm       │
 │ Office and Swarm run paths    │       │ checkpoint/report workflows │
 └───────────────┬───────────────┘       └─────────────────────────────┘
                 │ configured 0G inference
                 ▼
        0G Private Computer Router

 ┌───────────────────────────────┐       ┌─────────────────────────────┐
 │ Python FastAPI service        │       │ PAG terminal runner          │
 │ Swarm API + Python engine     │       │ OpenCode profiles/plugins    │
 │ Gateway core primitives       │       │ Native or optional Docker    │
 └───────────────────────────────┘       └─────────────────────────────┘
```

The Python FastAPI service is separate from the TypeScript server. The
`bridge/autonex_bridge/gateway/` package implements gateway primitives; the
current FastAPI app does not expose that package as an OpenAI-compatible proxy.
PAG is also a separate application and is not automatically launched by a
frontend task.

## Components

### 1. Frontend and 3D workspace

The Vite application is under `frontend/`. It uses React, TypeScript,
Three.js/React Three Fiber, Zustand, and Vitest.

The UI includes:

- Office and Swarm modes, with landing/configuration screens.
- Procedural 3D agents, office and conference layouts, navigation, and
  interaction panels.
- Task/event views such as the DAG, blackboard, inspector, event log,
  permissions panel, compute drawer, and report view.
- Checkpoint, wallet, Arkiv, and Swarm storage interfaces.
- A local event-driven simulator used by default when `VITE_USE_MOCK` is not
  set to `false`.

The simulator is useful for exploring the UI without a running model service.
Its generated activity is simulated and must not be presented as evidence that
a live agent performed those actions.

### 2. TypeScript live bridge

`frontend/tools/mock-bridge/` contains the Node/TypeScript HTTP and WebSocket
server used by the frontend's live mode. It handles frontend run requests,
emits sequenced events, and contains Office and Swarm execution paths. The
Office runner includes manager/worker roles, model calls, file/context
handling, and permission requests; the Swarm runner emits deliberation and
synthesis activity.

The scripts `bridge` and `bridge:mock` in `frontend/package.json` start the
same server. The latter name is historical. In ordinary execution the server
uses the real-run paths; its test behavior is driven by the test environment.
Live model calls require valid 0G configuration. UI fallback behavior and
server-side run completion should be evaluated separately.

### 3. Python swarm service and gateway core

`bridge/autonex_bridge/` contains a FastAPI application and Python swarm
implementation. The swarm package is organized around:

- Run control, planning, agent roles, message bus, and blackboard.
- Persona/seat allocation, phase execution, clustering, assignment, and
  capacity/admission scheduling.
- Privacy classification, redaction, pseudonymization, trust checks, and
  egress audit records.
- Watchdogs and supervision, verification/scoring, and SQLite-backed
  repository state.
- REST routes for estimates, runs, steering, events, provider status, and
  checkpoint operations, plus a WebSocket event endpoint.

The gateway package provides model validation/routing, context-aware fallback
selection, token estimation, queued/concurrent lanes, rate-limit handling,
retry behavior, and circuit breakers. Current provider configuration is in
`bridge/config/`. The presence of these components does not imply they are all
wired into the TypeScript live bridge or into a single production execution
pipeline.

### 4. PAG terminal runner

`backend/` contains the separate PAG coding runtime, based on OpenCode. It has
Windows PowerShell launchers, JSON model/security profiles, plugins for audit,
context handling, limits, search, headers, and AUTONEX integration, plus
evaluation tasks and Docker configuration.

On Windows, `backend/bin/pag.ps1` launches Native mode by default.
`--docker` selects the optional WSL/Docker path. The default profile and model
catalogue are defined in `backend/profiles/`; the bridge package's YAML model
catalogue is a separate configuration.

### 5. Checkpoint and decentralized storage services

Frontend service modules implement checkpoint packaging/restoration, wallet
connection/auth flows, Arkiv entity operations, and Ethereum Swarm uploads and
downloads. These features require the relevant wallet, network, endpoint, and
optional local workspace configuration. They are not required to run the
simulator.

The Python API includes placeholder wallet-authentication and iAI
status/usage responses. Do not treat those endpoints as production
authentication, staking verification, or billing.

## Typical workflows

### UI simulation

1. Install frontend dependencies.
2. Run the Vite app.
3. Use Office or Swarm mode; the local simulator emits the events consumed by
   the UI.

### TypeScript live run

1. Start `frontend/tools/mock-bridge/server.ts`.
2. Set `VITE_USE_MOCK=false` and `VITE_API_URL` for the frontend.
3. Provide a `ZG_API_KEY` to the bridge process.
4. Submit a task and inspect events/permissions/reports in the UI.

This path is distinct from the Python FastAPI service.

### Python swarm API

Install `bridge/` with its development dependencies, run
`autonex_bridge.main:app` with Uvicorn, and use the `/api/swarm/...` endpoints
and `/ws/events`. Configuration is supplied by the YAML files in `bridge/config`.

### PAG

Run `backend/bin/pag.ps1 <project-path> <profile>` on Windows. The optional
Docker mode requires WSL2, Docker, and the supporting tools described in
`backend/README.md`.

## Development and verification

From the repository root:

```powershell
npm run install:frontend
npm run check
npm run build
```

For Python:

```powershell
cd bridge
python -m pip install -e ".[dev]"
python -m pytest -q
```

These commands cover the frontend type-check/test/build and Python service
tests, respectively. PAG has its own context-plugin test and evaluation
harness; those do not run as part of the root npm scripts.

## Configuration and privacy

- Keep API keys out of source control and use local environment files or
  process environment variables.
- Live inference transmits prompts and any included context to the configured
  hosted model service. Review its terms before using proprietary data.
- Browser wallet signing should remain in the user's wallet; do not enter or
  store private keys in the application.
- Treat simulated events as simulation, and review the current implementation
  before relying on any permission, identity, privacy, or persistence feature
  as a security boundary.

## Repository map

```text
frontend/src/                    UI, simulation, state, navigation, services
frontend/tools/mock-bridge/      TypeScript REST/WebSocket bridge
frontend/docs/                   Frontend, API, integration, and target specs
bridge/autonex_bridge/gateway/    Python gateway primitives
bridge/autonex_bridge/swarm/      Python swarm engine and API
bridge/config/                    Python service model/provider configuration
backend/                          PAG terminal runner and sandbox
scripts/                          Root development launch helpers
```

For setup commands, see [`README.md`](README.md). For implementation-specific
information, see [`frontend/README.md`](frontend/README.md),
[`bridge/README.md`](bridge/README.md), and
[`backend/README.md`](backend/README.md).
