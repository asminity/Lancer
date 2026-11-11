# PAG Terminal Runner

PAG is the terminal coding-agent component under `backend/`. It wraps
OpenCode with AUTONEX model profiles, plugins, audit/context helpers, and an
optional Docker sandbox. It runs independently of the 3D frontend and the
Python swarm service.

## Windows launch

Native mode is the default and does not require Docker:

```powershell
.\backend\bin\pag.ps1 D:\path\to\project assist
```

Available profiles are `strict`, `assist`, and `turbo`. To see supported
models or options:

```powershell
.\backend\bin\pag.ps1 --list-models
.\backend\bin\pag.ps1 --help
```

Use `--model 0g/qwen3-coder-flash` to override the selected model for a
session. The model catalogue and role defaults are maintained in
`profiles/base.json`.

## Configuration

Set `ZG_API_KEY` in the process environment or in `backend/.env` before
launching PAG. The checked-in `backend/.env.example` is currently empty, so
create the local file yourself and never commit credentials.

The launcher generates runtime configuration from `profiles/` and the local
environment. `hosted-allowed.txt` records project paths used by the launcher;
review its behavior and the provider's data terms before sending private source
code to a hosted model.

## Optional Docker sandbox

Pass `--docker` to use the Docker path:

```powershell
.\backend\bin\pag.ps1 D:\path\to\project strict --docker
```

This path invokes WSL and Docker Compose. Its preflight script is
`scripts/preflight.sh` and is intended for WSL/Linux; it checks Docker,
supporting utilities, environment setup, and the sample scratch repository.
Native mode does not require that Docker preflight.

The Compose setup includes an OpenCode agent container, an nginx 0G proxy,
Squid egress filtering, and SearXNG. Review the Compose and proxy configuration
before relying on isolation or allowlist behavior for a particular host.

## Profiles, plugins, and evaluations

- `profiles/base.json` — model catalogue, defaults, and common permission
  policies.
- `profiles/strict.rules.json`, `profiles/assist.rules.json`, and
  `profiles/turbo.rules.json` — profile-specific policy.
- `plugins/` — context management, audit, limits, search, headers, and AUTONEX
  hooks.
- `evals/` — task fixtures, run scripts, and evaluation collection helpers.

Run the context plugin's unit tests from the backend directory with a `tsx`
installation available:

```powershell
npx tsx --test plugins/context/lib.test.ts
```

The Python swarm engine and the frontend bridge have their own launch and test
instructions; see [`../bridge/README.md`](../bridge/README.md) and
[`../frontend/README.md`](../frontend/README.md).
