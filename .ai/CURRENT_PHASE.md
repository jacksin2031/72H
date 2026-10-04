# 72H — Current Development Phase

## Phase

**Phase 3 — IMPLEMENTED / NOT FULLY VALIDATED**

Canonical development branch: **codex/hackathon-mvp**. Consolidate the requested
Ekispert provider, Hackathon skills and mobility docs here. Do not continue the
independent b25f application scaffold. Merge the validated canonical tree into
main; preserve prior worktree changes as a recoverable record.

Phase 2 core gate accepted: 22 backend tests and a full 11-event HTTP replay
through the production frontend passed; the actual snapshot passed the frontend
schema boundary. Four immutable plan versions and twelve actions were produced.
Independent review found source/claim scope and equal-timestamp reconnect issues.
Both are fixed with regression tests; independent reproduction now rejects the
unauthorized claim and keeps pre-restoration evidence behind the reconnect gate.
Frontend PWA shell, local snapshot/TTL degradation and emergency pack are
implemented. Nonempty offline-plan browser acceptance passed and is recorded in
`docs/VALIDATION.md`.

Phase 3 local gate: 40 backend tests and 18 frontend tests (including a real
11-event API snapshot), typecheck and production build passed on 2026-10-05 JST.
ADK 1.39.1 / Vertex Gemini integration, bounded typed candidate selection and
server-owned safety publication are implemented. The real SDK path without ADC
produced TIMEOUT / MISSING_ADC fallback and four immutable plan versions; no
successful Gemini request or cloud deployment is claimed. Independent re-review
found no new blocking issue in this scope. Cloud Shell was selected but its
browser reached Google sign-in only. Target project access remains unverified.

Consolidation gate: original 40 backend tests (including Gemini) plus 11 Ekispert
adapter tests pass, **51 total**. Frontend gate remains 17 tests plus one real
snapshot contract check, **18 total**, with typecheck/build and fallback GUI
acceptance. MCP 1.30.0 is explicitly locked; Ekispert remains a backend-only
provider-data boundary and does not promote results into trusted route evidence.
Its live connection is unverified because no backend key is configured.

Phase 1 foundation accepted on 2026-10-04: 17 backend tests, 5 frontend
boundary tests (including a live API snapshot), TypeScript and Next.js build
passed. Replay, immutable domain contracts, isolated sessions and the API/web
connection are implemented. Secret-pattern checks passed. Browser acceptance
is tracked separately in `docs/VALIDATION.md`.

The Phase 1 specification below remains the acceptance baseline. Cloud Run
deployment and real Gemini/ADK execution are still unverified. Target Google
Cloud project: `h-japan`.

Do not begin production API integration, advanced UI polish, or broad feature expansion until the Phase 1 acceptance criteria below pass.

## Objective

Create the minimum working foundation that can later support the real agent pipeline without rewriting core domain logic.

Phase 1 should establish:

- repository/application skeleton
- canonical domain types
- deterministic replay event model
- situation state model
- evidence model
- plan and plan-action model
- trace-event model
- state transition boundaries
- test harness for deterministic behavior

## Required Deliverables

### 1. Repository Structure

Recommended starting shape:

```text
72H/
├── apps/
│   └── web/
├── services/
│   └── api/
├── packages/
│   └── contracts/
├── tests/
├── docs/
├── .ai/
└── AGENTS.md
```

A simpler structure is acceptable if it keeps frontend, backend, contracts, tests, and docs clearly separated.

Do not introduce a monorepo framework unless it materially simplifies the implementation.

### 2. Shared Domain Contracts

Implement typed schemas for at least:

- `UserProfile`
- `DisasterEvent`
- `Evidence`
- `Situation`
- `Plan`
- `PlanAction`
- `TraceEvent`
- `ReplayEvent`
- `ReplaySession`
- `NetworkState`

Use `docs/DATA_MODEL.md` as the canonical design source.

### 3. Deterministic Replay Engine

Implement a replay engine that can:

- load a scenario
- start
- pause
- resume
- advance to next event
- reset
- emit events in deterministic order
- preserve event IDs and timestamps

The replay engine must emit data into the normal application pipeline. It must not directly render predetermined plans.

Initial event kinds should support at least:

```text
disaster_alert
official_update
transport_update
unverified_report
network_degraded
network_lost
network_restored
verified_update
plan_expiration
```

### 4. Situation State

Implement a deterministic situation-state container that can represent:

- user context
- active disaster event
- evidence references
- mobility state placeholder
- current plan reference
- uncertainty states
- conflicts
- network state
- updated timestamp

Phase 1 does not require sophisticated Gemini interpretation yet.

### 5. Evidence State

Implement evidence objects with fields necessary for later safety checks, including:

- ID
- source
- source type
- claims
- published / received timestamps
- affected area
- trust state
- freshness state
- conflict state

Trust/freshness logic may begin as explicit deterministic test values during Phase 1, but the domain model must support the final Safety Core design.

### 6. Plan Model

Implement versioned plans with:

- plan ID
- version
- status
- created time
- expiration
- evidence references
- invalidation reason
- actions

Plan actions must support:

- category: `NOW | NEXT | AVOID`
- evidence references
- dependencies
- risk level
- status

Never overwrite old plan versions.

### 7. Trace Model

Every important replay and state transition should be capable of emitting a structured trace event.

No private chain-of-thought fields.

### 8. Tests

Phase 1 tests must prove at least:

1. replay ordering is deterministic
2. replay reset restores initial state
3. identical replay input produces identical core state transitions
4. plan versions are append-only
5. evidence references remain stable
6. network-state transitions are represented correctly
7. timeline-specific hard-coded plan rendering does not exist

## Explicitly Not Required Yet

Do not block Phase 1 on:

- live JMA integration
- live Safety Tips integration
- live transport API / 駅すぱあと API MCP Server integration
- Secret Manager
- Firestore persistence
- production Cloud Run deployment
- Gemini output quality
- ADK orchestration
- complete PWA offline cache
- final UI design

Those belong to later phases.

However, architecture boundaries must make those integrations possible without replacing the core domain model.

For mobility, preserve the provider boundary for deterministic replay and
`EkispertMcpProvider`. Live 駅すぱあと output is mobility candidate data only; it
cannot independently authorize a disaster-safe route or high-risk action.
The Phase 1 gate was passed before adding this live adapter boundary.

## Phase 1 Acceptance Gate

Phase 1 is complete only when:

```text
Replay Scenario
→ Replay Events
→ Situation State Updates
→ Evidence State Updates
→ Trace Events
```

runs deterministically and is covered by automated tests.

Additionally:

- core schemas match documented contracts
- no secrets exist in the repository
- replay is data-driven, not UI-scripted
- prior plan versions cannot be silently overwritten
- all relevant tests pass

## Historical Phase 1 → Phase 2 transition

This transition was completed locally; retain it as the historical gate:

**Phase 2 — Deterministic Safety Core**

Phase 2 will implement:

- source trust evaluation
- evidence TTL / freshness
- conflict handling
- action risk classification
- dependency invalidation
- plan expiration
- safety allow/modify/block decisions
- local offline degradation rules

Do not skip directly to agent polish before the Safety Core is working.

## Current next gate

Use the reviewed Cloud Shell source bundle to build private Cloud Run staging in
`h-japan`. Record source hash/image digest, prove a successful Gemini/ADK call,
and perform deployed clean-browser/offline acceptance before configuring judging
access. Model credentials, project IAM/billing and Docker/cloud build are still
unverified. No live-feed, persistence or broad feature expansion is authorized
by completing the local gate alone.
