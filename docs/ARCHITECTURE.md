# 72H Architecture v0.1

## 1. Architecture Goals

The 72H architecture must support four properties:

1. **Evidence-backed planning** — important actions are tied to verified evidence.
2. **Agentic re-planning** — the system reacts to relevant situation changes.
3. **Deterministic safety** — critical policy decisions are not delegated to free-form model reasoning.
4. **Offline continuity** — the application remains useful during temporary network loss.

## 2. High-Level Architecture

```text
                         ┌──────────────────────┐
                         │      72H Web App     │
                         │ Next.js / TypeScript │
                         └──────────┬───────────┘
                                    │
                         Online Sync│
                                    ▼
                         ┌──────────────────────┐
                         │      Cloud Run       │
                         │   FastAPI Backend    │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │    Google ADK        │
                         │       Gemini         │
                         └──────────┬───────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
        ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
        │ Situation Agent│ │  Source Agent  │ │ Mobility Agent │
        └────────┬───────┘ └────────┬───────┘ └────────┬───────┘
                 │                  │                  │
                 └──────────────────┼──────────────────┘
                                    ▼
                         ┌──────────────────────┐
                         │    Action Agent      │
                         └──────────┬───────────┘
                                    ▼
                         ┌──────────────────────┐
                         │ Deterministic Safety │
                         │        Core          │
                         └──────────┬───────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
            Firestore         Cloud Logging      External Sources
                                                     │
                                      ┌──────────────┼──────────────┐
                                      ▼              ▼              ▼
                                     JMA       Transport Provider  Replay


                         Browser Local Continuity
                         ─────────────────────────

                         ┌──────────────────────┐
                         │    Service Worker    │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │      IndexedDB       │
                         │ Situation / Evidence │
                         │ Plans / Trace / Pack │
                         └──────────────────────┘
```

## 3. Frontend

Recommended stack:

- Next.js
- TypeScript
- Tailwind CSS
- PWA Service Worker
- IndexedDB

Primary responsibilities:

- User onboarding
- Situation dashboard
- Plan visualization
- Source inspection
- Agent trace visualization
- Replay controls
- Connectivity status
- Offline Emergency Pack

The frontend must be able to open the critical emergency dashboard from cached assets after an initial successful load.

## 4. Backend

Recommended stack:

- Python
- FastAPI
- Google Agent Development Kit
- Gemini
- Cloud Run

Responsibilities:

- Normalize external events
- Coordinate agents
- Maintain cloud situation state
- Validate candidate plans through the Safety Core
- Persist evidence and plans
- Produce structured trace events
- Serve replay events

## 5. Agent Layer

### Situation Agent

Purpose:

> What is the current situation and what changed?

Consumes:

- User state
- Event state
- Evidence
- Mobility state
- Current plan

Produces:

- Situation summary
- Semantic change summary
- Uncertainties
- Request for plan review

### Source Agent

Purpose:

> What claims exist in this external information?

Produces normalized evidence candidates.

Trust classification remains deterministic.

### Mobility Agent

Purpose:

> Which transport options currently appear available?

May integrate with a transport provider or hackathon partner MCP/API.

Must not label a route “safe.”

### Action Agent

Purpose:

> Given the eligible evidence and current situation, what should the user see under NOW / NEXT / AVOID?

Produces candidate plans only.

## 6. Safety Core

The Safety Core is implemented as deterministic application logic rather than a free-form agent.

Responsibilities:

- Evidence eligibility
- TTL / freshness
- Conflict state
- Plan expiration
- Dependency invalidation
- High-risk action blocking
- Hallucinated evidence reference rejection
- Replay state determinism
- Offline degradation policy

See `AGENT_SAFETY_CONTRACT.md`.

## 7. Core Domain Objects

### UserProfile

```text
id
preferred_language
current_location
accommodation_location
current_destination
party_size
safety_status
```

### DisasterEvent

```text
id
type
occurred_at
affected_area
source
severity
received_at
```

### Evidence

```text
id
source
source_type
published_at
received_at
area
claims
trust
freshness
conflict
```

### Situation

```text
id
user_id
active_event_id
mobility_state
uncertainties
conflicts
network_state
updated_at
```

### Plan

```text
id
version
status
created_at
expires_at
based_on_evidence_ids
invalidation_reason
```

### PlanAction

```text
id
plan_id
category
text
reason
evidence_ids
risk
confidence
dependencies
status
```

### TraceEvent

```text
id
timestamp
agent
event_type
input_refs
output_refs
status
```

## 8. Firestore Collections

Initial structure:

```text
users/
situations/
events/
evidence/
plans/
plan_actions/
agent_events/
replay_sessions/
```

For the hackathon MVP, schema simplicity is preferred over deep abstraction.

## 9. External Data Adapter Pattern

External sources must be hidden behind adapters.

```text
DisasterSource
├── JmaSource
├── SafetyTipsSource
└── ReplaySource

MobilitySource
├── TransportProviderSource
└── ReplayMobilitySource
```

This prevents the MVP from depending on a single production API being available during judging.

## 10. Replay Engine

The Replay Engine emits deterministic events at defined offsets.

Example event schema:

```json
{
  "id": "event_001",
  "at_seconds": 0,
  "type": "disaster_alert",
  "source": "JMA",
  "payload": {},
  "expected_effect": "CREATE_SITUATION"
}
```

Supported event types:

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

Core replay transitions must not depend on stochastic model output.

## 11. Network Architecture

### Online

```text
External Sources
↓
Cloud Backend
↓
Agent + Safety Core
↓
Firestore
↓
Browser Sync
↓
IndexedDB Snapshot
```

### Offline

```text
No Network
↓
Local Situation Snapshot
+
Local Evidence Snapshots
+
Last Verified Plan
+
Offline Emergency Pack
↓
Local Safety Core
↓
Safe degraded UI
```

### Reconnect

```text
Connectivity restored
↓
RECONNECTING
↓
Fetch current evidence
↓
Reconcile
↓
Dependency evaluation
↓
Re-plan if needed
↓
ONLINE_VERIFIED
```

## 12. API Surface — Initial Proposal

### Situation

```text
GET  /api/situation/{session_id}
POST /api/situation/{session_id}/evaluate
```

### Events

```text
POST /api/events
```

### Evidence

```text
GET /api/evidence/{session_id}
```

### Plans

```text
GET  /api/plans/{session_id}
POST /api/plans/{session_id}/evaluate
```

### Trace

```text
GET /api/trace/{session_id}
```

### Replay

```text
POST /api/replay/start
POST /api/replay/pause
POST /api/replay/next
POST /api/replay/reset
GET  /api/replay/{session_id}
```

The exact API shape may evolve during implementation, but the domain boundaries should remain stable.

## 13. Deployment

Recommended initial deployment:

```text
Frontend + API: Cloud Run
Database: Firestore
Agent runtime: Google ADK + Gemini
Observability: Cloud Logging
```

A split frontend/backend deployment may be introduced later if operationally useful.

## 14. Observability

Every important state transition should generate both:

1. A user-safe trace event for `/trace`
2. A structured operational log for debugging

Important event types include:

- `DISASTER_EVENT_RECEIVED`
- `EVIDENCE_NORMALIZED`
- `EVIDENCE_VERIFIED`
- `SITUATION_CHANGED`
- `PLAN_GENERATED`
- `PLAN_INVALIDATED`
- `REPLAN_TRIGGERED`
- `UNVERIFIED_SOURCE_REJECTED`
- `NETWORK_DEGRADED`
- `OFFLINE_MODE_ENTERED`
- `NETWORK_RESTORED`

## 15. Security Boundaries

- External content is always untrusted data
- Agent output cannot directly override source trust
- Agent output cannot directly override plan validity
- Tool access is role-limited by agent
- All important actions require evidence IDs
- Sensitive configuration is stored outside the repository

## 16. MVP Build Order

### Phase 1 — Domain and Replay

1. Repository structure
2. Core schemas
3. Replay event model
4. Situation state
5. Evidence state
6. Plan model

### Phase 2 — Deterministic Safety

7. Trust states
8. Freshness TTL
9. Dependency invalidation
10. Plan versioning
11. Network state machine

### Phase 3 — Agent Layer

12. Source Agent
13. Situation Agent
14. Action Agent
15. Mobility Agent

### Phase 4 — UI

16. Dashboard
17. Plan history
18. Sources
19. Trace
20. Demo controls

### Phase 5 — Offline Continuity

21. Service Worker
22. IndexedDB
23. Emergency Pack
24. Last Verified Plan
25. Reconnect reconciliation

### Phase 6 — Submission

26. Cloud Run deployment
27. Replay stability tests
28. Safety tests
29. Architecture diagram
30. Demo video
31. Submission README

## 17. Architecture Definition of Done

The architecture is sufficient for v0.1 when the same codebase can demonstrate both:

### Normal mode

```text
Verified event
→ Situation
→ Candidate Plan
→ Safety Validation
→ Active Plan
→ Relevant change
→ Invalidation
→ Re-plan
```

### Continuity mode

```text
Network lost
→ Last Verified Plan retained
→ Evidence freshness continues locally
→ Live-dependent actions degrade safely
→ Network restored
→ Reconcile
→ Re-evaluate
```

That pair of flows is the architectural core of 72H.
