# 72H Product Specification v0.1

## Authorized P1.1 accessible GPS extension (2026-10-08)

The approved local milestone is defined in
[VNEXT_P1_1_ACCESSIBLE_GPS_UI.md](VNEXT_P1_1_ACCESSIBLE_GPS_UI.md).
First use explains location, requests permission only after a user action,
confirms a resolved area, then starts Live. Nationwide prefecture/municipality
selection and emergency basics remain available without GPS or text entry.
Accommodation defaults to unset, party size to one, and self-reported safety
to UNKNOWN; optional profile settings belong in More. Consumer text and primary
controls are enlarged, with a labeled Home / Plan / More navigation.

An official N03 boundary resolver runs locally in a Web Worker. Only canonical
area IDs, source and observation time reach the session API; precise device
coordinates stay local. This explicitly extends the earlier contract that GPS
did not select areas. It does not extend source trust, disaster verification,
route safety or movement authorization. Freshness and network verification are
independent. GPS is optional on desktop, whose role remains preparedness/review.
Real-device GPS and production acceptance are separate release gates.

## Authorized vNext P1 extension

The user's 2026-10-06 JST `/goal complete` request authorizes the live-source,
route-presentation and device-role work in
[VNEXT_P1_LIVE_ROUTE_DEVICE_ROLES.md](VNEXT_P1_LIVE_ROUTE_DEVICE_ROLES.md).
Its approved mobile direction is a scene-based web/PWA app: one current safe
instruction, details in secondary scenes/sheets, and a map mounted only when
deterministic movement gates permit it. Desktop supports preparedness, status,
review and a bounded handoff to mobile. Both use one Safety Core and plan state.

Live information, synthetic replay and cached state remain separate and visibly
labeled. A source or route provider cannot issue movement permission. A map must
not imply an eligible destination, an open shelter or a guaranteed safe route.
Unimplemented live sources and cross-device synchronization remain explicitly
unsupported. Acceptance evidence is tracked in
[VNEXT_P1_VALIDATION.md](VNEXT_P1_VALIDATION.md); this authorization is not a
claim that implementation or production acceptance has finished.

## Authorized vNext P0 extension

On 2026-10-05 JST the user approved the P0 extension in
[VNEXT_PRODUCT_PLAN.md](VNEXT_PRODUCT_PLAN.md). Its module acceptance contracts
are in [VNEXT_P0_CONTRACTS.md](VNEXT_P0_CONTRACTS.md). Normal navigation becomes
Home / Plan / More; Home uses an offline-capable reference map and one usable NOW
action. Evidence remains accessible from More; Replay and Agent Trace are inside
Demo / Judge Mode. The routes below remain available for existing links.

Deterministic severity, source authority, in-app event notifications, battery
degradation and consent-based local safety checks are additive. Safety checks
never dispatch rescue; silence is unknown. The existing Safety Core, immutable
plans, Gemini/ADK and reconnection rules remain authoritative. Live feed/route
safety and native background service claims are not introduced by this extension.

The separately authorized architecture follow-up makes profile/map selection
configurable, adds opt-in one-point Last Known Location persistence, and scopes
severity to a canonical area hierarchy. Registered Tokyo and Osaka synthetic
replays exercise the same pipeline; only central Tokyo map coverage is installed.
See [VNEXT_AREA_LOCATION.md](VNEXT_AREA_LOCATION.md).

## 1. Product Goal

72H is a disaster-action AI agent designed to turn verified alerts into practical next actions.

The product is not primarily a disaster-information app. Its purpose is to answer:

> **Given my current situation and the latest verified information, what should I do next?**

72H continuously observes changes, evaluates whether the current plan is still valid, and re-plans when necessary.

Core loop:

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

## 2. Primary User

The v0.1 primary user is a foreign visitor in Japan who may not be familiar with local disaster information, transport conditions, or emergency procedures.

Primary demo persona:

- Language: Traditional Chinese
- Current location: Shibuya, Tokyo
- Accommodation: Asakusa, Tokyo
- Party size: 1
- Current safety status: Safe
- Original plan: Return to accommodation at 18:00

Supported UI languages for v0.1:

- Japanese
- English
- Traditional Chinese

## 3. Primary Scenario

v0.1 fully supports one disaster type:

- Earthquake

Other disaster types may exist in schemas but are out of scope for the first implementation:

- Tsunami
- Flood
- Typhoon
- Volcano
- Heavy snow

## 4. Product Principles

### 4.1 No Source → No High-Risk Action

Important safety-related recommendations must be traceable to eligible evidence.

If sufficient verified evidence is unavailable, 72H must not invent a definitive action.

### 4.2 No Disaster Prediction

72H must not:

- Predict earthquakes
- Declare a building safe
- Declare an area safe without authoritative evidence
- Issue unsupported evacuation orders
- Provide medical diagnosis

### 4.3 Plans Are Temporary

Every plan must have:

- A creation time
- A plan version
- Evidence references
- An expiration policy
- Invalidation conditions

### 4.4 Explain Changes

When a plan changes, the user must be able to understand:

- What changed
- Why it changed
- Which evidence caused the change

## 5. Functional Requirements

### F01 — User Situation Profile

Store:

- `preferred_language`
- `current_location`
- `accommodation_location`
- `current_destination`
- `party_size`
- `self_reported_safety_status`
- `current_plan_summary`

### F02 — Disaster Event Intake

Normalize incoming disaster events into a standard schema.

Required fields:

- `event_id`
- `event_type`
- `occurred_at`
- `affected_area`
- `source`
- `severity`
- `received_at`

### F03 — Evidence Store

Each external update is normalized into an Evidence object containing:

- Source
- Source type
- Published time
- Received time
- Relevant area
- Freshness
- Verification status
- Claim summary

### F04 — Situation State

Maintain a single current situation composed of:

```text
User State
+
Disaster State
+
Official Evidence
+
Mobility State
+
Current Plan
+
Uncertainties
+
Conflicts
```

### F05 — Action Plan

Each plan must be divided into:

- `NOW`
- `NEXT`
- `AVOID`

Each action contains:

- Action text
- Category
- Reason
- Evidence IDs
- Confidence class
- Risk class

### F06 — Why / Evidence

Users can inspect the evidence behind important recommendations.

The UI may show structured explanations, but must not expose private chain-of-thought.

### F07 — Plan Versioning

Plans must be versioned:

```text
Plan v1
Plan v2
Plan v3
```

Old plans must remain available for comparison and audit.

### F08 — Plan Expiration

Support:

- Time-based expiration
- Event-based invalidation

Expired plans must not remain displayed as current.

### F09 — Change Detection

Compare the previous situation with the new situation.

Possible classifications:

- `UNCHANGED`
- `MINOR_CHANGE`
- `PLAN_RELEVANT_CHANGE`
- `CRITICAL_CHANGE`

### F10 — Automatic Re-planning

When a plan becomes invalid:

1. Identify the invalidated dependency
2. Identify affected steps
3. Preserve unaffected steps
4. Request new data if needed
5. Generate a new candidate plan
6. Validate it through the Safety Core
7. Publish a new plan version
8. Explain the difference

### F11 — Mobility Evaluation

The Mobility Agent may determine:

- Route candidates
- Transport availability
- Service disruption

It must not equate route availability with disaster safety.

### F12 — Conflict Detection

When eligible sources disagree and recency does not resolve the conflict, mark the relevant state as conflicting.

Do not generate certainty from unresolved conflicting evidence.

### F13 — Unverified Information Handling

Unverified reports may be displayed but may not directly support high-risk actions.

Example:

> A social-media post claims a station has been completely closed.

72H may show:

> **Unverified information — not used to generate the current action plan.**

### F14 — Agent Trace

Store structured activity events such as:

- Evidence received
- Situation updated
- Plan evaluated
- Dependency invalidated
- Re-plan triggered
- Unverified source rejected

Do not store private chain-of-thought.

### F15 — Replay Mode

A deterministic earthquake scenario must be available for judges and demos.

Controls:

- Start
- Pause
- Resume
- Next event
- Reset
- Playback speed

### F16 — Offline Continuity Mode

72H must not assume network availability during a disaster.

When connectivity is lost:

- Preserve the last verified situation
- Preserve the last verified plan
- Mark live data as stale as TTLs expire
- Disable live-dependent actions
- Keep offline emergency information available
- Re-sync and re-evaluate after reconnection

See `OFFLINE_CONTINUITY.md`.

## 6. Main UI Routes

### `/`

Onboarding and demo setup.

### `/dashboard`

Primary emergency view:

- Active event
- Current status
- Current plan
- NOW / NEXT / AVOID
- Latest change
- Source count
- Network status

### `/plan`

Plan history and plan differences.

### `/sources`

Evidence, verification state, freshness, and conflicts.

### `/trace`

Agent activity timeline.

### `/demo`

Replay controls for deterministic judging and development.

## 7. State Machine

```text
IDLE
 ↓
EVENT_DETECTED
 ↓
ASSESSING
 ↓
PLAN_ACTIVE
 ↓
MONITORING
```

On a relevant change:

```text
MONITORING
 ↓
CHANGE_DETECTED
 ↓
PLAN_REVIEW
```

If the plan is invalid:

```text
PLAN_INVALIDATED
 ↓
REPLANNING
 ↓
PLAN_ACTIVE
```

If evidence is insufficient:

```text
WAITING_FOR_EVIDENCE
```

Connectivity introduces additional states described in `OFFLINE_CONTINUITY.md`.

## 8. MVP Non-Goals

v0.1 does not implement:

- Earthquake prediction
- Native iOS / Android apps
- Family location sharing
- SOS dispatch
- Medical diagnosis
- Building safety assessment
- Crowd-density prediction
- Full evacuation navigation
- Payments
- Production-scale authentication
- Full support for all disaster types

## 9. Definition of Done

The MVP is considered complete when it can reliably demonstrate:

```text
Situation
→
Change
→
Autonomous Evaluation
→
Plan Invalidation
→
Re-plan
→
Explain
```

The system must also degrade safely when network access is unavailable.
