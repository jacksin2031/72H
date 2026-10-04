# 72H — Current Development Phase

## Phase

**Phase 1 — Domain Foundation + Deterministic Replay Skeleton**

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
- live transport API
- Secret Manager
- Firestore persistence
- production Cloud Run deployment
- Gemini output quality
- ADK orchestration
- complete PWA offline cache
- final UI design

Those belong to later phases.

However, architecture boundaries must make those integrations possible without replacing the core domain model.

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

## Next Phase

After this gate passes, proceed to:

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
