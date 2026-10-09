# vNext P1.2 — Simplified More & Senior-Friendly Navigation

**Status:** LOCALLY IMPLEMENTED AND ACCEPTED — NOT DEPLOYED

Local implementation: `codex/vnext-p1-2-simplified-more`, source baseline
`7747b2b`, workspace `C:\Users\jacks\.codex\worktrees\a353\72H`.
See [local validation and remaining release gates](VNEXT_P1_2_VALIDATION.md).
The original design baseline below refers to the separate P1.1 preview.

**Date:** 2026-10-09 JST
**Product:** 72H disaster-action assistant
**Target:** Mobile consumer UI; preserve PC/Judge roles and existing safety contracts
**Baseline:** P1.1 GPS-first Cloud Run Preview (revision `h72-gps-2181bc3`)

Related specifications:
- [P1.1 Accessible GPS-first UX](VNEXT_P1_1_ACCESSIBLE_GPS_UI.md)
- [P1.1 Location Contract](VNEXT_P1_1_LOCATION_CONTRACT.md)
- [P1.1 Cloud Preview Verification](VNEXT_P1_1_CLOUD_PREVIEW.md)
- [Agent Safety Contract](AGENT_SAFETY_CONTRACT.md)
- [Offline Continuity](OFFLINE_CONTINUITY.md)

## 1. Problem and goal

P1.1 achieves GPS-first onboarding and large, readable mobile controls, but the
**「その他」 / More** screen exposes too many unrelated functions on one long page.
The current implementation combines user profile, manual region selection,
appearance/power, device GPS, Safety Check controls, route searching, mobile
handoff, offline readiness, plan history, emergency basics, provider/source
details and Judge/Demo navigation. Many of these are diagnostics or contextual
actions rather than everyday settings.

For an older person or someone using the product under stress, this imposes
unnecessary scrolling, dense forms, ambiguous priority and multiple actions.

**P1.2 goal:** make More immediately understandable, with one clear location
action at the top and four simple settings destinations. **Do not delete any
safety-critical functionality to make the page shorter.** Relocate or disclose
advanced controls, while keeping emergency access and approved behaviors.

User-facing design principle:

> **「現在地を確認 → 必要な設定だけ選ぶ」**
> One dominant action, few visible choices, no jargon.

## 2. Scope and boundaries

In scope:
- Mobile More information architecture and large-touch-target layout.
- Clear, consistent GPS/area controls for an *existing* live session.
- Correct provenance-aware location label (GPS vs last known vs user-selected).
- Progressive disclosure for personal, display, offline and privacy settings.
- Relocate plan history / route candidate preview to Plan or an advanced subview.
- Remove consumer-facing Judge/Demo and raw source internals from More.
- Preserve read-only official-source details through appropriate contextual links.
- Japanese, English and Traditional Chinese copy.
- Regression tests for usability, privacy, offline and safety behavior.

Out of scope:
- New official data sources or movement authorization logic.
- Changing JMA verification, evidence TTL, trust rules or route eligibility.
- Replacing Safety Core or background GPS guarantees.
- Implementing native phone features, automatic SOS or new map permissions.
- Broad PC redesign; PC keeps preparedness, evidence review, handoff and
  Judge/Demo affordances.
- Production rollout without separate P1.1 real-device/release approval.

## 3. Mobile More: target information architecture

The default More view should show, in this order:

1. **Location status and a single primary button** — always visible near top.
2. **自分と家族の設定 / Personal & family** — accommodation, party size,
   accessibility/communication support, non-urgent Safety Check consent.
3. **表示と使いやすさ / Display & accessibility** — language, text-scale
   accommodation, visual theme and other usability preferences.
4. **オフラインの準備 / Offline readiness** — cached guides, downloaded
   map availability, last validation date, retry actions when available.
5. **プライバシー / Privacy** — what stays on device, optional retention of
   last location, forget action, link to fuller privacy explanation.

A small footer may provide 119/110 contact links and app information. Emergency
basics must **also remain reachable from Home without opening More**, and
they must work offline when a cached app shell is available.

Do not display full forms, multi-step settings, route tools or technical
source fields until a user deliberately opens a corresponding destination.

### 3.1 Suggested Japanese wireframe

```text
┌──────────────────────────────┐
│ その他                       │
│                              │
│ 現在地                       │
│ 東京都 · 最後の確認 3分前     │
│ [   現在地を確認   ]         │
│ 地域を変更  ›               │
│                              │
│ 👥 自分と家族の設定       › │
│                              │
│ ◉  表示と使いやすさ       › │
│                              │
│ ▣  オフラインの準備       › │
│                              │
│ ◈  プライバシー           › │
│                              │
│ 119 · 110     72H            │
│                              │
│ ホーム    計画    その他     │
└──────────────────────────────┘
```

The wireframe is structural, not a claim that current production already
supports these controls. Icons may be adjusted, but each icon needs a text
label.

### 3.2 Visibility rules

- No more than one visually dominant primary CTA on the More landing screen.
- The four destinations are full-width labelled links/rows, not large forms.
- Essential status is readable without relying on color.
- Avoid permanent technical status cards and debugging abbreviations.
- At 320, 375, 390 and 430 px, avoid horizontal scrolling.
- Maintain a visible way back to More from every settings subview.
- Restoring More after navigation must preserve unsaved-form warnings and
  avoid silently discarding user input; sensitive settings require explicit save.

## 4. Location card: single, truthful flow

### 4.1 Copy

Preferred primary button:
- Japanese: **現在地を確認**
- English: **Check current location**
- Traditional Chinese: **確認目前位置**

Use this consistent primary CTA for both onboarding and returning users where
semantically appropriate. The current labels `GPSで現在地を確認` and
`現在地を一度確認` may remain as explanatory text but should not suggest
two distinct functions.

The status line must describe:
- confirmed area (never invent finer municipality precision);
- source: GPS, USER_SELECTED or LAST_KNOWN;
- original timestamp and freshness state;
- optional GPS accuracy when a real device fix is available.

Examples:
- `現在地（GPS）: 東京都 · 2分前 · ±20m`
- `選択した地域: 東京都`
- `最後に確認した位置: 東京都 · 15分前`

**Do not label GPS-derived area `現在地（自己申告）`.**
Do not label USER_SELECTED as GPS, and do not present stale LKL as live.

### 4.2 Recheck vs area synchronization

Important architectural distinction:

```text
Tap "現在地を確認"
→ browser device location permission / getCurrentPosition
→ local position + timestamp + accuracy
→ N03 area resolution, potentially broad/ambiguous
→ validated area path
→ live-session area update through existing endpoint if applicable
→ explicit confirmed region or an honest pending/error state
```

A GPS fix on the device is **not** proof that the backend's current session has
changed to the newly resolved area. UI must distinguish:

- `端末の位置を確認しました` (device fix received);
- `地域の更新が完了しました` (backend area synchronized);
- `地域の更新を確認できません` (failed/pending; old movement UI gated).

Reuse the existing P1.1 location synchronization contract and endpoint, with
its observation-time constraints, ordering and pending gates. If a GPS recheck
only updates device state in a given implementation, say so explicitly and do
not claim the live area's source scope was refreshed.

Never silently create a new session, reset plan history or renew official
verification because of GPS alone.

### 4.3 Permission, fallback and offline

- Request geolocation only in direct response to user action.
- If permission is denied/unavailable: explain clearly and offer **地域を選ぶ**.
- Area fallback uses bounded prefecture/municipality selection, no free text.
- If geolocation is stale/ambiguous, show timestamp and only confirmed parent
  area; do not guess a municipality.
- Offline location refresh may update local GPS state, but cannot claim current
  verified official evidence or server synchronization.
- Existing Last Known Location retention remains opt-in, bounded, and erasable.
- `watchPosition()` remains restricted to already authorized MAP_ASSISTED
  presentation. More's button uses one-shot geolocation, not continuous watch.

## 5. Where current More functions go

| Existing P1.1 feature | P1.2 consumer placement | Preservation rule |
| --- | --- | --- |
| Device GPS & status | Top location card | Device and live-session state honestly distinguished |
| Bounded area fallback | `地域を変更` beneath location | Existing validator and gates remain |
| Accommodation, party size | Personal & family | Contextual form, explicit save |
| Accessibility/communication constraints | Personal & family | Must remain discoverable |
| Safety Check consent | Personal & family, non-urgent only | Urgent Safety Check controls stay in active scene |
| Theme, legibility | Display & accessibility | Browser/OS zoom remains supported |
| Power preference/manual override | Advanced subsection under Display | Power safety defaults and cleanup unchanged |
| Last-point retention & forget | Privacy | Opt-in stays off by default; forget remains immediate |
| Offline pack readiness | Offline readiness | Full offline/expiration disclosure preserved |
| Emergency basics, 119/110 | Home + footer + dedicated details | Always reachable, including before setup and offline |
| Plan history | Plan → History | Immutable history; no deletion |
| Candidate route search & preview | Plan → Advanced route detail (not More) | Candidate != safe, gated map behavior unchanged |
| Mobile handoff | PC preparedness footer / optional internal detail | Never include session, location or evidence in URL |
| Official-source metadata | Sources / contextual read-only detail | Important trust/freshness warnings remain visible where needed |
| Source retry | Source-status/contextual action | Offline/failed verification still visible |
| Judge / Demo link | PC/Judge-only discoverability | Keep internal /demo working; remove consumer More link |
| Raw logs/diagnostics | Judge / internal tools | Not shown to general users |

Relocating a feature must not make it inaccessible during an emergency,
disable it accidentally or change its authorization requirements.

## 6. Destination screen requirements

### 6.1 Personal & family

- Show a small summary and an explicit **編集 / Edit** action.
- Fields: accommodation name/area where permitted, party size, documented
  accessibility needs, Safety Check consent where appropriate.
- Do not ask for exact accommodation coordinates as part of an ordinary profile
  edit; current GPS/area update is a separate operation.
- Changes must preserve existing LiveSnapshot session/plan history.
- Form state must survive changing language/returning to the previous panel
  or clearly warn before discarding unsaved changes.
- On save error, show an actionable inline message; never silently succeed.

### 6.2 Display & accessibility

- Keep language selection quick and recognizable (top/global selector may stay).
- Theme is secondary; default follows suitable system/user setting.
- Respect 200% browser/system text scaling and `prefers-reduced-motion`.
- Never let toggling power appearance override actual battery/survival policy.
- Do not encourage users to experiment with complex energy settings in a
  high-risk emergency state.

### 6.3 Offline readiness

- Single overview of cached emergency guidance, plan snapshot, and offline map
  availability.
- Clearly distinguish downloaded vs verified vs stale/expired data.
- Do not claim offline pack is available solely because the app HTML loaded.
- Expose relevant refresh/download actions only when online and permitted.
- No nationwide N03 eager prefetch; use existing lazy-loaded shard limits.

### 6.4 Privacy

- Explain that precise GPS coordinates stay on the device unless a separate
  approved contract explicitly changes this.
- Offer opt-in LKL retention, original timestamp, bounded expiry and forget.
- Make `忘れる / Forget location` easy to find, explicitly scoped, and
  verify that local stored point and consent are cleared.
- Do not place location, session or evidence payload into shared/handoff URLs.

## 7. Critical scene behavior

More is not allowed to compete with urgent safety actions:

- `EMERGENCY_PROTECT`: full-screen protection text takes precedence.
- `SHELTER_IN_PLACE`: text-first, no map by default.
- `SAFETY_CHECK`: present large direct responses when truly triggered;
  do not bury active responses inside settings.
- `MAP_ASSISTED`: show map only with authorized spatial need and required
  verified evidence. Leaving it must stop GPS watching.
- `NORMAL/MONITOR`: More remains simple and secondary.

A link to More must never promote stale/unverified movement guidance, nor
recreate a hidden authorized map.

## 8. Accessibility & content quality

Minimum practical UI targets for this milestone:
- Normal body text around **18 px**; important state ~22–26 px.
- Main button at least **56 px** high; urgent actions ~64–72 px.
- Text accompanying all actionable icons.
- Visible focus outline and semantic links/buttons; keyboard operation.
- Sufficient contrast consistent with relevant WCAG 2.2 AA criteria.
- No color-only status, hover-only controls or hidden critical instructions.
- 200% text scaling and smaller phones must not clip primary actions.
- Clear language across `ja`, `en` and `zh-TW`; no technical English
  abbreviations in the consumer UI.
- Avoid high-motion transitions; support reduced-motion and power modes.
- One deliberate screen-level primary action; clear back behavior and focus
  restoration when returning from a settings destination.

This is a product usability target, not evidence of real-user usability until
representative hands-on testing occurs.

## 9. Engineering approach

Preferred small, modular implementation:

```text
Mobile More Landing
 ├── LocationStatusCard
 │    ├── One-shot GPS request
 │    ├── GPS → N03 → validated session-area update
 │    └── Manual region fallback
 ├── PersonalFamilySettings
 ├── DisplayAccessibilitySettings
 ├── OfflineReadinessSettings
 └── PrivacySettings

Plan
 ├── Current plan (existing)
 ├── History (relocated)
 └── Advanced route candidate detail (relocated, gated)

PC / Judge
 └── Full diagnostics, source review, demo/handoff (existing)
```

Component names are illustrative: refactor existing components where
appropriate, not by duplicating state or permission handling.

Source touchpoints to review:
- `apps/web/components/live-dashboard.tsx` — existing mobile More composition,
  DesktopPreparedness, route and profile controls.
- `apps/web/components/device-location.tsx` — device-only location UX.
- `apps/web/components/location-onboarding.tsx` — first-run wording.
- `apps/web/components/adaptive-home.tsx` and
  `apps/web/lib/adaptive-i18n.ts` — source-agnostic self-reported label.
- `apps/web/lib/live-i18n.ts`, `apps/web/lib/vnext-i18n.ts` — localization.
- Existing P1.1 location freshness, area resolution and synchronization libs.

Do not introduce a second GPS state store or new safety verdict logic.

## 10. Verification matrix

### Navigation and discoverability

- New user: GPS-first onboarding still works, no location typing required.
- Returning user: More opens concise landing and offers location refresh at top.
- From all four destination pages: back returns to More without unintended
  session reset.
- Plan history appears on Plan, not duplicated on More.
- Route candidate search remains reachable only through the deliberate
  advanced Plan path and retains its warning and gating.
- PC retains handoff, source reviews and Judge link.
- Consumer More contains no Judge/Demo or raw source diagnostics.

### Location truthfulness

- Granted GPS: device fix, accuracy, age and provenance shown correctly.
- Denied GPS: no permission prompt loop; manual area fallback usable.
- Stale LKL: original timestamp and `last known` shown, not live.
- Ambiguous N03: confirmed ancestor only, no invented ward.
- Backend location sync pending/failed: no false success message or old map.
- GPS same-area refresh: no renewal of official evidence, route or plan solely
  from GPS.
- Offline: no false server sync or VERIFIED state; emergency basics remain.
- Forget: location/consent removed without accidental session-plan resets.

### Accessible browsers

- Viewports: 320, 375, 390, 430 px plus desktop role.
- 100% and 200% text scaling, all three languages.
- Screen reader semantics/focus order, keyboard interactions and visible focus.
- Reduced-motion, system/contrast themes, normal and conserve power mode.
- Critical interactions usable one-handed and without horizontal overflow.

### Regression and safety

- Full frontend and backend unit suites remain green.
- `tsc`, production build and secret scan pass.
- Emergency, Shelter, Monitor and Safety Check scenes remain valid.
- `MONITOR` and `SHELTER_IN_PLACE` do not mount a map.
- Authorized-map watch cleanup when scene ends/offline/background.
- Stale JMA/live source fails closed; no new high-risk movement authorization.
- Offline cached reload and network reconciliation remain truthful.
- Source/evidence, plan history and privacy non-leakage unchanged.

## 11. Acceptance criteria

P1.2 is **locally accepted** only when all of the following are demonstrated:

1. Landing More has the location card, four destinations and minimal footer.
2. GPS refresh is visible without scrolling on a common mobile viewport
   (subject to system 200% text scaling with reasonable accessible scroll).
3. Returning users have an obvious one-shot GPS action.
4. Onboarding and More use consistent wording for this action.
5. The location label accurately reflects GPS, selected area or LKL.
6. Actual session-area sync is not falsely claimed after device-only GPS fix.
7. GPS permission denial has non-typing fallback.
8. Important user settings remain accessible via one deliberate destination.
9. Safety Check prompt and urgent protection remain available when needed.
10. Offline basics and 119/110 remain reachable, including pre-session.
11. Plan history relocated without deleting immutable records.
12. Route candidate controls are separated from consumer settings, retain
    candidate-vs-safe warnings and cannot bypass map/authorization gates.
13. Mobile handoff/debug tools are removed from ordinary More, not broken.
14. Every language and mobile width passes no-overflow/readability checks.
15. 200% text scaling, reduced motion and keyboard focus tests pass.
16. Location retention/forget and public-link privacy checks pass.
17. JMA stale and offline/reconnect fail-closed invariants remain unchanged.
18. Frontend/backend/typecheck/build/secret checks pass.
19. Changes are reviewed independently and fully documented.
20. No Cloud Run promotion occurs without explicit release validation.

## 12. Release and safety gates

Current P1.1 preview remains a distinct release candidate. As documented in
`VNEXT_P1_1_CLOUD_PREVIEW.md`, physical Android/iPhone GPS acceptance was not
proven by the controlled browser test. The user's report that the GPS control
worked on their phone is useful usability feedback but does not by itself
establish all device-specific gates (accuracy, background, battery, scaling).

P1.2 specification approval does **not** authorize an automatic deployment,
a traffic change, cloud IAM/billing changes, or claiming P1.1 real-device
verification complete.

Suggested delivery sequence:

```text
Requirements sign-off
→ isolated implementation branch
→ component + safety regression tests
→ mobile and PC browser matrix
→ independent review
→ immutable Preview Cloud Run image
→ mobile real-device validation
→ explicit production release decision
→ preserve old revision/rollback
```

**Immutable safety principles:**
`GPS_UPDATED != SAFETY_VERIFIED`;
`NETWORK_RESTORED != VERIFICATION_RESTORED`;
`route candidate != safe route`;
`stale evidence cannot grant new high-risk movement`.

---

**Definition of done:** More must *feel* like a short, familiar settings page,
while all non-negotiable safety functions continue working in the appropriate
screen and existing deterministic core.
