# AUTONEX Integration Notes

This is a current orientation guide for the repository. AUTONEX has several
separate components; the term "Bridge" is used for more than one of them.

## Which runtime should I use?

| What you want to run | Component | Entry point |
|---|---|---|
| Explore the 3D workspace without credentials | Frontend simulator | `npm run dev` from the repository root |
| Submit Office/Swarm work through the frontend's live event API | TypeScript bridge | `npm run bridge` from `frontend/`, with `VITE_USE_MOCK=false` |
| Run Python swarm endpoints and Python orchestration components | Python service | `uvicorn autonex_bridge.main:app` from `bridge/` |
| Run an independent terminal coding agent | PAG | `backend/bin/pag.ps1` on Windows |

The TypeScript bridge is under `frontend/tools/mock-bridge/`; the `bridge` and
`bridge:mock` npm scripts start the same server. The Python FastAPI service is
under `bridge/autonex_bridge/` and is not a drop-in replacement for the
frontend bridge. PAG is separate from both.

## Frontend setup

From the repository root:

```powershell
npm run install:frontend
npm run dev
```

By default, the frontend runs its built-in simulator. To try the TypeScript
live bridge, start it in another terminal and set the following in
`frontend/.env.local`:

```dotenv
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:8000
```

Set `ZG_API_KEY` in the bridge process environment or in `frontend/.env` for
live model inference. A local simulator run does not demonstrate a live model
call or file edit.

## Python and PAG setup

Python service:

```powershell
cd bridge
python -m pip install -e ".[dev]"
python -m uvicorn autonex_bridge.main:app --host 127.0.0.1 --port 8001
```

PAG on Windows:

```powershell
.\backend\bin\pag.ps1 D:\path\to\project assist
```

PAG uses Native mode by default. Its `--docker` mode requires WSL and Docker.
See [`../../backend/README.md`](../../backend/README.md) for details.

## Current documentation map

- [`../README.md`](../README.md) — frontend commands and source layout.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — runtime boundaries and current
  component responsibilities.
- [`api-contract.md`](api-contract.md) — event/API contract reference.
- [`BRIDGE_SPEC.md`](BRIDGE_SPEC.md) — target design for a broader integration;
  not a description of every currently implemented behavior.
- [`../../bridge/README.md`](../../bridge/README.md) — Python service and
  gateway implementation notes.
- [`../../backend/README.md`](../../backend/README.md) — PAG setup.

## Configuration and safety

Keep local API keys out of version control. Hosted inference sends the prompt
and any included context to the configured provider. Review the provider's
terms before using proprietary data.

The Python service has demo wallet-authentication and iAI
status/usage responses. They are not production authentication, staking
verification, or billing services. Review source and tests before relying on
any component as a security boundary.
