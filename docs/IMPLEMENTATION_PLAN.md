# 72H Implementation Plan v0.1

## Authorized P1.1 local execution

The 2026-10-08 approved plan adds accessible GPS-first onboarding, nationwide
N03 device-local resolution, a canonical national registry, same-session location
updates and battery-aware map tracking. Precise coordinates remain device-local.
Required gates include deterministic location/geometry/API regression tests,
complete national artifact integrity checks, mobile/desktop browser acceptance,
offline/reconnect and an independent Luna Max safety review. Evidence belongs in
[VNEXT_P1_1_VALIDATION.md](VNEXT_P1_1_VALIDATION.md), tied to the actual local
commit/build. Real-device GPS and production acceptance remain separate gates.

## Authorized vNext P1 execution

The user's 2026-10-06 `/goal complete` request authorizes P1-A through P1-K in
[VNEXT_P1_LIVE_ROUTE_DEVICE_ROLES.md](VNEXT_P1_LIVE_ROUTE_DEVICE_ROLES.md),
including mobile scenes and a separate desktop preparedness role. Reuse the
accepted P0 Safety Core, versioned plans, bounded Gemini/ADK planner and offline
contracts. Source adapters, route normalization and presentation changes must
pass the [P1 acceptance ledger](VNEXT_P1_VALIDATION.md) before release. Preserve
the accepted production rollback revision; Push/Rescue/native background work
remain outside this release.

## Objective

Build a stable, judge-ready MVP of 72H for the Google Cloud Agentic AI Hackathon.

The MVP must prove one complete loop:

```text
Verified event
→ current situation
→ action plan
→ changed evidence
→ automatic invalidation
→ re-plan
→ offline continuity
→ reconnect and re-evaluate
```

The implementation plan intentionally prioritizes deterministic behavior, safety, replayability, and demo stability over breadth.

---

## 1. Technical Baseline

### Frontend

- Next.js
- TypeScript
- Tailwind CSS
- PWA support
- IndexedDB for offline continuity

### Backend

- Python
- FastAPI
- Google Agent Development Kit (ADK)
- Gemini

### Google Cloud

- Cloud Run
- Firestore
- Cloud Logging

### Planned later integrations

- Cloud Storage
- real disaster source connectors
- **駅すぱあと API MCP Server** for the production-facing Mobility Agent

---

## 2. Repository Target Structure

```text
72H/
├── README.md
├── docs/
│   ├── PRODUCT_SPEC.md
│   ├── REPLAY_SCENARIO.md
│   ├── AGENT_SAFETY_CONTRACT.md
│   ├── OFFLINE_CONTINUITY.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   └── IMPLEMENTATION_PLAN.md
├── apps/
│   └── web/
│       ├── app/
│       ├── components/
│       ├── lib/
│       ├── public/
│       └── tests/
├── services/
│   └── agent-api/
│       ├── app/
│       │   ├── agents/
│       │   ├── api/
│       │   ├── domain/
│       │   ├── safety/
│       │   ├── replay/
│       │   ├── storage/
│       │   └── sync/
│       └── tests/
├── scenarios/
│   └── tokyo-earthquake-v1.json
└── infra/
    └── cloud-run/
```

The exact monorepo tooling may change, but domain boundaries must remain clear.

---

## 3. Non-Negotiable Engineering Rules

1. Safety-critical state transitions must be deterministic.
2. LLM output must use structured schemas.
3. Published plans are immutable.
4. Every material action must reference evidence.
5. Unverified information cannot directly authorize high-risk actions.
6. Route availability must never be represented as route safety.
7. Offline mode must not silently present stale information as current.
8. No private chain-of-thought is persisted or exposed.
9. The replay scenario must run reproducibly without external live APIs.
10. The application must remain useful when Gemini is temporarily unavailable.

---

## 4. Milestone 0 — Repository and Runtime Skeleton

### Goal

Create a runnable local skeleton before implementing agents.

### Tasks

- initialize Next.js frontend
- initialize FastAPI backend
- add shared environment configuration
- define health endpoints
- add lint / format / test commands
- add basic CI if time permits
- define local dev startup instructions
- create Cloud Run deployment skeleton

### Required endpoints

```text
GET /health
GET /version
```

### Acceptance

- frontend loads locally
- backend health returns success
- frontend can call backend
- no agent code required yet

---

## 5. Milestone 1 — Domain Models and Replay Engine

### Goal

Make the product behavior testable without Gemini.

### Tasks

Implement typed models for:

- User
- Situation
- DisasterEvent
- Evidence
- MobilitySnapshot
- Plan
- PlanAction
- AgentEvent
- ReplaySession
- OfflineSnapshot

Implement replay engine:

```text
Start
Pause
Resume
Next Event
Reset
Speed 1x / 2x / 4x
```

Create:

`scenarios/tokyo-earthquake-v1.json`

### Replay event types

```text
disaster_alert
official_update
transport_update
unverified_report
verified_update
network_lost
network_restored
plan_expiration
```

### Acceptance

Running the replay without Gemini must produce deterministic event ordering and situation state transitions.

---

## 6. Milestone 2 — Evidence and Safety Core

### Goal

Implement the safety foundation before generative planning.

### Modules

```text
source_trust.py
freshness.py
conflict.py
action_risk.py
plan_invalidation.py
policy_engine.py
```

### Required deterministic policies

- trusted source classification
- freshness TTL
- stale evidence handling
- conflict detection
- unverified source rejection
- high-risk evidence requirement
- dependency-based action invalidation
- plan expiry
- offline downgrade rules

### Required tests

```text
No source + high-risk action → BLOCK
Stale transport evidence → cannot authorize new movement
Unverified SNS report → excluded from action evidence
Changed route dependency → action invalidated
Conflicting source state → uncertainty surfaced
```

### Acceptance

Safety Core unit tests pass without any LLM call.

---

## 7. Milestone 3 — Plan Engine

### Goal

Create versioned plans and diffs before adding AI-generated wording.

### Tasks

- plan creation service
- immutable plan versions
- action dependencies
- plan invalidation
- plan expiration
- plan diff generation
- `NOW / NEXT / AVOID` grouping

### API

```text
GET  /situations/{id}/plan
GET  /situations/{id}/plans
GET  /plans/{id}
GET  /plans/{id}/diff/{other_id}
POST /situations/{id}/evaluate-plan
```

### Acceptance

Replay must create:

```text
Plan v1
→ relevant transport change
→ v1 invalidated
→ Plan v2
```

with a machine-readable diff.

---

## 8. Milestone 4 — Agent Layer

### Goal

Use Gemini / ADK only where semantic intelligence adds value.

### Agents

#### Situation Agent

Purpose:

- summarize current state
- identify semantic changes
- list uncertainty

Cannot formally invalidate plans.

#### Source Agent

Purpose:

- normalize source content
- extract claims
- summarize evidence

Cannot determine source trust policy.

#### Mobility Agent

Purpose:

- compare route candidates
- normalize mobility results

Cannot label routes as safe.

#### Action Agent

Purpose:

- generate candidate `NOW / NEXT / AVOID` actions
- create user-facing reasons

All output must pass Safety Core.

### Structured Output

Every agent output must validate against a schema.

On parse failure:

```text
retry once
→ reject result
```

### Acceptance

The application remains logically correct if an agent returns invalid output.

---

## 9. Milestone 5 — Core APIs

### Situation

```text
GET  /situations/{id}
POST /situations
POST /situations/{id}/events
```

### Evidence

```text
GET  /situations/{id}/evidence
GET  /evidence/{id}
```

### Plan

```text
GET  /situations/{id}/plan
GET  /situations/{id}/plans
GET  /plans/{id}
GET  /plans/{id}/diff/{other_id}
```

### Trace

```text
GET /situations/{id}/trace
```

### Replay

```text
POST /replay/start
POST /replay/pause
POST /replay/resume
POST /replay/next
POST /replay/reset
GET  /replay/{id}
```

### Connectivity

```text
POST /situations/{id}/network-state
POST /situations/{id}/reconnect
```

API names may evolve, but the domain capabilities must remain.

---

## 10. Milestone 6 — Main UI

### `/`

Purpose:

- demo profile setup
- scenario start

### `/dashboard`

Must show:

- disaster banner
- current location
- network status
- current plan version
- `NOW`
- `NEXT`
- `AVOID`
- latest material change
- verified/unverified source counts
- last verified update time

### `/plan`

Must show:

- plan version history
- current status
- expiration
- changed actions
- invalidation reason

### `/sources`

Must visually distinguish:

- verified official
- verified partner
- stale
- conflicting
- unverified
- rejected

### `/trace`

Must show a concise audit timeline, not chain-of-thought.

### `/demo`

Controls:

- Start
- Pause
- Resume
- Next
- Reset
- Speed

---

## 11. Milestone 7 — Offline Continuity

### Goal

The app must degrade safely instead of failing when connectivity disappears.

### Tasks

- convert web app into installable PWA
- service worker shell caching
- IndexedDB stores
- local last verified plan snapshot
- local evidence timestamps
- local TTL evaluation
- offline status banner
- local plan degradation
- reconnect sync

### Offline behavior

When network is lost:

```text
Current Plan
→ preserved as Last Verified Plan

Live-dependent evidence
→ ages normally

Expired evidence
→ marked stale locally

Dependent actions
→ invalidated or downgraded locally
```

No Gemini call is required for local safety degradation.

### Reconnect behavior

```text
RECONNECTING
→ fetch current evidence
→ compare with offline snapshot
→ refresh trust/freshness
→ evaluate current plan
→ re-plan if required
→ ONLINE_VERIFIED
```

### Acceptance

The judge can disable connectivity after a verified plan exists and still:

- reopen the main UI,
- see the last verified plan,
- see evidence timestamps,
- see that live data is unavailable,
- watch transport-dependent guidance become stale,
- and reconnect without resetting the scenario.

---

## 12. Milestone 8 — Mobility Integration

### First implementation

Use a replay-backed mobility provider so demo behavior is guaranteed.

Interface:

```text
MobilityProvider.search(origin, destination)
MobilityProvider.status(route_id)
```

Implementations:

```text
ReplayMobilityProvider
EkispertMcpProvider
TransportStatusProvider
```

### 駅すぱあと API MCP Server

The Hackathon-provided **駅すぱあと API MCP Server** is the planned production-facing route provider.

Use it for supported mobility data such as route candidates, transfers, travel-time/fare metadata, and station/route information. Keep current disruption evidence as a separate input when needed.

Expected pipeline:

```text
EkispertMcpProvider
→ candidate routes
→ Mobility Agent
→ merge with verified transport/disaster evidence
→ Safety Core
→ candidate movement action
```

The access key must remain backend-only and follow the Secret Manager policy in `SECURITY_AND_SECRETS.md`.

Implementation update (2026-10-05): the provider boundary has been migrated from
b25f into the canonical `services/agent-api` backend using MCP 1.x alongside ADK.
Transport tests and safe failure handling are implemented. Live credentials,
provider connectivity and route normalization into evidence require separate
acceptance; replay still uses deterministic synthetic evidence.

### Rules

- A provider result may return `AVAILABLE`, but only the Safety Core controls whether a movement recommendation is eligible.
- `route_available` is not `route_safe`.
- Live MCP failure must fall back safely; it must not fabricate route status.
- ReplayMobilityProvider remains the deterministic judging/test path.

---

## 13. Milestone 9 — Observability

### Required trace events

- event received
- evidence normalized
- evidence trust assigned
- situation updated
- plan generated
- action blocked
- plan invalidated
- re-plan started
- re-plan completed
- network lost
- offline mode entered
- evidence became stale
- reconnect started
- reconnect completed

### Cloud Logging

Send application operational logs to Cloud Logging.

Do not log sensitive prompt content unless explicitly required for debugging in development mode.

---

## 14. Milestone 10 — Demo Hardening

### The golden path

The complete 3-minute scenario must demonstrate:

1. normal state
2. earthquake alert
3. verified official evidence
4. Plan v1
5. transport disruption
6. plan invalidation
7. Plan v2
8. unverified SNS report rejected
9. new verified evidence
10. Plan v3
11. network loss
12. Continuity Mode
13. live evidence becomes stale
14. last verified plan remains accessible
15. network restored
16. sync and automatic re-evaluation
17. final trace view

### Reliability target

Run the complete scenario at least 10 consecutive times without a state-machine failure.

Natural language may vary. Core state transitions must not.

---

## 15. Test Strategy

### Unit tests

Focus on:

- Safety Core
- evidence TTL
- conflict handling
- dependency invalidation
- plan versioning
- replay event ordering
- offline staleness

### Integration tests

Focus on:

- event → evidence → situation
- situation → plan
- changed evidence → invalidation
- candidate action → Safety Core
- offline → reconnect

### End-to-end tests

At minimum:

```text
E2E-01 Golden replay
E2E-02 Unverified SNS rejection
E2E-03 Plan expiry
E2E-04 Network loss and offline survival
E2E-05 Reconnect and re-plan
E2E-06 Gemini invalid structured output
E2E-07 Mobility API unavailable
```

---

## 16. Development Order

Strict order:

```text
1. Runtime skeleton
2. Domain models
3. Replay engine
4. Safety Core
5. Plan engine
6. Core UI
7. Agent layer
8. Offline continuity
9. Mobility integration
10. Cloud deployment
11. Demo hardening
12. Submission assets
```

Do not start with visual polish or external APIs before the deterministic core works.

---

## 17. Scope Control

Do not add the following before the golden replay is stable:

- native mobile application
- real background GPS tracking
- family tracking
- SOS dispatch
- medical diagnosis
- building safety judgment
- earthquake prediction
- real-time social media ingestion
- account billing
- broad multi-disaster support
- production identity platform

Any new feature must answer:

> Does this materially improve the 3-minute evaluation story?

If not, defer it.

---

## 18. Suggested Build Checkpoints

### Checkpoint A — Deterministic Core

Must have:

- replay
- evidence
- state
- safety rules
- plan versioning

### Checkpoint B — Agentic Loop

Must have:

- Situation Agent
- Action Agent
- automatic re-plan
- source-linked explanation

### Checkpoint C — Disaster-Ready Behavior

Must have:

- network loss
- offline snapshot
- staleness
- reconnect

### Checkpoint D — Judge-Ready

Must have:

- Cloud Run deployment
- stable URL
- complete replay
- architecture diagram
- README
- demo video

---

## 19. Definition of MVP Complete

72H v0.1 is complete only when all of the following are true:

- the replay starts from a clean state,
- an earthquake event creates a situation,
- verified evidence produces Plan v1,
- a relevant transport change invalidates the correct dependency,
- the system automatically creates a new plan,
- unverified information is visibly excluded from action evidence,
- every material action can explain its source,
- network loss enters Continuity Mode without breaking the app,
- stale evidence locally degrades dependent guidance,
- reconnect causes synchronization and plan re-evaluation,
- the complete agent timeline is visible without exposing chain-of-thought,
- and the scenario can run repeatedly with consistent state transitions.

---

## 20. Codex Execution Rule

When implementing from this specification, Codex should:

1. read all files under `docs/` before coding,
2. treat `AGENT_SAFETY_CONTRACT.md` as authoritative for safety behavior,
3. treat `DATA_MODEL.md` as authoritative for domain state,
4. treat `REPLAY_SCENARIO.md` as authoritative for demo behavior,
5. avoid adding features outside the documented v0.1 scope,
6. add or update tests for every deterministic policy,
7. never replace safety policy with prompt-only behavior,
8. and report any contradiction between specifications before silently choosing one.
