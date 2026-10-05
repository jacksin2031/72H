# 72H vNext Product Plan

> Status: P0 LOCAL IMPLEMENTATION AND VALIDATION COMPLETE on 2026-10-05 JST; not deployed.
> Local stable baseline: `772c264`.
> P0 module contracts: [VNEXT_P0_CONTRACTS.md](VNEXT_P0_CONTRACTS.md). The user subsequently approved local commit and Release Candidate preparation; see [VNEXT_RELEASE_CANDIDATE.md](VNEXT_RELEASE_CANDIDATE.md). Merge/push, deployment, billing and paid services remain separate gates.
> Results and remaining production boundaries: [VNEXT_VALIDATION.md](VNEXT_VALIDATION.md). The seven P0 modules in section 18 are implemented; section 14 lists candidate live sources, which are not activated by this local implementation.

## 1. Product direction

72H vNext evolves from a dashboard-heavy disaster demo into a **map-first, event-driven, survival-oriented disaster action system**.

The primary user questions are:

1. Where am I?
2. What is happening?
3. What should I do now?
4. Has my plan or route changed?
5. Can the phone keep helping me if the network or battery becomes limited?

Core principle: show the minimum information necessary for the next safe action.

## 2. Simplified Map-first UI

Replace the current information-dense dashboard with a map-first home screen.

Primary screen:

- current / last-known location
- accommodation or intended destination
- current plan state
- current disaster severity
- current approved/candidate route state
- one prominent `NOW` action
- expandable bottom sheet for `NEXT`, `AVOID`, reasons and evidence

Normal navigation should be reduced to:

- Home
- Plan
- More

Move engineering/debug surfaces such as Agent Trace and Replay controls into **Demo / Judge Mode**.

## 3. Map model

Default map should only show critical layers:

- current location
- accommodation
- current approved/candidate route
- critical hazard or disruption

Optional layers:

- shelters / safe locations
- stations
- hazard overlays
- disruptions
- evidence markers

Safety rule: **route availability is not proof of route safety**.

Transport route data must flow through Mobility evaluation and the deterministic Safety Core before being represented as a recommended route.

## 4. Offline Emergency Map

Add an **Emergency Offline Map Pack** instead of downloading all of Japan.

Suggested pack scope:

- current area
- accommodation area
- travel corridor
- nearby emergency area / POIs

Preferred technical direction for planning:

- MapLibre GL
- PMTiles or equivalent compact offline package
- OpenStreetMap-derived / appropriately licensed map data
- Service Worker + IndexedDB / Cache Storage

Offline mode must distinguish:

- map available
- live disaster status unavailable
- live transport status unavailable
- saved plan available but possibly stale
- last known location vs live location

Offline map availability must never be presented as proof that a route is currently safe.

## 5. Disaster Severity Engine

Introduce explicit disaster severity levels:

- `L0 NORMAL`
- `L1 INFO`
- `L2 CAUTION`
- `L3 SERIOUS`
- `L4 CRITICAL`

Severity is separate from user action state.

Action states:

- `NORMAL`
- `MONITOR`
- `PREPARE`
- `SHELTER_IN_PLACE`
- `EVACUATE`
- `EMERGENCY_PROTECT`

Important rules:

- Disaster detected != evacuate.
- Official warning != always move.
- Movement requires a verified reason and a safer destination.
- When uncertainty is high, prefer conservative protective action over unnecessary movement.
- Immediate user-reported fire or shaking may open preloaded general protective guidance. It does not promote the observation to official evidence, diagnose structural safety, or bypass Safety Core movement eligibility.

## 6. Source Authority

Proposed source authority classes:

- `A0 UNKNOWN`
- `A1 USER / SOCIAL`
- `A2 PARTNER`
- `A3 VERIFIED OFFICIAL`
- `A4 EMERGENCY AUTHORITY`

High-risk action-changing recommendations always require Safety Core eligible evidence; authority or an immediate user-reported local hazard alone cannot bypass the existing Agent Safety Contract.

Unverified social information must not directly authorize high-risk movement.

## 7. Notification Engine

Notifications must be event-driven rather than triggered by every data update.

Proposed notification classes:

- `INFO`
- `ATTENTION`
- `IMPORTANT`
- `CRITICAL`
- `SAFETY_CHECK`

Deterministic events may include:

- `PLAN_INVALIDATED`
- `PLAN_SUPERSEDED`
- `ROUTE_DEPENDENCY_CHANGED`
- `EVIDENCE_EXPIRED`
- `NETWORK_LOST`
- `NETWORK_RESTORED`
- `VERIFICATION_RESTORED`
- `CRITICAL_WARNING`
- `SAFETY_CHECK_REQUIRED`

Core rule: **No verified state change -> no action-changing notification.**

Add notification debounce, aggregation and deduplication so repeated transport updates do not flood the user.

A route-change notification should open directly to the affected map/plan state.

## 8. Life Protection Mode

When a verified, location-relevant critical event occurs and the user has opted in, 72H may start a safety check.

Suggested buttons:

- I am safe
- I need help
- I cannot move right now

Suggested safety states:

- `UNKNOWN`
- `CHECK_REQUIRED`
- `AWAITING_RESPONSE`
- `SAFE_CONFIRMED`
- `UNRESPONSIVE_UNKNOWN`
- `NEEDS_ASSISTANCE`
- `CANNOT_MOVE`

Critical rule: **silence is uncertainty, not proof of danger**.

No response must become `UNRESPONSIVE_UNKNOWN`, not `DANGER_CONFIRMED`.

Automatic escalation requires:

- verified critical event
- location relevance
- prior user consent
- repeated failed check-ins

## 9. Rescue Beacon Mode

If the user explicitly requests help, or an opted-in critical safety check remains unanswered after repeated escalation, activate a local Rescue Beacon mode.

Beacon goal: **maximum discoverability per unit of battery**, not continuous maximum volume.

Potential beacon burst:

- SOS-style audio pattern
- spoken help message where supported
- vibration
- high-contrast SOS screen
- flashlight only where platform support and policy allow

The beacon should be intermittent, not continuous.

Initial planning profiles (must be validated with real-device battery tests before production):

- battery > 50%: ~20 s ON / 2 min OFF
- battery 20–50%: ~15 s ON / 5 min OFF
- battery 10–20%: ~10 s ON / 10 min OFF
- battery < 10%: ~8 s ON / 20 min OFF

Charging state may allow a more frequent beacon.

Add an optional temporary **Rescuers Nearby Boost** when the user can hear rescuers nearby.

First release should use only local device alerts. Nearby BLE / mesh broadcasting is future work due to privacy, abuse and reliability concerns.

## 10. Power & Survival Engine

Battery becomes part of the safety state.

Inputs may include:

- battery level
- charging state
- network quality
- location freshness
- power mode
- beacon state

Proposed modes:

### NORMAL

Typical high battery state. Normal map, route, notification and refresh behaviour.

### CONSERVE

Reduce:

- GPS frequency
- map animation / refresh
- background sync
- low-value notifications
- non-critical AI/network calls

### EMERGENCY POWER

Preserve primarily:

- Safety Core
- current / last verified plan
- offline map
- critical notifications
- SOS
- periodic location checkpoint
- rescue beacon

### SURVIVAL MODE

At critically low battery, reduce UI to a minimal low-power screen containing only:

- current `NOW` action
- SOS state
- last verified time
- last known location
- battery state
- next beacon time

Use a dark/static UI and remove non-critical rendering/animation.

## 11. Emergency Power Reserve

Plan an application-level Emergency Reserve threshold (for example 15%).

This does not reserve battery at OS level. Instead, once the threshold is reached, 72H should stop non-life-safety work and preserve resources for:

- critical alerts
- safety check
- SOS
- last map / plan
- rescue beacon
- essential location checks

## 12. Battery-aware Location Strategy

Avoid continuous high-accuracy GPS.

Planning direction:

- NORMAL: movement-based or periodic location
- CONSERVE: lower frequency
- EMERGENCY POWER: sparse checkpoints
- SURVIVAL: location only on SOS, major plan change, beacon cycle or explicit user request

Prefer coarse positioning first; use short high-accuracy bursts only where safety value justifies the power cost.

Strictly distinguish:

- `LIVE_LOCATION`
- `LAST_KNOWN_LOCATION`
- `LOCATION_UNAVAILABLE`

## 13. Battery-aware Network and AI Strategy

Poor connectivity should reduce retries, not increase them.

Use exponential backoff rather than constant rapid retry.

Before any Gemini call:

1. process evidence deterministically
2. determine whether the update can affect the current plan
3. aggregate minor changes
4. only invoke Gemini when a meaningful candidate-plan decision is needed

This reduces network, token and device power usage.

## 14. API / Data Source Plan

Prefer free / open official sources where possible.

Priority candidates:

### P0

- JMA disaster XML / official disaster information
- Tokyo / municipality open shelter data
- GSI hazard map / geospatial hazard data
- Firebase Cloud Messaging / standards-based Web Push for notifications
- JARTIC open road information where permitted by its usage terms

### P1

- Ekispert MCP for route candidates (already integrated)
- ODPT for public-transport operating state if terms/access are suitable
- additional MLIT road restriction sources where a proper machine API and licence are available

### Avoid as P0 if paid alternatives are unnecessary

- paid Safety tips integration
- Google Places / Routes / Geocoding where equivalent free/open sources satisfy the MVP

## 15. Cost policy

Goal: use free APIs / open data for the new vNext data layer.

Existing Google Cloud runtime may still incur usage-based charges, but the design goal is to remain well below the existing budget alert under normal Hackathon judging traffic.

The user has received a USD 300 Google Cloud credit. This is treated as a cost buffer only; do not perform redemption, payment, billing-upgrade or other payment-related actions without explicit approval.

Cost principles:

- Cloud Run `min=0`, `max=1`
- bounded Gemini calls
- compact offline-map packs
- avoid paid APIs unless explicitly approved
- preserve free/open-source-first architecture
- keep the existing budget alert as a warning, not a spending target

## 16. PWA vs Native boundary

PWA can reasonably provide:

- map-first UI
- offline map/data
- Web Push
- safety check
- offline plan
- best-effort SOS / beacon while execution is available

Reliable life-safety background behaviour such as continuous OS-level timers, guaranteed background audio, vibration, flashlight control and long-running location/beacon services should be considered a **future native Android/iOS requirement**.

Do not claim PWA behaviour that the browser/OS cannot reliably guarantee.

## 17. Proposed vNext architecture

```text
Official disaster sources     Transport sources      Geo / shelter sources
          \                        |                        /
           +---------- Source Authority / Evidence --------+
                              |
                    Disaster Severity Engine
                              |
                       Situation State
                              |
                         Safety Core
                              |
                          Plan Engine
                              |
                    Notification Engine
                              |
                    Life Protection Engine
                              |
                      Map-first Experience

Power & Survival Engine is cross-cutting across:
Map / GPS / Network / Gemini / Notifications / Rescue Beacon / Offline Mode
```

## 18. Priority

### P0

- simplify UI / Map-first redesign
- offline emergency map
- disaster severity engine
- source authority policy
- notification engine
- power & survival engine
- life-protection safety check

### P1

- route-change notification
- shelter / safe-location selection
- Rescue Beacon mode
- battery-aware GPS/network policy
- hazard overlays
- transport-state integration

### P2

- offline region manager
- advanced map layers
- enhanced beacon features / flashlight where supported
- richer road/public-transport sources

### P3 / post-Hackathon

- native Android/iOS safety layer
- reliable native background Rescue Beacon
- BLE / nearby SOS mesh
- full offline routing/navigation

## 19. Safety contracts

1. No Source -> No High-Risk Action.
2. Disaster detected != evacuate.
3. Official warning != always move.
4. Movement requires a verified reason and a safer destination.
5. Route availability != route safety.
6. Silence is uncertainty, not proof of danger.
7. Battery is a safety resource.
8. Non-critical features must yield to life-safety functions.
9. Poor connectivity must reduce retries, not increase them.
10. Location precision is used only when safety value justifies power cost.
11. Critical safety functions should remain usable at the lowest practical power level.
12. Offline state must never fabricate current disaster, transport or route safety information.

## 20. Example critical-disaster behaviour

A representative flow:

```text
Verified critical disaster
-> severity/location assessment
-> immediate protective action if required
-> current travel plan invalidated where dependencies are no longer verified
-> safety check
-> official/transport/hazard evidence updates
-> stay / prepare / evacuate decision by Safety Core
-> map and route update
-> route-change notification if action changes
-> offline continuity if network fails
-> progressive power-saving as battery falls
-> repeated safety check if appropriate
-> UNRESPONSIVE_UNKNOWN if no response
-> intermittent Rescue Beacon if escalation policy is satisfied
-> lower beacon duty cycle as battery falls
-> temporary higher beacon rate if rescuers are nearby
```

## 21. Planning gate before implementation

Before coding any vNext feature, define:

- exact user problem
- UI flow
- data source and authority
- Safety Core impact
- offline behaviour
- stale/TTL behaviour
- battery behaviour
- notification behaviour
- failure/fallback state
- test cases
- acceptance criteria
- PWA/native limitation
- cost impact

The user explicitly authorized all P0 implementation and testing on 2026-10-05 JST. The scoped module contracts are recorded in `VNEXT_P0_CONTRACTS.md`. P1/P2/P3 and cloud release remain separate gates. Local tests and browser acceptance are recorded in `VNEXT_VALIDATION.md`; baseline production evidence must not be presented as validation of this branch.

The separately authorized map/profile configuration, Last Known Location
persistence, and generic area/severity architecture follow-up is defined in
`VNEXT_AREA_LOCATION.md`. Tokyo is retained as configured replay/map data rather
than as an application-wide assumption.
