# Ekispert MCP adapter boundary

Canonical backend: `services/agent-api` / `agent_api.mobility`.
This adapter is ported from the b25f workspace, adapted to the locked MCP 1.x
client used alongside ADK. It does not add a second backend or replay engine.

## Configuration and scope

- Official endpoint: `https://api-mcp.ekispert.jp/mcp`.
- Backend environment variable: `EKISPERT_API_ACCESS_KEY`.
- Provider authentication header: `ekispert-api-access-key`.
- Local optional helper: `scripts/set-ekispert-key.ps1`. It prompts securely and
  stores the key in the current Windows user's environment; it is never run
  automatically. This is not production secret storage.
- Production: supply the variable through Secret Manager to the runtime identity,
  with access restricted to the required secret. Never use `NEXT_PUBLIC_*`, a
  browser field, a fixture, Git, IndexedDB or an SW cache to hold this key.

`EkispertMcpProvider` exposes tool discovery and tool invocation. Results remain
external mobility data. This adapter currently does **not** promote them into
trusted evidence, mutate the situation, authorize movement or replace synthetic
replay. The normalization/eligible-evidence integration is a later product gate.
Route availability cannot establish disaster safety. MCP text is data, never an
instruction to the planner or Safety Core.

## Connectivity check

With an already configured backend key, run:

```powershell
uv run --project services/agent-api python scripts/smoke-ekispert-mcp.py
```

The check lists tool names only and does not call a route tool or print the key
or result payloads. Missing configuration and provider failures are reported as
sanitized statuses. Do not substitute mock test success for live connectivity.

## Test gate

```powershell
uv run --project services/agent-api pytest services/agent-api/tests/test_ekispert_mcp.py
uv run --project services/agent-api pytest services/agent-api/tests
```

The adapter suite uses controlled transport/server responses. It covers missing
configuration before network access, fixed endpoint/auth boundary, input/result
validation, transport cleanup, timeout and sanitized failure behavior. The full
suite preserves Gemini planner, source scope, replay and Safety Core tests.

Live key acceptance, provider response compatibility and Secret Manager deployment
remain independently verifiable items, recorded in `VALIDATION.md`.
