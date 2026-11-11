# AUTONEX Frontend

The frontend is a Vite/React application that presents Office and Swarm
workflows in a 3D workspace. It uses Three.js through React Three Fiber,
Zustand for application state, and an event-driven simulation/live-run engine.

## Run locally

From the repository root:

```powershell
npm run install:frontend
npm run dev
```

Open `http://localhost:5173`. The built-in simulator is the default and does
not require a bridge or API key.

## Use the TypeScript live bridge

Start the bridge from a second terminal:

```powershell
cd frontend
npm run bridge
```

Set these Vite variables in `frontend/.env.local` and restart Vite:

```dotenv
VITE_USE_MOCK=false
VITE_API_URL=http://localhost:8000
```

The bridge process also needs `ZG_API_KEY` in its environment or in
`frontend/.env`. The `bridge:mock` script is a legacy alias for `bridge`; the
same TypeScript server is used. It runs its live Office/Swarm paths outside the
test environment. The Python FastAPI service under `bridge/` is separate and
is not this frontend bridge.

## Checks and helper scripts

```powershell
npm run check
npm run build
npm test
npm run tape:record
npm run layout:export
```

`check` runs TypeScript type-checking and Vitest. `build` type-checks and
produces the Vite production bundle. The tape recorder writes under `tapes/`;
the layout exporter updates `docs/layout-slots.json`.
Some Vitest integration tests contact hosted services and may require network
access or valid provider configuration.

## Source map

| Path | Purpose |
|---|---|
| `src/three/`, `src/swarm/` | 3D Office and Swarm Hall |
| `src/ui/` | Workspace panels, permissions, reports, settings, and dialogs |
| `src/state/`, `src/api/` | Event/state handling and API/event-stream clients |
| `src/mock/`, `src/sim/` | Default local simulation and simulation helpers |
| `src/nav/` | Office navigation and layout validation |
| `src/services/` | Checkpoints, wallet, Arkiv, Swarm, and project bundle workflows |
| `src/tests/` | Vitest integration, contract, layout, storage, and simulation tests |
| `tools/mock-bridge/` | TypeScript HTTP/WebSocket server and execution runners |

## Documentation

| Document | Scope |
|---|---|
| `docs/ARCHITECTURE.md` | Current component boundaries and execution modes |
| `docs/api-contract.md` | Frontend event and API contract reference; not every proposed event is emitted by every backend |
| `docs/BRIDGE_SPEC.md` | Target design, not a guarantee of current bridge behavior |
| `docs/ACCEPTANCE_TESTS.md` | Acceptance scenarios and their coverage |
| `docs/ARKIV_SWARM_ARCHITECTURE.md` | Optional checkpoint and storage integration |
| `docs/00_START_HERE.md` | Current integration orientation |

The default simulator is not a live model run. Do not interpret its events,
generated files, or safety prompts as proof of live backend behavior.
