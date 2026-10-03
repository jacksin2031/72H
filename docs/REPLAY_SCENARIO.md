# 72H Replay Scenario Specification v0.1

## Scenario

**Name:** Tokyo Earthquake Replay  
**Duration:** Approximately 3 minutes  
**Primary user:** First-time foreign visitor in Tokyo  
**Current location:** Shibuya  
**Accommodation:** Asakusa  
**Original plan:** Return to accommodation at 18:00

## Demo Goal

The replay must prove that 72H can:

1. Receive a disaster event
2. Build a current situation state
3. Generate an evidence-backed action plan
4. Detect a relevant situation change
5. Invalidate an outdated plan
6. Re-plan automatically
7. Reject unverified information
8. Survive temporary network loss
9. Re-sync and re-evaluate after reconnection
10. Expose a structured agent trace

## Initial State — 17:40

```text
Location: Shibuya
Accommodation: Asakusa
Language: Traditional Chinese
Safety status: Safe
Original plan: Return to Asakusa at 18:00
Network: Online
```

Dashboard:

```text
72H

No active emergency

Current Plan
18:00 Return to Asakusa

Status
● Normal
```

## T+00 — Earthquake Event

Time: **17:42**

Replay injects a verified earthquake event from JMA.

Expected transition:

```text
IDLE
→ EVENT_DETECTED
→ ASSESSING
```

UI:

```text
⚠ EARTHQUAKE
Tokyo
17:42

Assessing situation...
```

## T+15 — First Official Evidence

A verified official update is ingested.

Expected result: **Plan v1**

### NOW

- Stay in the current safe location
- Monitor verified official updates
- Do not begin the original return trip yet

### NEXT

- Re-check transport conditions
- Re-evaluate the return plan when conditions become clearer

### AVOID

- Do not rely on the pre-earthquake itinerary without re-checking

Plan metadata:

```text
Status: ACTIVE
Created: 17:43
Valid until: 17:58
or until new relevant evidence arrives
```

## T+35 — User Opens “Why?”

The user inspects the reason behind delaying the original trip.

The UI shows:

- Source
- Published time
- Evidence summary
- Structured reason
- Confidence class

The UI must not expose private chain-of-thought.

## T+55 — Transport Conditions Change

Time: **17:47**

A verified transport update indicates disruption affecting the original route.

Expected classification:

```text
PLAN_RELEVANT_CHANGE
```

## T+65 — Plan Evaluation

72H evaluates Plan v1 dependencies.

Expected result:

```text
PLAN v1 INVALIDATED
```

UI:

> Your action plan needs to be updated because the transport assumptions used by the previous plan have changed.

## T+75 — Autonomous Re-plan

The Mobility Agent evaluates currently available transport candidates.

The Action Agent generates **Plan v2**.

### NOW

- Continue staying in the current safe location
- Do not begin the original route
- Continue monitoring verified official and transport updates

### NEXT

- Wait for a newly verified transport option
- Re-evaluate before moving

### AVOID

- Do not treat a route-search result as proof that the route is safe during a disaster

The UI displays the plan diff:

```text
Plan v1 → Plan v2

UNCHANGED
✓ Stay in the current safe location

CHANGED
OLD: Return after transport confirmation
NEW: Pause the return plan and wait for updated verified transport information
```

## T+100 — Unverified Social-Media Report

Replay injects:

> “Shinjuku Station is completely closed! Leave this area immediately!”

Source classification:

```text
UNVERIFIED
```

Expected behavior:

- Show the report as unverified
- Do not use it as evidence for a high-risk action
- Add a trace entry indicating exclusion from action evidence

## T+120 — Network Degrades

Network state changes:

```text
ONLINE_VERIFIED
→ ONLINE_DEGRADED
```

The system remains online but marks increased uncertainty around live freshness.

## T+135 — Network Lost

Network state changes:

```text
ONLINE_DEGRADED
→ OFFLINE_RECENT
```

Expected behavior:

- Enter Continuity Mode
- Preserve the latest verified plan locally
- Keep source snapshots available
- Show the age of each cached source
- Stop pretending live information can still be fetched

UI:

```text
⚠ Continuity Mode
Network connection lost

Last verified plan: Plan v2
Last verified update: 17:48

Live transport verification is currently unavailable.
```

## T+150 — Local Safety Degradation

Transport evidence exceeds its local TTL.

Expected behavior:

- Mark transport evidence `STALE`
- Downgrade or invalidate actions depending on live transport status
- Do not use stale transport evidence to support a new high-risk action

The last verified plan remains visible, but live-dependent actions are visibly degraded.

## T+165 — Network Restored

Network state changes:

```text
OFFLINE_STALE
→ RECONNECTING
→ ONLINE_VERIFIED
```

Expected sequence:

1. Reconnect
2. Fetch new verified evidence
3. Reconcile cached state
4. Re-run dependency evaluation
5. Generate a new plan if needed

## T+175 — Plan v3

A newly verified transport update becomes available.

72H creates **Plan v3** after safety validation.

The final dashboard displays:

- Active disaster
- Current plan version
- Current network state
- Verified source count
- Unverified source count
- Plan history
- Latest plan change

## Final Demo Message

```text
72H
From Alert to Action.

When the situation changes, your plan should change too.
```

## Replay Controls

The `/demo` route must provide:

- Start
- Pause
- Resume
- Next event
- Reset
- 1× / 2× / 4× speed

## Determinism Requirements

The following outcomes must be deterministic for the same scenario:

- Event order
- Source trust classification
- Evidence freshness transitions
- Plan invalidation
- Network-state transitions
- Re-plan trigger
- Unverified-source rejection
- Plan version number

LLMs may vary wording, but they must not alter the core state transition.

## Demo Success Criteria

A successful replay visibly demonstrates:

- Earthquake detected
- Verified evidence received
- Plan v1 generated
- Transport change detected
- Plan invalidated
- Plan v2 generated
- Unverified social-media report rejected
- Network degraded
- Continuity Mode activated
- Evidence becomes stale offline
- Network restored
- State re-synchronized
- Plan v3 generated
- Complete structured trace available
