# vNext P0 module contracts

Scope approved by the user on 2026-10-05 JST: implement all P0 features and test.
This supersedes the planning-only implementation gate for P0 only. Cloud release,
commit/push, billing, paid APIs, P1/P2/P3 and native background services remain
separate. The existing Agent Safety Contract retains authority over action safety.

The user subsequently approved local commit and Release Candidate preparation.
That supersedes the initial commit gate only; current candidate boundaries and
source identity are recorded in `VNEXT_RELEASE_CANDIDATE.md`.

The subsequently authorized map/profile, Last Known Location and generic area
follow-up extends these P0 contracts as recorded in `VNEXT_AREA_LOCATION.md`.
Hardcoded UI reference coordinates and city-based severity consumers are replaced
by configuration and explicit catalog IDs; the installed Tokyo map pack remains
bounded configuration data.

## Integration boundary

Keep Cloud Run, Gemini/ADK, the validated replay pipeline, immutable plan history,
server source registry, and local continuity checks. vNext adds deterministic
read projections and local consent/check-in state. It cannot publish a plan,
promote untrusted evidence, or authorize high-risk movement. Existing deployment
claims describe the baseline, not this un-deployed branch.

## P0 acceptance contracts

| Module | Inputs and behavior | Failure/offline/power contract | Acceptance |
|---|---|---|---|
| Home | Map first; Home / Plan / More; one valid NOW; NEXT / AVOID / reasons expandable; trace/replay in Demo/Judge | Old plan status and timestamps always visible; blocked/expired actions never shown as executable NOW | Desktop/mobile map and navigable plan/evidence; no timeline-index rendering |
| Offline map | Bounded central-Tokyo OpenStreetMap road extract, MapLibre GL; synthetic Shibuya/accommodation reference pins | App-owned vector asset + SW precache; explicit extent, capture time, license and missing live disaster/transport state; WebGL/storage failure has readable fallback; no route invented | Validated manifest/hash/extent; offline reload shows roads after successful first cache; out-of-pack location explicitly unsupported |
| Severity | L0-L4 only from eligible location-relevant official typed severity claims; ACTIVE without severity means L1 information; missing => UNKNOWN; newest equal-time contradictions => CONFLICT | TTL/reconnect gates retained. Severity does not authorize evacuation; synthetic severity remains visibly synthetic | Fresh/stale/conflicting/social/partner/unrelated/future inputs and no auto movement tests |
| Authority | A0 unknown; A1 user/social; A2 verified partner; A3 verified official; A4 reserved | No A4 merely from source name, text, or model output; authority alone never sufficient for eligibility | Existing server claim scope and Safety Core regression tests; projection tests |
| Notifications | Plan/dependency/freshness/network/verification/critical transitions create bounded in-app events; stable IDs, dedup and aggregation; links to affected view | No notification on arbitrary data update; reconnect != verification restored; stale/social evidence cannot issue critical warning. No guaranteed OS background delivery | Transition, duplicate, non-actionable and expiry tests; GUI event list |
| Power | <=30% CONSERVE; <=15% EMERGENCY_POWER; <=5% SURVIVAL; unsupported battery => unknown + manual stricter mode | Reduce rendering/polling; stop non-critical network in emergency; local TTL/check-in continues while open; charging cannot override critical threshold; no OS reserve claim | Boundary/invalid/unknown/override tests; minimal survival screen with NOW/time/location/check-in |
| Safety check | Prior consent + fresh location-relevant L4 starts check-in; Safe / Need help / Cannot move | 60s open-app deadline, max3 attempts; silence => UNRESPONSIVE_UNKNOWN; response stable for incident; opt-out cancels. Local persistence validates schema; no dispatch/beacon | Consent, relevance, stale, repeat, timeout, response, reload and revocation tests |

## Data and source policy

The map database extract is licensed ODbL-1.0 and attributed to OpenStreetMap
contributors. It is geography, never hazard/route-safety evidence. Runtime does
not call public OSM/Overpass APIs. `scripts/build_offline_map.py` is an explicit
bounded maintainer refresh command; it records timestamp, query, bytes and hash.
Unsupported areas cannot acquire a map pack automatically in this P0.

The existing official synthetic registry may accept `disaster.tokyo.severity`
with values L0-L4 for replay. This changes event payload input, never hardcodes a
plan at a replay index. The demo's official earthquake update can include L4 to
exercise critical checking; it must retain the synthetic banner.

Immediate user-reported fire/shaking can open preloaded general protective
guidance, but is not an exception to No Source -> No High-Risk Action. Movement
still requires server Safety Core eligibility and a verified safer destination.

PWA limits: all local timers and alerts are best effort while app execution is
available. Battery API availability differs by browser; no background guarantee,
precise GPS history, automatic emergency dispatch, new paid API, or live JMA feed
is introduced. Location request is explicit foreground-only and optional; reference
pins are synthetic and never mislabeled as GPS.

## Validation and cost

Run existing backend suites, frontend policy/offline boundary tests, real API
snapshot parsing, typecheck, production build, secret/whitespace checks and GUI
desktop/mobile/offline acceptance. Test artifacts identify this branch and run.
No credentialed model calls are required for local testing; the Gemini/ADK path
is retained. No cloud/billing changes. Dependencies/pack add bounded static bytes.
Real-device battery endurance and background notifications are not production
acceptance claims.
