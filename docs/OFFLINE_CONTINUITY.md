# 72H Offline Continuity Specification v0.1

## Authorized P1 spatial extension

LIVE and synthetic Replay snapshots use separate validated cache stores.
Local expiry or loss of spatial support must suppress the corresponding HIGH
evacuation action in every device view, including text-only plan review; removing
the map alone is insufficient. Immutable server plan history is retained.

For the authorized P1 spatial contract, directive proof must cover the origin,
destination proof its designated target area, and road proof both origin and
destination. A destination can be in another catalog area: its typed proof is
not required to assert conditions at the user's current location. This exception
does not let accommodation coordinates, facility designation or generic evidence
establish movement permission. Current trust, exact claims and complete scoped
proofs remain necessary.

Spatial reconnect remains conservative: all required official proofs must be
current and published/received within the reconnect window, with newly checked
destination/route projections and current source retrieval. A new JMA retrieval
alone does not revalidate every movement dependency. Source-specific revalidation
attestations for unchanged publications are not implemented; cached HIGH actions
remain unavailable until sufficient new proof is supplied. Publication TTL never
renews on retrieval. Production movement-source allowlists remain empty.

## Authorized area / location extension

Offline snapshots now retain a validated canonical area catalog and explicit
profile/evidence area IDs. Legacy snapshots without these fields remain readable
but cannot establish regional severity, medium-risk action eligibility or
reconnection proof. New relevant official/partner evidence must match the current
profile's declared catalog ancestry. Labels, coordinates and accommodation-only
evidence never bypass this gate.

Installed map packs are selected through local catalog bounds and verified
byte/hash metadata. No coverage means an explicit unsupported state, with profile
text and offline guidance retained. An opt-in local Last Known Location keeps
only the latest browser point/accuracy/capture time. Offline, restored or aged
points are visibly last known, never silently refreshed; power-mode map removal
does not erase that point. See [VNEXT_AREA_LOCATION.md](VNEXT_AREA_LOCATION.md)
for consent, retention, denial and deletion behavior.

## 1. Purpose

Disasters may degrade or interrupt mobile and internet connectivity. 72H must therefore remain useful even when cloud services, transport APIs, or real-time disaster feeds are temporarily unavailable.

Design principle:

> **Cloud-powered, offline-survivable.**

The offline system does not attempt to reproduce the full cloud AI stack locally. Instead, it preserves the latest trustworthy state, applies deterministic safety rules locally, and clearly communicates what is no longer known.

## 2. Connectivity States

72H uses the following connectivity state machine:

```text
ONLINE_VERIFIED
       ↓
ONLINE_DEGRADED
       ↓
OFFLINE_RECENT
       ↓
OFFLINE_STALE
       ↓
RECONNECTING
       ↓
ONLINE_VERIFIED
```

### ONLINE_VERIFIED

- Cloud and required APIs are reachable
- Latest evidence can be refreshed
- Agent planning operates normally

### ONLINE_DEGRADED

- Connectivity is unstable or latency is excessive
- Some sources may fail intermittently
- The UI displays degraded confidence in freshness

### OFFLINE_RECENT

- Network unavailable
- Recently verified local state still exists
- Last Verified Plan remains visible

### OFFLINE_STALE

- Network remains unavailable
- One or more cached evidence items have exceeded TTL
- Live-dependent actions are downgraded or invalidated

### RECONNECTING

- Connectivity has returned
- Local and remote state are being reconciled
- The previous plan is not automatically assumed current until re-evaluation completes

## 3. Last Verified Plan

Every successful online plan is persisted locally as a Last Verified Plan.

Required fields:

- Plan version
- Created time
- Last verification time
- Evidence IDs
- Action list
- Expiration time
- Network state at creation

Example UI:

```text
LAST VERIFIED PLAN

Plan v2
Generated: 17:48
Last verified: 17:48
Network: OFFLINE
Age: 9 min
```

The system must not silently present cached content as live information.

## 4. Offline Emergency Pack

The app preloads a compact emergency pack while online.

The v0.1 pack contains:

- Basic official earthquake guidance
- Basic tsunami guidance placeholder
- Basic fire guidance placeholder
- Emergency communication phrases
- User accommodation address
- User emergency notes
- Latest verified situation snapshot
- Latest verified plan
- Evidence snapshots used by the current plan
- Disaster-message service guidance such as 171 usage instructions

The emergency pack must be readable without cloud connectivity.

## 5. Local Storage

Recommended browser-side persistence:

- Service Worker for application shell and static emergency assets
- IndexedDB for structured situation, evidence, plans, and trace events
- Cache Storage for static offline content

Critical local objects:

```text
local_user_profile
local_situation_snapshot
local_evidence_snapshots
local_current_plan
local_plan_history
local_trace
local_emergency_pack
local_network_state
```

## 6. Local Safety Core

The following checks must run locally and must not require Gemini:

- Evidence TTL evaluation
- Plan expiration
- Network-state evaluation
- Source verification state lookup
- Dependency invalidation
- Whether an action depends on stale live data
- Whether a cached plan may still be shown as current

Example:

```text
IF network == OFFLINE
AND transport_evidence_age > transport_ttl
THEN
    mark transport evidence STALE
    invalidate transport-dependent actions
```

## 7. Offline Behavior

### What remains available

- Last Verified Plan
- Plan history
- Cached evidence and timestamps
- Offline Emergency Pack
- Personal emergency details
- Accommodation address
- Emergency phrases
- Structured trace already stored locally

### What becomes unavailable

- New Gemini planning
- Live JMA updates
- Live transport search
- Live partner API results
- Live cloud synchronization

The UI must explicitly distinguish these states.

## 8. Safe Degradation Rules

When data becomes stale, 72H becomes more conservative.

Example:

A previous plan contains:

> Re-check the Ginza Line and travel if service is available.

If the network is lost and transport evidence becomes stale:

```text
PLAN DEGRADED

Reason:
Real-time transport verification is unavailable.
```

The updated local guidance may become:

> The latest transport status cannot currently be verified. Do not rely on the previous live transport result.

The system must never fabricate current availability.

## 9. Offline Freshness Policy

Suggested initial TTLs:

```text
transport_status: 5 minutes
official_disaster_update: 15 minutes
user_self_report: 10 minutes
static_official_guidance: versioned, no short TTL
```

TTL values must be configurable.

## 10. Manual Situation Input

If the device is offline before 72H receives the latest disaster event, the system cannot know the real-time external state.

The app may allow limited manual input such as:

- Strong shaking just ended
- Phone emergency alert received
- People around me are evacuating
- I am unsure what happened

Manual observations must be labeled as user-reported information and must not be treated as official evidence.

The offline system may then display only preloaded official general guidance plus clearly marked user-state information.

## 11. Reconnection Flow

When connectivity returns:

```text
Network restored
↓
RECONNECTING
↓
Fetch current official evidence
↓
Fetch current transport state
↓
Compare with cached situation
↓
Update freshness and trust
↓
Re-evaluate plan dependencies
↓
Generate new candidate plan if required
↓
Safety validation
↓
ONLINE_VERIFIED
```

The system must not automatically restore the old plan to current status merely because the network has returned.

## 12. Sync Conflict Handling

If local and remote states differ after reconnection:

- Preserve the local trace
- Prefer newer verified evidence
- Mark unresolved conflicts explicitly
- Never delete the previous Last Verified Plan until a new plan has passed safety validation

## 13. UI Requirements

The dashboard must always display connectivity status during an active event.

Examples:

```text
● Online — verified 2 min ago
```

```text
◐ Network degraded — some live sources unavailable
```

```text
○ Continuity Mode — last verified update 11 min ago
```

```text
⚠ Offline — live transport information is stale
```

## 14. PWA Requirements

Minimum v0.1 PWA behavior:

- Application shell available after initial successful load
- Dashboard can reopen offline
- Current plan and source snapshots remain readable
- Offline emergency content remains readable
- Local safety TTL processing continues while the app is open

Optional post-MVP work:

- Background sync
- Push notifications
- Native wrapper
- More sophisticated offline route maps

## 15. Demo Requirements

The replay scenario must include:

1. Online verified state
2. Network degradation
3. Full network loss
4. Continuity Mode
5. Transport evidence aging into STALE
6. Safe plan degradation
7. Network reconnection
8. Evidence refresh
9. Plan re-evaluation

## 16. Acceptance Tests

### O-01 — App Shell Offline

After first successful online load, disconnect network and reload.

Expected: core dashboard shell opens.

### O-02 — Last Verified Plan

Disconnect after Plan v2 is verified.

Expected: Plan v2 remains visible with offline and age labels.

### O-03 — Transport TTL Expiration

Keep network offline until cached transport evidence expires.

Expected: transport evidence becomes `STALE` and dependent actions are downgraded or invalidated.

### O-04 — No Fabrication

While offline, request latest transport status.

Expected: system states that current status cannot be verified.

### O-05 — Reconnect

Restore connectivity.

Expected: `RECONNECTING` → refresh → re-evaluate → `ONLINE_VERIFIED`.

### O-06 — Old Plan Protection

Reconnect with newly conflicting evidence.

Expected: old plan is not silently restored as current.

## 17. Definition of Done

Offline Continuity is complete when 72H can truthfully answer all three questions during a network outage:

1. What was the last verified situation?
2. Which parts of the last plan are still usable?
3. What information can no longer be trusted as current?

The system must remain useful without pretending it still has live knowledge.
