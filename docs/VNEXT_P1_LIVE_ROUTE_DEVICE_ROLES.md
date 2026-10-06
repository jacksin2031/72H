# 72H vNext P1 — Live Data, Route Experience and Device-Role UI

> Status: SPECIFICATION ONLY — no implementation, merge, push or deployment is authorized by this document.
> Product principle: **Prepare on PC, act on mobile.**
> Safety principle: **Live data informs the Safety Core; neither API output nor Gemini may directly authorize high-risk movement.**

## 1. Objective

vNext P1 extends the Adaptive UI into a live-data and route-aware disaster experience while separating the roles of mobile and desktop.

The product must stop treating PC as a larger phone. During an evacuation, the mobile device is the action surface. PC is primarily for preparedness, overview, review, configuration, and handoff to mobile.

P1 therefore has four coordinated tracks:

1. Live official/open data integration.
2. Route candidate and route-safety presentation.
3. Consumer-grade mobile UI polish.
4. PC preparedness / status / mobile-handoff redesign.

## 2. Device roles

### 2.1 Mobile role — action surface

Mobile is the primary interface during and immediately after a disaster.

Mobile may present:

- current safe action;
- critical protective instructions;
- safety check;
- current / last-known device location;
- route and map only when movement is relevant;
- route change / invalidation;
- offline continuity;
- emergency power / survival UI;
- future SOS / Rescue Beacon.

Mobile presentation modes remain dynamic:

```text
TEXT_ONLY
TEXT_WITH_DETAILS
MAP_ASSISTED
SAFETY_CHECK
EMERGENCY_PROTECT
SURVIVAL
```

The interface must show only the components necessary to complete the current safe action.

### 2.2 PC role — preparedness and overview

PC is not an evacuation navigator.

Primary PC use cases:

- configure accommodation / intended destination;
- review travel plan;
- pre-download / verify offline pack availability;
- review emergency guidance;
- configure language and notification preferences;
- review current disaster status and official evidence;
- review plan history and invalidation;
- prepare Safety Check / location settings;
- hand off the current plan/settings to mobile;
- Judge / Demo Mode for Hackathon review.

PC presentation modes:

```text
PREPAREDNESS
STATUS_OVERVIEW
PLAN_REVIEW
EVIDENCE_REVIEW
MOBILE_HANDOFF
JUDGE_MODE
```

The PC UI must not present turn-by-turn evacuation guidance as its primary role.

## 3. Mobile handoff

Introduce a deliberate **Continue on mobile** flow.

Potential PC handoff surface:

```text
Continue on your phone
[ QR CODE ]

Current preparation:
✓ Accommodation saved
✓ Offline pack available
✓ Language selected
✓ Current plan ready
```

The handoff payload must be bounded and safe. It may transfer only non-secret state such as:

- scenario / session reference where appropriate;
- language;
- accommodation / destination reference;
- plan reference;
- offline-region identifier;
- user preferences that are safe to transfer.

Do not encode API keys, secrets, privileged tokens, raw private evidence, or uncontrolled free-form server state in the QR payload.

If cross-device synchronization is not implemented in P1, the QR may initially deep-link to the public app with a bounded import token or simply direct the user to the mobile app while preserving the architectural contract for later implementation.

## 4. Live source integration

P1 should remain free/open-source-first where practical.

### P1 source priority

**JMA**

- official earthquake / tsunami / weather / volcano information;
- typed normalization into evidence;
- deterministic freshness, authority, scope and severity mapping.

**GSI / MLIT geospatial hazard data**

- hazard overlays where licence and offline use permit;
- geography is not by itself proof of route safety.

**Municipality / Tokyo Open Data**

- shelters / designated emergency evacuation places / public facilities;
- nearest does not automatically mean safest or open.

**JARTIC / road restriction data**

- road closure / traffic restriction evidence where usage terms permit.

**Ekispert**

- transport route candidate source;
- existing integration remains candidate-generation only.

Optional later source:

**ODPT**

- public transport operating status if access and terms are confirmed suitable.

Do not make paid Safety tips or Google Maps/Routes a P1 dependency if equivalent MVP behavior can be achieved with free/open data.

## 5. Live data architecture

Required flow:

```text
Live Source
   ↓
Source Adapter
   ↓
Typed Evidence
   ↓
Authority + Freshness + Area Scope + Conflict
   ↓
Situation State
   ↓
Gemini / ADK bounded candidate reasoning
   ↓
Safety Core
   ↓
Plan / Action State
   ↓
Presentation Policy
   ↓
Adaptive UI
```

Forbidden shortcut:

```text
API → Gemini → user movement instruction
```

The Safety Core remains authoritative for high-risk movement and plan invalidation.

## 6. Route pipeline

P1 adds route visualization, but must preserve the distinction:

> **Route availability != route safety.**

A route source may propose a candidate. 72H must separately evaluate its dependencies.

Required pipeline:

```text
Ekispert / transport candidate
    ↓
station / segment normalization
    ↓
transport evidence
    + road evidence
    + hazard evidence
    + destination eligibility
    + freshness / conflict checks
    ↓
Mobility evaluation
    ↓
Safety Core
    ↓
RoutePresentationState
```

Proposed route presentation states:

```text
UNVERIFIED
CANDIDATE
AFFECTED
BLOCKED
VERIFIED_USABLE
EXPIRED
```

`VERIFIED_USABLE` must not be rendered as an absolute guarantee of safety. Preferred consumer wording should remain cautious, for example:

- "Current verified candidate"
- "Available based on the latest verified information"

Never use wording equivalent to "This route is safe" unless the underlying safety contract explicitly supports that claim, which P1 does not.

## 7. When Map appears

Map is action-driven, not permanently visible.

### Do not auto-show Map when

- NORMAL;
- MONITOR;
- simple PREPARE with no movement decision;
- SHELTER_IN_PLACE;
- EMERGENCY_PROTECT where immediate movement is not required;
- destination is not verified;
- only an unverified route candidate exists.

### Map may auto-show when

```text
current action requires movement
AND destination is eligible
AND a route candidate exists
AND Presentation Policy allows spatial guidance
```

Typical case:

```text
EVACUATE
+ verified reason to move
+ safer eligible destination
+ usable route candidate
→ MAP_ASSISTED
```

User-initiated map opening is allowed at lower severity, but must not change the Safety Core decision.

## 8. Mobile route experience

Example mobile state:

```text
Evacuate to XX shelter
650 m · approximately 9 min

[ MAP ]
You ● ─────→ Shelter ◎

Route status:
✓ destination verified
⚠ one segment still being checked

[View details]
[Other destinations]
```

If the route becomes invalid:

```text
Route updated
The next segment can no longer be verified.
Pause movement and check the new plan.

[View updated route]
```

A route-change event should not flood the user. Use the existing deterministic notification policy and aggregate repeated updates.

## 9. Mobile UI polish

Maintain dark-first design.

P1 visual polish should include:

- consistent spacing scale;
- consistent typography scale;
- icon system;
- dark surface hierarchy;
- semantic warning / critical colors;
- bottom sheet for details;
- notification toast / badge;
- skeleton and loading states;
- explicit stale / offline states;
- motion reduction in power-saving modes;
- clear press / focus states;
- accessible contrast;
- map appearing only as a meaningful state transition.

Consumer Mode must avoid internal engineering labels such as:

```text
L1
A3
ONLINE_VERIFIED
```

unless they materially help the user.

Preferred consumer language:

```text
Monitoring
Latest information verified 2 min ago
Reconnecting — verification pending
Offline — last verified 8 min ago
```

Judge Mode may retain raw internal states.

## 10. PC redesign

PC must become a **Preparedness Dashboard**, not an evacuation dashboard.

### 10.1 Normal PC home

Recommended structure:

```text
72H                                  Notifications / Language

Current situation
Monitoring
No verified instruction currently requires movement.

Preparedness
┌──────────────────┐  ┌──────────────────┐
│ Travel plan      │  │ Emergency setup  │
│ Plan v4          │  │ 4 / 5 ready      │
└──────────────────┘  └──────────────────┘

Offline readiness
Accommodation
Language
Safety Check preference

Continue on mobile   [QR]
```

### 10.2 Critical PC state

The PC may strongly communicate status but should still hand off action to mobile:

```text
Critical earthquake information

Current recommendation:
Protect yourself where you are.

For movement guidance and location-aware actions,
continue on your phone.

[ QR CODE ]
```

### 10.3 PC detail pages

PC is well suited to:

- Plan history;
- evidence timeline;
- source details;
- preparedness checklist;
- offline pack management;
- emergency guide;
- account/device preferences;
- Judge / Demo Mode.

## 11. Shared core, different presentation

Mobile and PC must use the same:

- evidence;
- Safety Core;
- plan state;
- plan history;
- authority/freshness/conflict rules;
- disaster severity projection;
- notification events.

They differ only in presentation policy and device role.

```text
Safety Core
   ↓
Current Action
   ↓
Device Presentation Policy
   ├─ Mobile → action-oriented adaptive UI
   └─ PC     → preparedness / overview / handoff UI
```

Do not fork safety logic by device.

## 12. Offline behavior

Mobile remains the primary offline action surface.

PC offline behavior may provide:

- last verified plan;
- cached evidence summary;
- preparedness information;
- emergency guide;
- QR/deep-link instructions where locally available.

PC must not claim live route status while offline.

Mobile offline behavior must preserve:

- last verified plan;
- last known location if consented;
- offline map pack if previously cached;
- evidence freshness / stale timestamps;
- local safety timers while execution remains available.

## 13. API failure behavior

Every live source integration must define:

- timeout;
- retry/backoff;
- TTL;
- parse failure;
- schema mismatch;
- stale state;
- conflict behavior;
- offline behavior;
- source-specific circuit breaker / degradation where appropriate.

No source failure may silently become a high-confidence movement recommendation.

## 14. P1 acceptance criteria

P1 is not complete until all of the following are satisfied:

1. At least one live official disaster source reaches the typed evidence pipeline.
2. Replay and Live mode are clearly separated in UI and data contracts.
3. Live source freshness and stale states are visible and deterministic.
4. Route candidate can be normalized and rendered on the mobile map.
5. Route availability is never mislabeled as route safety.
6. MONITOR remains text-first with Map hidden by default.
7. SHELTER_IN_PLACE remains text-first with Map hidden by default.
8. EVACUATE requires a verified reason and safer eligible destination before auto map assistance.
9. Destination and route states can invalidate the active plan.
10. Route change creates one bounded user-facing notification rather than repeated spam.
11. Mobile dark-first Consumer UI remains compact and adaptive.
12. PC no longer behaves as a scaled-up evacuation navigator.
13. PC shows preparedness/status/plan review and mobile handoff.
14. Judge Mode retains detailed evidence/replay/trace access.
15. Offline/reconnect contracts from P0 remain intact.
16. Existing Safety Core behavior does not regress.
17. Existing backend/frontend suites remain green and P1 adds targeted regression tests.
18. Desktop and mobile accessibility checks pass.
19. No new paid API dependency is introduced without explicit approval.
20. Production claims clearly distinguish live data, synthetic replay, cached data, and unsupported capabilities.

## 15. Recommended implementation sequence

```text
P1-A  Device-role presentation contracts
P1-B  Live JMA adapter + typed evidence
P1-C  Shelter / destination data adapter
P1-D  Route candidate normalization
P1-E  RoutePresentationState + Safety Core integration
P1-F  Mobile Map-assisted route UI
P1-G  Mobile visual polish
P1-H  PC Preparedness Dashboard
P1-I  Mobile handoff
P1-J  Offline/reconnect regression
P1-K  Full local + production acceptance
```

Do not implement Push / Rescue Beacon in the same release unless P1 is already stable. They are separate risk surfaces.

## 16. Release boundaries

P1 must preserve a rollback path to the current production baseline.

Before merge/deploy:

- backend tests pass;
- frontend tests pass;
- typecheck passes;
- production build passes;
- secret scan passes;
- mobile GUI acceptance passes;
- PC GUI acceptance passes;
- live-source failure injection passes;
- offline/reconnect acceptance passes;
- route-safety wording review passes;
- documentation and architecture diagram are updated.

## 17. Product rule

The final device-role rule is:

> **PC helps the user prepare, understand and hand off. Mobile helps the user act.**

And the route rule remains:

> **72H only shows spatial guidance when spatial information is necessary for the currently authorized safe action.**

## Mobile UI direction — Scene-based App UX (approved)

Status: **APPROVED by user on 2026-10-06 JST**.

The mobile product must no longer use a responsive-web/document layout. The approved direction is a **scene-based app experience** delivered by the existing web/PWA stack.

### Product rule

> **72H Mobile is an app experience delivered by the web stack, not a responsive website.**

The mobile viewport must show only the information required for the user's **current safe next action**. Do not stack all cards, maps, evidence, power controls, notifications and emergency guidance into a long scrolling page.

The presentation layer is driven by Safety Core output and deterministic UI policy. Gemini / ADK may propose or summarize, but must not directly decide whether a map, evacuation route, safety check, or emergency action is shown.

### Approved three-scene baseline

#### 1. NORMAL / MONITOR — minimal text-first scene

Purpose: calm, low-severity state.

Display:
- compact 72H header;
- current place;
- notification icon;
- one calm status indicator;
- one primary message only;
- optional small “details” affordance;
- bottom navigation: Home / Plan / More.

Do **not** show by default:
- map;
- route;
- disaster level card;
- saved-plan card;
- evidence list;
- location settings;
- power controls;
- offline-map status;
- notification history;
- replay controls;
- Agent Trace.

The home screen should visually feel mostly empty. Empty space is intentional and communicates that no complex action is currently required.

Preferred message structure:

```text
Current state
↓
One short instruction
↓
Optional details
```

Typography should remain calm. MONITOR must not use emergency-scale text.

#### 2. EVACUATE / MOVEMENT REQUIRED — map + route scene

The map appears only when spatial information is necessary for the currently authorized action.

Required gates:
- Safety Core authorizes movement;
- a destination is eligible and sufficiently verified;
- a route candidate exists;
- route state is explicitly represented;
- evidence is fresh enough for the action.

Scene layout:
- full-screen or near-full-screen map;
- current position;
- destination;
- route polyline;
- distance / estimated travel time where available;
- route-status label;
- compact draggable bottom sheet;
- one primary action.

Important safety rule:

> Route candidate ≠ safe route.

The UI must distinguish states such as:
- UNVERIFIED
- CANDIDATE
- AFFECTED
- BLOCKED
- VERIFIED_USABLE
- EXPIRED

Do not label a route “safe” merely because Ekispert or another routing provider returns it.

The map must be **mounted only when needed**. Hiding a live map with CSS while leaving WebGL/GPU rendering active is not acceptable for the power-saving design.

#### 3. EMERGENCY / SAFETY CHECK — full-screen takeover

Purpose: immediate protective action or personal safety confirmation.

This scene may temporarily replace normal navigation and secondary controls.

Examples:
- strong shaking protective instructions;
- “Are you safe?” safety check;
- explicit “I am safe” / “I need help” / “I cannot move” responses;
- emergency protection guidance.

No map is shown unless spatial guidance is actually necessary for the authorized action.

Silence / no response must remain:

```text
UNRESPONSIVE_UNKNOWN
```

and must never be presented as confirmed injury or danger.

### Scene architecture

Recommended mobile presentation structure:

```text
MobileAppShell
├── MonitorScene
├── PrepareScene
├── ShelterScene
├── MapRouteScene
├── SafetyCheckScene
├── EmergencyProtectScene
├── SurvivalScene
├── PlanScene
├── NotificationsScene
└── MoreScene
```

Safety Core + UI Policy determine the scene.

Example mapping:

```text
NORMAL / MONITOR
→ MonitorScene

PREPARE
→ PrepareScene

SHELTER_IN_PLACE
→ ShelterScene

EVACUATE
→ MapRouteScene

SAFETY_CHECK_REQUIRED
→ SafetyCheckScene

EMERGENCY_PROTECT
→ EmergencyProtectScene

SURVIVAL
→ SurvivalScene
```

### Navigation model

Mobile navigation must behave like an app, not a document website.

Use:
- fixed bottom navigation;
- bottom sheets;
- modal / full-screen scenes;
- notification screen;
- action sheets;
- scene transitions.

Avoid:
- long stacked section pages;
- permanent footer content;
- many independent cards on Home;
- putting settings inline with emergency actions;
- placing evidence/history permanently on Home.

### Dark-first visual system

The approved visual direction is dark-first.

Goals:
- lower luminance;
- reduced visual noise;
- potential OLED/AMOLED power savings;
- calmer emergency presentation;
- compatibility with Power / Survival modes.

Do not claim guaranteed battery savings on all devices: LCD power characteristics differ. Battery saving must also come from reduced map rendering, network activity, GPS frequency, refresh cadence and animation.

Power-mode visual behavior:

```text
NORMAL
→ dark theme, normal visual richness

CONSERVE
→ reduce animations / effects / refresh

EMERGENCY_POWER
→ remove noncritical surfaces, avoid map unless needed

SURVIVAL
→ near-black / pure-black minimal screen, no decorative effects
```

### Mobile-specific acceptance criteria

1. MONITOR renders without a map.
2. MONITOR shows one primary action/instruction only.
3. Home is not a long scrolling dashboard.
4. Details open in a sheet or secondary scene, not as permanently expanded cards.
5. EVACUATE can enter MapRouteScene only after deterministic movement authorization.
6. SHELTER_IN_PLACE must not show a movement map by default.
7. EMERGENCY_PROTECT can take over the whole screen.
8. Safety Check uses explicit large response actions.
9. Map unmounts when leaving MapRouteScene.
10. Notifications live behind the notification entry point, not permanently on Home.
11. Power controls live under More unless a power state itself becomes safety-relevant.
12. Evidence is available through “Why?” / details, not always visible.
13. Mobile bottom navigation remains fixed and thumb-reachable in normal scenes.
14. Critical scenes may intentionally suppress normal navigation.
15. Keyboard / screen-reader access remains valid for PWA/browser use.
16. Existing Safety Core behavior must not regress.
17. Existing offline / reconnect semantics must remain explicit.
18. NETWORK_RESTORED must not be presented as VERIFICATION_RESTORED.
19. Any map-assisted movement must expose route verification state and freshness.
20. Judge / Demo Mode may keep richer diagnostic surfaces, but Consumer Mobile must remain minimal.

### Desktop remains a different device role

This approved mobile design does **not** mean the PC version should imitate these scenes.

Device roles remain:

```text
Mobile
→ act, move, protect, confirm safety, use route, SOS

Desktop
→ prepare, review, understand, manage, hand off to mobile, judge/demo
```

The two clients share the same Safety Core and plan state, but use different presentation engines.

### Implementation note

The current Adaptive UI branch already demonstrates the correct direction for the NORMAL / MONITOR state. Future mobile work should evolve it toward the scene architecture above instead of adding more responsive-web cards to the existing page.

The next UI milestone should therefore be treated as a **mobile scene-system refactor**, not a CSS-only redesign.
