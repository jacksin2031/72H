# 72H Data Model v0.1

## Purpose

This document defines the persistent and local data model for 72H. It is designed to support:

- deterministic replay,
- evidence provenance,
- plan versioning,
- automatic plan invalidation,
- offline continuity,
- reconnect-and-replan behavior,
- and auditability without storing private chain-of-thought.

The canonical cloud store for v0.1 is Firestore. The browser keeps a reduced offline copy in IndexedDB.

---

## 1. Core Entities

72H uses the following logical entities:

- `users`
- `situations`
- `disaster_events`
- `evidence`
- `mobility_snapshots`
- `plans`
- `plan_actions`
- `agent_events`
- `replay_sessions`
- `offline_snapshots`

The main relationship is:

```text
User
 └── Situation
      ├── Disaster Events
      ├── Evidence
      ├── Mobility Snapshots
      ├── Plans
      │    └── Plan Actions
      ├── Agent Events
      └── Offline Snapshot
```

---

## 2. User

Collection: `users`

```json
{
  "id": "user_demo_001",
  "preferred_language": "zh-TW",
  "current_location": {
    "label": "Shibuya",
    "lat": null,
    "lng": null
  },
  "accommodation_location": {
    "label": "Asakusa",
    "lat": null,
    "lng": null
  },
  "current_destination": {
    "label": "Asakusa"
  },
  "party_size": 1,
  "self_reported_safety_status": "SAFE",
  "accessibility_constraints": [],
  "created_at": "2026-10-04T17:40:00+09:00",
  "updated_at": "2026-10-04T17:40:00+09:00"
}
```

### Allowed safety status values

```text
SAFE
UNCERTAIN
NEEDS_ASSISTANCE
UNKNOWN
```

The system must never infer a user's physical safety status from LLM output alone.

---

## 3. Situation

Collection: `situations`

One active situation represents the current incident context for one user/session.

```json
{
  "id": "sit_001",
  "user_id": "user_demo_001",
  "incident_status": "MONITORING",
  "network_state": "ONLINE_VERIFIED",
  "active_event_ids": ["evt_001"],
  "current_plan_id": "plan_v2",
  "latest_evidence_at": "2026-10-04T17:47:00+09:00",
  "uncertainty_flags": [],
  "conflict_flags": [],
  "created_at": "2026-10-04T17:42:00+09:00",
  "updated_at": "2026-10-04T17:48:00+09:00"
}
```

### Incident status values

```text
IDLE
EVENT_DETECTED
ASSESSING
PLAN_ACTIVE
MONITORING
CHANGE_DETECTED
PLAN_REVIEW
PLAN_INVALIDATED
REPLANNING
WAITING_FOR_EVIDENCE
OFFLINE_CONTINUITY
```

### Network state values

```text
ONLINE_VERIFIED
ONLINE_DEGRADED
OFFLINE_RECENT
OFFLINE_STALE
RECONNECTING
```

---

## 4. Disaster Event

Collection: `disaster_events`

```json
{
  "id": "evt_001",
  "situation_id": "sit_001",
  "event_type": "EARTHQUAKE",
  "occurred_at": "2026-10-04T17:42:00+09:00",
  "received_at": "2026-10-04T17:42:03+09:00",
  "affected_areas": ["Tokyo"],
  "source_name": "JMA",
  "source_class": "OFFICIAL",
  "severity_raw": "demo",
  "status": "ACTIVE",
  "raw_reference": "replay://tokyo-earthquake/evt_001"
}
```

### Event type values for v0.1

```text
EARTHQUAKE
```

Schemas may reserve future values such as `TSUNAMI`, `FLOOD`, `TYPHOON`, and `VOLCANO`, but they are out of scope for v0.1 behavior.

---

## 5. Evidence

Collection: `evidence`

Evidence is the most important provenance object in 72H.

```json
{
  "id": "ev_002",
  "situation_id": "sit_001",
  "source_name": "Transport Provider",
  "source_class": "PARTNER",
  "trust_status": "VERIFIED_PARTNER",
  "freshness_status": "CURRENT",
  "published_at": "2026-10-04T17:47:00+09:00",
  "received_at": "2026-10-04T17:47:02+09:00",
  "expires_at": "2026-10-04T17:52:02+09:00",
  "relevant_areas": ["Shibuya", "Asakusa"],
  "claim_type": "TRANSPORT_STATUS",
  "claims": [
    {
      "key": "route.shibuya_asakusa.status",
      "value": "DISRUPTED"
    }
  ],
  "summary": "Service disruption detected on the previous return route.",
  "conflict_group": null,
  "eligible_for_high_risk": true,
  "raw_reference": "replay://tokyo-earthquake/ev_002"
}
```

### Trust status

```text
VERIFIED_OFFICIAL
VERIFIED_PARTNER
UNVERIFIED
CONFLICTING
STALE
REJECTED
```

### Freshness status

```text
CURRENT
STALE
UNKNOWN
```

### Source classes

```text
OFFICIAL
PARTNER
USER_REPORT
SOCIAL_MEDIA
OTHER
```

### Rule

`eligible_for_high_risk` must be derived by deterministic policy, not written directly by an LLM.

---

## 6. Mobility Snapshot

Collection: `mobility_snapshots`

```json
{
  "id": "mob_001",
  "situation_id": "sit_001",
  "origin": "Shibuya",
  "destination": "Asakusa",
  "status": "DISRUPTED",
  "candidate_routes": [],
  "evidence_ids": ["ev_002"],
  "checked_at": "2026-10-04T17:47:05+09:00",
  "expires_at": "2026-10-04T17:52:05+09:00"
}
```

### Allowed mobility status values

```text
AVAILABLE
DISRUPTED
UNKNOWN
```

`SAFE` and `DANGEROUS` are intentionally invalid mobility values.

---

## 7. Plan

Collection: `plans`

Plans are immutable after publication. A new plan creates a new version.

```json
{
  "id": "plan_v2",
  "situation_id": "sit_001",
  "version": 2,
  "status": "ACTIVE",
  "created_at": "2026-10-04T17:48:00+09:00",
  "expires_at": "2026-10-04T18:03:00+09:00",
  "invalidate_on_new_relevant_evidence": true,
  "based_on_evidence_ids": ["ev_001", "ev_002"],
  "previous_plan_id": "plan_v1",
  "invalidation_reason": null,
  "changed_action_ids": ["act_v2_003"],
  "language": "zh-TW"
}
```

### Plan status values

```text
DRAFT
ACTIVE
PARTIALLY_INVALID
INVALIDATED
EXPIRED
SUPERSEDED
```

---

## 8. Plan Action

Collection: `plan_actions`

```json
{
  "id": "act_v2_003",
  "plan_id": "plan_v2",
  "category": "NEXT",
  "text": "Wait for newly verified transport information before starting the return trip.",
  "reason": "The previous route dependency changed after a transport disruption update.",
  "risk_level": "MEDIUM",
  "evidence_ids": ["ev_002"],
  "dependency_keys": [
    "route.shibuya_asakusa.status"
  ],
  "status": "ACTIVE",
  "safety_decision": "ALLOW"
}
```

### Category values

```text
NOW
NEXT
AVOID
```

### Risk values

```text
LOW
MEDIUM
HIGH
```

### Action status values

```text
ACTIVE
INVALID
EXPIRED
BLOCKED
SUPERSEDED
```

### Safety decision values

```text
ALLOW
MODIFY
BLOCK
WAIT_FOR_EVIDENCE
```

---

## 9. Agent Event

Collection: `agent_events`

Agent events are audit records, not chain-of-thought.

```json
{
  "id": "trace_017",
  "situation_id": "sit_001",
  "timestamp": "2026-10-04T17:47:08+09:00",
  "agent": "SITUATION_AGENT",
  "event_type": "PLAN_REVIEW_TRIGGERED",
  "input_refs": ["ev_002", "plan_v1"],
  "output_refs": ["plan_v2"],
  "status": "SUCCESS",
  "public_summary": "Transport conditions changed and the current plan required re-evaluation."
}
```

### Agent identifiers

```text
SITUATION_AGENT
SOURCE_AGENT
MOBILITY_AGENT
ACTION_AGENT
SAFETY_CORE
REPLAY_ENGINE
OFFLINE_ENGINE
SYNC_ENGINE
```

No hidden reasoning text may be persisted.

---

## 10. Replay Session

Collection: `replay_sessions`

```json
{
  "id": "replay_tokyo_001",
  "scenario_key": "tokyo-earthquake-v1",
  "status": "RUNNING",
  "speed": 2,
  "started_at": "2026-10-04T17:40:00+09:00",
  "current_event_index": 4,
  "deterministic_seed": "72h-v1",
  "situation_id": "sit_001"
}
```

### Replay status values

```text
READY
RUNNING
PAUSED
COMPLETED
RESET
```

---

## 11. Offline Snapshot

Collection: `offline_snapshots` in Firestore and mirrored to IndexedDB.

```json
{
  "id": "offline_001",
  "situation_id": "sit_001",
  "captured_at": "2026-10-04T17:52:00+09:00",
  "last_verified_plan_id": "plan_v3",
  "evidence_ids": ["ev_001", "ev_002", "ev_003"],
  "network_state_at_capture": "ONLINE_VERIFIED",
  "emergency_pack_version": "1.0.0",
  "local_policy_version": "1.0.0"
}
```

Offline storage must include enough information to:

- render the last verified plan,
- show provenance and timestamps,
- calculate evidence staleness,
- invalidate time-sensitive actions locally,
- show static emergency guidance,
- and queue a re-evaluation after reconnect.

---

## 12. IndexedDB Stores

The browser offline database should use these stores:

```text
profile
current_situation
last_verified_plan
plan_actions
evidence_snapshots
emergency_pack
pending_sync_events
local_trace
```

Do not cache unnecessary raw source payloads.

---

## 13. TTL Defaults

Initial deterministic defaults:

| Evidence Type | TTL |
|---|---:|
| official disaster update | 15 min |
| transport status | 5 min |
| user-reported status | 10 min |
| static emergency guidance | version based |

These values are v0.1 product defaults and must be configurable in code.

---

## 14. Dependency Model

Actions depend on explicit state keys.

Example:

```json
{
  "action_id": "act_v1_003",
  "dependency_keys": [
    "route.shibuya_asakusa.status",
    "disaster.tokyo.status"
  ]
}
```

When a dependency changes, deterministic code decides whether the action becomes invalid.

This must not be delegated to free-form LLM judgment.

---

## 15. Versioning Rules

- Evidence is append-only.
- Published plans are immutable.
- Plan changes create a new plan version.
- Agent events are append-only.
- Offline snapshots are replaceable, but the latest capture time must be retained.
- Replay state may be reset explicitly.

---

## 16. Privacy Rules

For the hackathon MVP:

- do not store precise background location history,
- do not store unnecessary personal identifiers,
- do not persist hidden model reasoning,
- do not treat demo identity as production authentication,
- and keep all demo user data clearly synthetic.

---

## 17. Minimum Data Acceptance Tests

The implementation is ready only if it can prove:

1. `plan_v1` remains queryable after `plan_v2` is created.
2. Every high-impact action can resolve its evidence IDs.
3. stale transport evidence changes action eligibility.
4. an unverified SNS evidence object cannot support a high-risk action.
5. a changed dependency can invalidate the corresponding plan action.
6. an offline snapshot renders without Firestore access.
7. reconnect can compare the offline snapshot with new cloud evidence and trigger re-evaluation.
8. no agent event contains private chain-of-thought.

---

## Definition of Done

The data model is complete when the following chain is representable without implicit state:

```text
External Event
→ Evidence
→ Situation Update
→ Candidate Plan
→ Safety Decision
→ Published Plan
→ Dependency Change
→ Plan Invalidation
→ Offline Snapshot
→ Reconnect
→ Re-evaluation
```
