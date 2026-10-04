# 72H Agent API

Phase 3 retains the deterministic Safety Core and state-driven NOW / NEXT / AVOID
plans, and adds optional bounded Gemini/ADK intent selection plus an Ekispert MCP
provider boundary. Replay output is synthetic, never live official information.

## Run locally

Run these commands from services/agent-api:

    uv sync --python 3.11 --frozen --all-groups
    uv run python -m agent_api

The API listens on http://127.0.0.1:8000. Health and version endpoints are GET /health and GET /version.

## Replay controls

POST /api/replay/start accepts no body or a JSON body with language set to ja, en, or zh-TW. It creates an isolated session and returns the complete snapshot; read its opaque replay.id for subsequent controls.

POST /api/replay/{id}/pause changes the status to PAUSED; the caller stops scheduling next-event requests. POST /api/replay/{id}/resume changes READY or PAUSED to RUNNING; the caller schedules the next request using the returned delay. POST /api/replay/{id}/next emits exactly one next scenario event while running or paused. POST /api/replay/{id}/reset clears replay state while preserving the session, profile, situation, scenario event IDs, and fixture timestamps. POST /api/replay/{id}/speed accepts a JSON body with speed set to 1, 2, or 4.

The snapshot contains profile, situation and claim states, normalized disaster events, immutable evidence and freshness projections, immutable plan versions and actions, structured trace, replay, scenario_events, mobility, and plan_evaluations. Collections are arrays. Evidence age and TTL use published_at and virtual replay time; a late-arriving item is stale on arrival, and reads do not advance time. replay.next_event_delay_seconds gives the next deterministic delay at the selected speed. network_restored enters RECONNECTING; current official and transport evidence must both be validated after reconnect before reconciliation completes.

Plans are generated from verified claims and dependency changes, never from replay event IDs or timeline positions. Original plan and evidence records remain immutable; plan_evaluations records KEEP, PARTIAL_INVALIDATION, INVALIDATED, or EXPIRED projections. The current MVP blocks every HIGH-risk action and never treats synthetic replay data as authorization for real-world movement or safety claims.

`PLANNER_MODE=deterministic` is the default. `PLANNER_MODE=gemini` enables ADK
1.39.1 with Vertex/ADC (`h-japan`, `global`, `gemini-3.5-flash-lite`). Model output
selects catalog intents/evidence IDs only; deterministic code owns publication.
Failures produce `GEMINI_ADK_FALLBACK` with sanitized reason codes. Missing ADC
was exercised locally; successful live Gemini and Cloud Run are unverified.

`agent_api.mobility.EkispertMcpProvider` uses MCP 1.30.0 and backend-only
`EKISPERT_API_ACCESS_KEY`. Its raw results are not trusted claims and do not alter
replay or route-safety state. See the root README and `docs/EKISPERT_MCP.md` for
configuration, smoke checks and remaining live acceptance.

## Run tests

Run from services/agent-api:

    uv run --frozen pytest
