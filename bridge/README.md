# Python Bridge and Swarm Service

`bridge/` contains the Python FastAPI service, the swarm engine components,
configuration templates, and reusable provider-gateway primitives. It is
separate from the Node/TypeScript frontend bridge in
`frontend/tools/mock-bridge/`.

## Main components

- `autonex_bridge/main.py` — FastAPI application, health/model/configuration,
  inference/demo routes, and swarm router mounting.
- `autonex_bridge/swarm/api.py` — swarm run, steering, status, event, and
  checkpoint API routes plus `/ws/events`.
- `autonex_bridge/swarm/` — controller, planning, personas, rounds, scheduler,
  privacy/egress, supervisor/watchdogs, verification, and SQLite repository.
- `autonex_bridge/gateway/` — model routing and resilience primitives,
  including context-aware selection, token estimation, queues/lanes,
  rate-limit handling, retry/fallback behavior, and circuit breakers.
- `config/` — provider, model, persona, department, swarm, and triage YAML.

The Gateway package is a core library; this FastAPI app does not expose it as
an OpenAI-compatible proxy or automatically wire all of its functionality
into the separate TypeScript live bridge. The Python service and frontend
bridge have overlapping route names but different implementations and run
state. Do not assume one can replace the other without adapting the client.

## Install and run

Python 3.11 or newer is required.

```powershell
cd bridge
python -m pip install -e ".[dev]"
python -m uvicorn autonex_bridge.main:app --host 127.0.0.1 --port 8001
```

The service reads the 0G key from `ZG_API_KEY` when applicable. Run with a
local development key in your process environment; do not commit it.

## Tests

```powershell
cd bridge
python -m pytest -q
```

Tests cover the gateway core and swarm controller, planning/rounds,
admission/scheduling, verification, supervision, and privacy/egress behavior.
Use the test output from the current checkout for the exact test count.

## Configuration and limitations

- `config/models.yaml` and `config/providers.yaml` define the Python service's
  catalogue and capacity/rate assumptions. Treat provider limits as local
  estimates, not service guarantees.
- `config/personas.yaml`, `config/departments.yaml`, `config/swarm.yaml`, and
  `config/triage.yaml` configure swarm behavior.
- The Python app includes demo wallet-authentication and iAI
  status/usage responses. These are not production authentication,
  on-chain-staking verification, or billing implementations.
- Check [`../frontend/docs/ARCHITECTURE.md`](../frontend/docs/ARCHITECTURE.md)
  before using older design documents as implementation status. The
  frontend-facing live server is documented in
  [`../frontend/README.md`](../frontend/README.md).
