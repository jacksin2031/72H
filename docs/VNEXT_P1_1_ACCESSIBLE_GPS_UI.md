# vNext P1.1 — Accessible Mobile + GPS-first UX

Status: **APPROVED FOR IMPLEMENTATION**

Date: 2026-10-08 JST

This document defines the next 72H mobile UX milestone after the accepted P1 and first-use polish release.

## Goal

Make 72H easy to use even for people who are unfamiliar with smartphones, including older users, while removing unnecessary manual location entry from the default flow.

The mobile product must remain:

- safety-first;
- deterministic at the decision boundary;
- simple enough to understand under stress;
- usable with large text and large touch targets;
- GPS-first, but never GPS-dependent for safety decisions;
- truthful about location freshness and accuracy;
- battery-aware;
- usable when location permission is denied or unavailable.

> **GPS tells 72H where the device is. GPS does not tell 72H whether movement is safe.**

## Product principle

> **One screen, one main task, one obvious primary action.**

The default consumer UI should avoid presenting multiple cards, diagnostics, source metadata, technical state labels, and settings at the same time.

Judge / Demo mode may retain detailed diagnostics.

---

# 1. First-run UX

The current first-use flow should be reduced further.

Default flow:

```text
Open 72H
↓
Explain why location is needed
↓
[現在地を確認]
↓
Browser / PWA location permission
↓
Location confirmed
↓
[72Hを始める]
```

Do not require the user to type:

- station name;
- district name;
- accommodation;
- party size;
- current safety state.

These become optional settings after entry into the app.

### First screen

Recommended Japanese copy:

```text
現在地を確認します

あなたのいる地域に合わせて
防災情報を表示します。

[ 現在地を確認 ]

位置情報について
```

The screen must clearly explain:

- location is used to match official information to the user's area;
- location permission can be denied;
- 72H does not infer route safety from GPS alone;
- background location is not guaranteed in a browser/PWA.

### Location success

```text
✓ 現在地を確認しました

東京都 渋谷区付近
精度：約 24 m
たった今確認

[ 72Hを始める ]
```

Do not expose raw coordinates by default.

### Location failure

```text
現在地を確認できません

[ もう一度試す ]

または

[ 地域を選ぶ ]
```

The fallback must not require free-text address entry.

---

# 2. GPS-first location architecture

Use the browser Geolocation API over HTTPS.

Recommended default behavior:

```text
App start
→ getCurrentPosition()

NORMAL
→ refresh only when needed / low frequency

MAP_ASSISTED
→ watchPosition()

CONSERVE
→ lower update frequency

EMERGENCY_POWER
→ only essential updates

SURVIVAL
→ last known location + explicit manual refresh
```

Do not keep high-frequency GPS running on every screen.

## DeviceLocation model

The presentation and persistence layer should distinguish:

```ts
DeviceLocation {
  lat: number
  lng: number
  accuracy_m: number | null
  observed_at: string

  source:
    | "GPS"
    | "LAST_KNOWN"
    | "USER_SELECTED"

  freshness:
    | "CURRENT"
    | "AGING"
    | "STALE"

  area_ids: string[]
}
```

If the existing contract uses different names, preserve compatibility at the adapter boundary rather than weakening the semantics.

## Freshness

The UI must distinguish:

```text
現在地
```

from:

```text
最後に確認した位置
8分前
```

Do not display old coordinates as if they were live.

Location age thresholds should be explicit and testable.

Suggested initial policy:

- CURRENT: <= 2 minutes
- AGING: > 2 minutes and <= 10 minutes
- STALE: > 10 minutes

These thresholds are a UX policy, not a safety authorization rule, and may be refined after real-device testing.

## Accuracy

Accuracy should be shown in plain language when useful.

Example:

```text
現在地を確認済み
約20mの精度
```

If accuracy is poor:

```text
位置の精度が低いため
現在地を再確認しています
```

Poor accuracy must not silently scope high-risk official evidence to a precise point.

---

# 3. Area resolution

Coordinates must be resolved into bounded area identifiers used by the existing evidence scoping model.

```text
GPS coordinates
↓
Area Resolver
↓
country / prefecture / municipality identifiers
↓
official-source scoping
```

GPS must never directly create:

- evacuation authorization;
- safe-route status;
- shelter suitability;
- official movement instructions.

Those remain downstream deterministic Safety Core decisions.

The resolver must fail closed. If municipality resolution is unavailable or uncertain, preserve only the area scope that can be supported.

Example:

```text
lat/lng known
prefecture confirmed
municipality uncertain

→ area_ids: ["JP-13", "JP"]
→ do not invent a municipality identifier
```

---

# 4. Senior-friendly visual system

The consumer mobile UI should be optimized for quick recognition.

## Typography

Recommended minimums:

- body: about 18 px;
- important status: 22–26 px;
- primary action: 24–32 px;
- emergency headline: 32 px or larger when appropriate.

Do not rely on tiny helper text for critical meaning.

Support browser / OS text scaling without breaking the viewport.

## Touch targets

Primary buttons should be at least approximately:

- 56 px high in normal scenes;
- 64–72 px high in urgent / emergency scenes when appropriate.

Avoid tightly packed adjacent targets.

## Icons

Icons must always be paired with text for safety-relevant actions.

Bad:

```text
⚠
```

Better:

```text
⚠ 強い揺れに注意
```

## Color

Never encode critical meaning through color alone.

Use:

- icon;
- explicit text;
- shape / hierarchy;
- color as supporting signal.

## Motion

Respect `prefers-reduced-motion`.

Reduce transitions automatically in:

- CONSERVE;
- EMERGENCY_POWER;
- SURVIVAL.

---

# 5. Mobile scene behavior

The existing scene-based mobile architecture remains the target.

## NORMAL / MONITOR

Keep the screen extremely simple.

Example:

```text
72H                    🔔

        ✓

今は移動する必要は
ありません

安全に注意しながら
最新情報を確認してください。

[ 最新情報を確認 ]

ホーム   計画   その他
```

Do not show by default:

- source diagnostics;
- evidence cards;
- route details;
- raw severity codes;
- GPS coordinates;
- plan internals;
- power diagnostics.

## PREPARE

Show:

- one clear preparation instruction;
- one main action;
- optional details.

Do not increase urgency merely because a technical severity code is elevated.

## SHELTER_IN_PLACE

Text-first.

No map by default.

The instruction must clearly explain that the user should not move unless new verified guidance changes the plan.

## MAP_ASSISTED

Map appears only when the currently authorized action requires movement.

Required gates remain unchanged:

- deterministic movement authorization;
- eligible destination;
- route candidate;
- route state;
- fresh enough evidence.

GPS supplies current position only.

Route candidate remains distinct from safe route.

## EMERGENCY_PROTECT

Full-screen takeover is allowed.

Example:

```text
まず身を守る

頭を守る
窓から離れる
今は移動しない
```

Navigation may be temporarily hidden.

## SAFETY_CHECK

Use large explicit response buttons.

Examples:

- 安全です
- 助けが必要
- 動けません

No response remains:

```text
UNRESPONSIVE_UNKNOWN
```

---

# 6. Reduce cognitive load

Consumer mobile screens should follow these rules:

1. one primary action per screen;
2. maximum one dominant message;
3. no technical status codes;
4. progressive disclosure for details;
5. no permanent source/evidence cards on Home;
6. no settings mixed into emergency actions;
7. no multi-column mobile forms;
8. no unnecessary manual typing;
9. no ambiguous icon-only controls;
10. no hidden safety meaning behind color alone.

---

# 7. Navigation

Normal mobile navigation remains:

```text
Home
Plan
More
```

The bottom nav must remain:

- fixed;
- thumb reachable;
- large enough for older users;
- text-labeled.

Critical scenes may suppress navigation when doing so reduces confusion.

Notifications remain behind the notification entry point.

---

# 8. Settings moved out of first-run

The following should move to More / preparedness settings unless needed later:

- accommodation;
- party size;
- accessibility needs;
- Safety Check consent;
- power preferences;
- theme;
- offline map readiness.

If information becomes necessary to complete a specific action, ask for it contextually at that moment.

---

# 9. Permission UX

Location permission must use a staged explanation.

Do not trigger the browser permission prompt immediately on page load.

Flow:

```text
Explain
↓
User taps "現在地を確認"
↓
Request permission
```

If denied:

- do not repeatedly reprompt;
- explain how to continue without GPS;
- offer bounded area selection;
- provide settings guidance only when useful.

If the browser reports permission denied, the UI should remain calm and actionable:

```text
位置情報を使用できません

地域を選んで続けることができます。

[ 地域を選ぶ ]
[ もう一度確認 ]
```

Do not frame refusal as an error by the user.

---

# 10. Privacy

Consumer UI must clearly communicate:

- location is used for local disaster relevance;
- exact coordinates are not public;
- public mobile handoff links must not contain location;
- session/location/evidence/plan data must not be embedded in shareable URLs;
- persisted Last Known Location follows the existing retention and forget controls.

Do not expand data retention merely because GPS is introduced.

The default design should prefer local persistence for current/last-known device location unless a server-side contract explicitly requires otherwise.

---

# 11. Offline and reconnect behavior

GPS state and network verification state are separate.

Examples:

```text
GPS current
network offline
→ current location may be known
→ official information may still be stale
→ do not claim verified safety
```

```text
network restored
GPS stale
→ official source may refresh
→ device location may still need re-confirmation
```

The existing rule remains:

> **NETWORK_RESTORED != VERIFICATION_RESTORED**

And similarly:

> **GPS_UPDATED != SAFETY_VERIFIED**

When offline:

- preserve last verified plan;
- preserve last known location with visible timestamp;
- preserve built-in emergency basics;
- preserve offline map where available;
- clearly mark stale/expired information.

---

# 12. Battery policy

Location is a safety resource and a battery cost.

The implementation must avoid continuous GPS when it is not useful.

Suggested behavior:

| Mode | Location behavior |
|---|---|
| NORMAL | One-shot at start; low-frequency or event-based refresh |
| PREPARE | Refresh when location relevance materially changes |
| MAP_ASSISTED | `watchPosition()` while map guidance is active |
| CONSERVE | Reduced update frequency |
| EMERGENCY_POWER | Essential location updates only |
| SURVIVAL | Last known location; explicit refresh where necessary |

Leaving MAP_ASSISTED must stop active location watching.

The acceptance suite should prove this cleanup.

---

# 13. Accessibility requirements

P1.1 must target practical accessibility rather than visual compliance alone.

Required:

- semantic headings;
- explicit button labels;
- focus-visible styles;
- sufficient contrast;
- screen-reader-friendly labels;
- keyboard operation for browser use;
- large touch targets;
- no hover-only information;
- support `prefers-reduced-motion`;
- no critical information encoded only as color;
- layout must survive 200% text scaling without losing primary actions;
- Japanese, English and Traditional Chinese strings must remain understandable at large font sizes.

Where practical, verify against WCAG 2.2 AA criteria relevant to the implemented controls.

---

# 14. PC behavior

PC remains a different device role.

The GPS-first onboarding is primarily a mobile behavior.

PC continues to focus on:

- preparedness;
- status review;
- plan review;
- evidence/source review;
- settings;
- mobile handoff;
- Judge / Demo.

PC should not become the primary evacuation navigation interface.

If PC geolocation is available, it may be offered as an optional convenience for preparedness, but it must not change the device-role principle.

---

# 15. Safety invariants

The following invariants are non-negotiable:

1. GPS position never authorizes evacuation.
2. GPS accuracy never proves route safety.
3. A route provider response never proves route safety.
4. A shelter listing never proves the shelter is open or suitable.
5. Disaster detected does not automatically mean evacuate.
6. L4 / CRITICAL does not automatically mean evacuate.
7. Silence does not mean danger.
8. Stale official evidence cannot authorize new high-risk movement.
9. Map visibility follows authorized spatial need, not severity alone.
10. Last Known Location must never be displayed as live/current without an explicit freshness label.
11. Location permission denial must not make emergency basics inaccessible.
12. Background GPS must not be claimed as reliable in a PWA.

---

# 16. Proposed implementation components

Suggested frontend structure:

```text
apps/web/
├── components/
│   ├── location-permission-scene.tsx
│   ├── location-confirmed-scene.tsx
│   ├── area-fallback-scene.tsx
│   ├── senior-home.tsx
│   └── ...
├── lib/
│   ├── device-location.ts
│   ├── location-freshness.ts
│   ├── area-resolution.ts
│   ├── accessible-ui-policy.ts
│   └── ...
```

Names are illustrative; existing architecture may be reused where cleaner.

Core separation:

```text
Geolocation Adapter
↓
Device Location State
↓
Area Resolver
↓
Live Evidence Scope
↓
Safety Core
↓
Presentation Policy
↓
Mobile Scene
```

Do not allow the geolocation adapter to bypass the Safety Core.

---

# 17. Tests

At minimum, add deterministic tests for:

### Permission

- permission granted;
- permission denied;
- permission unavailable;
- permission prompt error;
- repeated denial does not create a prompt loop.

### Location

- GPS current;
- GPS aging;
- GPS stale;
- poor accuracy;
- Last Known Location restoration;
- Last Known Location expiry;
- manual bounded area fallback.

### Area resolution

- Tokyo coordinate -> supported Tokyo area IDs;
- Osaka coordinate -> supported Osaka area IDs;
- coordinate outside supported resolver scope;
- resolver failure;
- ambiguous municipality fallback.

### UI

- first-run requires no typing;
- one primary action visible;
- 200% text scaling;
- large touch target size;
- no horizontal overflow at common mobile widths;
- reduced-motion mode;
- screen-reader labels;
- keyboard fallback.

### Map

- map does not mount in MONITOR;
- map does not mount in SHELTER_IN_PLACE;
- map mounts only after authorized movement;
- leaving route scene stops `watchPosition()`;
- stale route state removes or downgrades movement UI correctly.

### Offline

- cached Home remains usable;
- Last Known Location timestamp visible;
- reconnect does not imply verification restored;
- GPS refresh does not imply evidence verified.

---

# 18. Real-device acceptance

P1.1 should add real-device checks because GPS behavior cannot be fully established through desktop browser emulation.

Recommended acceptance devices:

- at least one recent Android phone;
- at least one iPhone if available.

Check:

- permission prompt;
- first-fix time;
- approximate accuracy;
- denied permission recovery;
- returning from Settings;
- foreground/background transitions;
- lock/unlock;
- route-scene location watching;
- battery impact over a short controlled session;
- large system text;
- outdoor readability;
- one-handed operation.

Do not claim reliable background GPS until measured on real devices.

---

# 19. Acceptance criteria

P1.1 is accepted when all of the following are true:

1. First-run mobile flow does not require manual text location input.
2. Location permission is requested only after explicit user action.
3. Permission denial has a usable non-GPS fallback.
4. GPS position includes timestamp and accuracy.
5. UI distinguishes current location from last known location.
6. Area IDs are resolved without inventing unsupported precision.
7. GPS alone cannot produce evacuation authorization.
8. NORMAL Home remains minimal and senior-friendly.
9. Primary consumer body text is readable at the approved minimum size.
10. Main touch targets meet the approved size target.
11. Critical icons are paired with text.
12. Color is never the only safety signal.
13. 200% text scaling preserves the primary action.
14. MONITOR does not mount the map.
15. SHELTER_IN_PLACE does not mount the map by default.
16. MAP_ASSISTED starts location watching only when required.
17. Leaving MAP_ASSISTED stops location watching.
18. Power modes reduce location cost appropriately.
19. Offline mode truthfully displays saved-location age.
20. NETWORK_RESTORED still does not mean VERIFICATION_RESTORED.
21. GPS_UPDATED does not mean SAFETY_VERIFIED.
22. Public handoff URLs contain no location/session/evidence/plan payload.
23. Existing Safety Core tests remain green.
24. Existing live-source stale behavior remains fail-closed.
25. Mobile / desktop / offline / reconnect regression gates remain green.
26. No regression to current P1 production safety semantics.

---

# 20. Non-goals

P1.1 does not promise:

- reliable continuous background GPS in a PWA;
- nationwide offline navigation;
- native background location services;
- automatic SOS;
- BLE mesh;
- route safety based on GPS;
- automatic shelter suitability;
- automatic evacuation based only on proximity.

Those require separate reviewed milestones.

---

# 21. Release strategy

Implement P1.1 on a dedicated branch/worktree.

Before production:

```text
unit tests
↓
frontend tests
↓
backend regression
↓
typecheck
↓
production build
↓
secret / diff gate
↓
mobile browser acceptance
↓
desktop regression
↓
offline / reconnect
↓
real-device GPS acceptance
↓
production preview
↓
traffic promotion
```

The current accepted P1 revision must remain available for rollback.

Do not change billing, project budget, IAM, secrets, or payment-related configuration as part of this UI/GPS milestone unless separately authorized.

---

# 22. Final product direction

72H Mobile should feel like a dedicated emergency app rather than a responsive website.

The target experience is:

> **Open the app → confirm location → immediately understand the next safe action.**

For older or less technical users, the interface should require as little interpretation as possible:

> **Large text. Large buttons. Few choices. No technical jargon. No unnecessary typing.**

The Safety Core remains stricter than the visual layer:

> **A simpler UI must never mean a weaker safety contract.**
