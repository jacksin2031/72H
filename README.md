# 72H

> **From Alert to Action.**  
> **警報から、行動へ。**

72H is a disaster-action AI agent designed for people in Japan who may not be familiar with local disaster information, transport conditions, or emergency procedures.

The project focuses on one question:

> **After receiving an alert, what should I do next?**

72H combines verified disaster information, transport conditions, the user's current situation, and an agentic planning loop to maintain an actionable plan as conditions change.

## Public demo

This public deployment runs vNext P1 with the accepted first-use UI polish
(`h72-ui-910c1d2`, 100% traffic). See the
[current runtime and UI acceptance](docs/VNEXT_FIRST_USE_POLISH.md).
See the [P1 acceptance ledger](docs/VNEXT_P1_VALIDATION.md) and
[production record](docs/VNEXT_P1_PRODUCTION_RELEASE.md) for runtime identity,
rollback and capability limits. Remote Git synchronization is separately blocked.

**https://h72-vux6j7xjka-an.a.run.app/dashboard**

The public judging deployment runs on Google Cloud Run in `asia-northeast1`. Vertex AI / Gemini + Google ADK is enabled through the dedicated runtime service account. The Ekispert MCP credential is supplied from Secret Manager and was verified from Google Cloud with a names-only smoke job; route data is still treated as provider data rather than disaster-safety evidence.

## Core concept

```text
Observe
  ↓
Verify
  ↓
Understand
  ↓
Plan
  ↓
Monitor
  ↓
Detect Change
  ↓
Re-plan
```

72H is not intended to predict disasters or replace official emergency instructions. High-impact recommendations must be traceable to eligible evidence. When the network is unavailable, 72H enters Continuity Mode and falls back to the last verified plan and preloaded emergency information rather than inventing new real-time guidance.

## Hackathon scope

Primary v0.1 scenario:

- Disaster: Earthquake
- User: Foreign visitor in Tokyo
- Current location: Shibuya
- Accommodation: Asakusa
- Original plan: Return to accommodation at 18:00
- Languages: Japanese / English / Traditional Chinese / Simplified Chinese

## Key capabilities

- Verified disaster evidence ingestion
- Situation state management
- `NOW / NEXT / AVOID` action plans
- Plan versioning and expiration
- Situation change detection
- Automatic plan invalidation and re-planning
- Source provenance and freshness tracking
- Unverified information rejection
- Agent activity trace
- Deterministic disaster replay for judging/demo
- Offline Continuity Mode
- Last Verified Plan
- Offline Emergency Pack

## Safety principles

1. **No Source → No High-Risk Action**
2. Route availability does not mean route safety.
3. Unverified information cannot directly drive high-risk actions.
4. Stale information must be visibly downgraded.
5. A changed dependency can invalidate a plan.
6. The system must never present LLM inference as official information.
7. When offline, the system must state what it no longer knows.

## Runtime and integration boundaries

- Next.js / TypeScript
- Python / FastAPI
- Gemini
- Google Agent Development Kit (ADK)
- Google Cloud Run
- In-memory bounded replay sessions (Firestore persistence is future work)
- Public structured trace (Cloud Logging export is future work)
- PWA / Service Worker / IndexedDB for offline continuity

The MVP uses plain CSS to keep the frontend small. The accepted P0 deployment
uses a validated synthetic registry and bounded Ekispert MCP discovery/calls.
Accepted P1 adds separate live JMA intake and station-sequence candidate
normalization, validated locally and on production. Safety Tips and persistent
Firestore sessions remain unsupported. Catalog designation is not current
shelter opening or movement authorization.
Replay input enters the real evidence/state/Safety Core pipeline,
and plan versions are generated from state rather than event-index UI branches.
The server retains immutable evidence and plan publication objects, with separate
freshness/conflict projections and append-only plan evaluations.

## Development source of truth

Use **`main`** as the canonical source of truth. The former `codex/hackathon-mvp`
worktree supplied the integrated MVP baseline and `b25f` is retained only as an
older migration source; neither should be developed as a second application. This
repository uses `apps/web` and `services/agent-api`; no parallel `services/api` /
pnpm backend has been imported. Hackathon skills are retained under `.codex/skills`,
sourced from [Zenn's participant skills](https://github.com/zenn-dev/hackathon-agent-skills).

The earlier P1 release exception and repository-access failure are historical.
The 2026-10-11 branch consolidation uses the existing repository-owner login;
see [branch integration evidence](docs/BRANCH_INTEGRATION_2026_10_11.md).
Git integration does not promote a Cloud Run revision or establish new live,
GPS, nationwide hazard-coverage or movement-safety acceptance.

## Run locally

Requirements: Node 24, Python 3.11, `uv` and npm.

```powershell
uv sync --project services/agent-api --frozen
npm ci --prefix apps/web
```

Start the backend and frontend in separate terminals:

```powershell
uv run --project services/agent-api python -m agent_api
```

```powershell
npm run dev --prefix apps/web
```

Open `http://127.0.0.1:3000/dashboard` for P1 Live profile setup, source checks,
and device-role presentation. Live and cached data are explicitly labelled;
neither catalog locations nor provider routes authorize evacuation. Open
`http://127.0.0.1:3000/demo` for Judge / synthetic Replay. Japanese is the default
language. Start the demo,
pause and use **Next update** to inspect the eleven-event loop. English and
Traditional Chinese are available. The simulation banner and synthetic source
references remain visible; no live disaster or movement-safety claim is made.

For actual offline behavior, use the production build instead of the dev server:

```powershell
npm run build --prefix apps/web
npm start --prefix apps/web
```

Stop the running standalone server before rebuilding on Windows. Load online
first to install the Service Worker and retain a verified snapshot. Offline
continuity stores schema-approved data in IndexedDB and checks freshness locally;
it never creates new official information. Reconnection alone does not clear the
verification gate. Server restart loses its in-memory session, but the client
keeps the snapshot and offers **Start a new demo** when the session is missing.

`PLANNER_MODE=deterministic` is the default local path. Cloud identity/model
configuration belongs to the backend; `.env.example` contains non-secret example
values and is not automatically loaded by Python. Gemini integration validation
and actual invocation status are recorded in `docs/VALIDATION.md`.

The optional ADK 1.39.1 planner selects typed action intents and eligible evidence
IDs. It cannot supply arbitrary user-facing advice, risk levels or dependencies;
the server owns those values and validates the selection before publication.
Semantic feed extraction and a multi-agent source/mobility system remain future
work. Enable the actual Vertex/ADC path in the backend terminal with:

```powershell
$env:PLANNER_MODE='gemini'
$env:GOOGLE_CLOUD_PROJECT='h-japan'
$env:GOOGLE_CLOUD_LOCATION='global'
$env:GEMINI_MODEL='gemini-3.5-flash-lite'
uv run --project services/agent-api python -m agent_api
```

Missing credentials, timeout or rejected output produces an explicitly labeled
deterministic fallback. Default bounds are one attempt per planning cycle,
15 seconds, 512 output tokens, six calls per session, twelve starts per minute,
and one hundred calls per process lifetime. These are application limits, not a
Google Cloud billing cap; reset does not reset the call budget.

## Validate and deploy

```powershell
uv run --project services/agent-api pytest services/agent-api/tests
uv run --project services/agent-api python scripts/check_secrets.py
npm test --prefix apps/web
npm run typecheck --prefix apps/web
npm run build --prefix apps/web
```

Target Google Cloud project: **h-japan**. The deployed Cloud Run image uses
Next.js standalone, FastAPI and the locked Python dependency graph. Public revision
`h72-vnext-8d1836e` serves 100% of traffic from image digest
`sha256:9d7e22b877aff64502903cfe90b233c8365a8df065e8e3b75fee5bcda6eb3005`.
The runtime image was built from source commit `8d1836e`; subsequent release
documentation does not change that runtime identity. Current acceptance evidence
is in [VNEXT_PRODUCTION_RELEASE.md](docs/VNEXT_PRODUCTION_RELEASE.md).
Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md)
for repeatable deployment. No credential file or browser API key is needed.

The local implementation and tests were created during the hackathon work;
pre-existing repository material was product/architecture documentation. Review
the event's eligibility and existing-project policy with that distinction.

## Documentation

- [Adaptive UI specification and implementation boundary](docs/VNEXT_ADAPTIVE_UI_UPDATE_SPEC.md)
- [Adaptive UI local validation](docs/VNEXT_ADAPTIVE_UI_VALIDATION.md)

These adaptive documents retain the 2026-10-05 milestone and its local evidence.
The current implementation carries its presentation, theme and notification
behavior forward through later P1/P2 work. Consumer movement maps require all
current Safety Core, destination, route and geometry gates. The standalone
reference map and official Ishinomaki data are not movement authorization.
See [P2.4 validation and coverage limits](docs/VNEXT_P2_4_VALIDATION.md).

- [vNext product plan](docs/VNEXT_PRODUCT_PLAN.md)
- [Authorized P0 module contracts](docs/VNEXT_P0_CONTRACTS.md)
- [vNext local validation](docs/VNEXT_VALIDATION.md)
- [vNext P0 Release Candidate 1](docs/VNEXT_RELEASE_CANDIDATE.md)
- [vNext production release evidence](docs/VNEXT_PRODUCTION_RELEASE.md)
- [Configurable area/map and Last Known Location contract](docs/VNEXT_AREA_LOCATION.md)

The merged vNext release adds MapLibre with a 2.39 MB bounded central-Tokyo
OpenStreetMap road pack, Home / Plan / More, deterministic severity/authority,
in-app transition notifications, consent-based local safety checks and power
degradation. The map is a licensed geographic reference, not verified route or
hazard information. Browser battery/location support is optional and foreground
only. No rescue dispatch or guaranteed background alarm is claimed.

The area/location follow-up moves map viewport and profile-reference pins into
scenario/pack configuration. Tokyo and Osaka replay profiles use the same typed
area hierarchy, source authorization and Safety Core; uncovered map regions stay
unsupported. Explicit consent retains only one local Last Known Location with
its original capture time. Restored/offline points are labeled last known and
never grant official area authority. These changes are merged into `main`.

Map worker modules are prepared by npm postinstall/build. Refresh the data pack
only explicitly with `uv run --project services/agent-api python scripts/build_offline_map.py`;
this installed base-map pack does not query Overpass at runtime. The separately
implemented [nationwide road-reference tiles](docs/VNEXT_EVACUATION_ROADS_SOURCE.md#全國道路參考區塊)
use fixed backend Overpass queries on demand; their local acceptance does not
change the deployed runtime. Attribution and database license
are in `apps/web/public/maps/LICENSE.md`. The public service now runs the vNext
image; local evidence remains in `docs/VNEXT_VALIDATION.md`, and deployed
acceptance is recorded separately in `docs/VNEXT_PRODUCTION_RELEASE.md`.

- [Product Specification](docs/PRODUCT_SPEC.md)
- [Replay Scenario](docs/REPLAY_SCENARIO.md)
- [Agent & Safety Contract](docs/AGENT_SAFETY_CONTRACT.md)
- [Offline Continuity Specification](docs/OFFLINE_CONTINUITY.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Validation evidence and remaining blockers](docs/VALIDATION.md)
- [Cloud Run deployment runbook](docs/DEPLOYMENT.md)
- [Ekispert MCP adapter boundary](docs/EKISPERT_MCP.md)
- [Worktree consolidation](docs/WORKTREE_CONSOLIDATION.md)
- [Three-minute demo script and Japanese summary](docs/DEMO_SCRIPT.md)
- [Hackathon submission package](docs/SUBMISSION_PACKAGE.md)
- [MVP architecture image](docs/architecture-mvp.svg)
- [Hackathon compliance checklist](docs/HACKATHON_COMPLIANCE.md)

## Status

**DEPLOYED vNext P1 — production acceptance PASS; remote Git sync and external submission pending.**

P1 passes 103 backend / 148 frontend tests, local and deployed browser acceptance,
actual JMA/Ekispert and Gemini/ADK, plus browser offline/reconnect verification.
Evidence and limits are recorded in [VNEXT_P1_VALIDATION.md](docs/VNEXT_P1_VALIDATION.md).

The results below are historical evidence for the accepted P0 rollback baseline.

Local 69 backend / 77 frontend tests, deterministic safety, PWA continuity, CI,
Cloud Build and public Cloud Run have passed. Both preview and canonical-origin
replays completed with four plan versions, twelve actions and four real
Gemini / ADK candidates without fallback. Clean canonical desktop/mobile browser,
mocked Last Known Location, cached nonempty plan and same-session physical
offline/reconciliation acceptance passed. The Ekispert MCP smoke is historical
baseline evidence; a fresh vNext provider-connectivity test is not claimed. A
project-scoped ¥5,000 monthly billing budget sends alerts at 50% / 80% / 100%.

Remaining submission work is primarily external assets/process: final architecture
upload, approximately three-minute YouTube demo, Hackathon form/GitHub integration,
and final submission verification. Safety Tips ingestion and Firestore persistence
remain unsupported. Live JMA intake, static designation and schematic candidate
points are supported in P1; current shelter/hazard/road safety is not established.
Web Push/FCM, Rescue Beacon, native background service
and real-device GPS/battery endurance also remain future work. Submission freeze
is deferred until the external assets and final dashboard submission are ready.
