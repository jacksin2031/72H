# P1.3 — One-Screen UX Local Validation

Date: 2026-10-09 JST
Status: **LOCAL ACCEPTANCE PASS — NOT DEPLOYED**

## Source

- Base: GitHub `main` `847b29b9a21fdffcac2143d1b4c9a163f51947c1`, P1.2 production source.
- Development branch: `codex/vnext-p1-3-one-screen`.
- Specification: [VNEXT_P1_3_ONE_SCREEN_UI.md](VNEXT_P1_3_ONE_SCREEN_UI.md).
- No changes to Cloud Run production, Google Cloud, IAM, secrets, source ingestion, planner or deterministic Safety Core.

## Changes implemented

1. Active-session mobile header uses a single compact row. Network/reconnection truth remains displayed; language selection stays available at onboarding and **More → Display**.
2. Home shows safety state and NOW action **before** secondary area diagnostics. Area/source/age remain visible in a short `details` summary; original GPS capture time, accuracy and stored position require deliberate expansion. Removed duplicated reconnecting sentence while retaining topbar status and prominent stale-evidence warning.
3. Plan collapses history/advanced candidate tools behind one labelled disclosure. When there is no approved action, renders **one** no-plan state, never three 180px empty category cards. When approved actions exist, preserves all populated NOW, NEXT and AVOID categories and evidence.
4. More uses a short location headline, source/age disclosure, one GPS CTA, unchanged bounded manual-area fallback and four primary settings destinations. Removed vertical margins from the manual picker; the 119/110 footer, privacy controls and urgent protections remain accessible.
5. Kept existing user settings, profile drafts, offline evidence and network rules, and non-typing location fallback.

## Tests run

- Frontend Vitest: **234 passed, 3 skipped**, 29 test files passing, 1 file skipped.
- Backend pytest: **133 passed**, single existing Starlette/httpx deprecation warning.
- TypeScript `tsc --noEmit`: **PASS**.
- Next.js 16.3.8 production build via `node scripts/build.mjs`: **PASS**, 10 static pages, 23 offline shell assets.
- Secret-pattern repository scan: **PASS**.
- Git diff whitespace check: **PASS**.
- Added 4 focused React tests for safety-first Home ordering, collapsed GPS diagnostics, empty Plan, and language changes in Display.
- Existing emergency protection, Safety Check, map gating, GPS lifecycle, privacy drafts, offline and replay tests remained passing.

The user's global Windows npm v11.16.0 installation had a broken `minipass-flush` dependency; checks used the installed Node CLI entrypoints with an isolated copied project `node_modules` and `uv`, without changing globally installed software. A temporary `node_modules` junction was removed before the independent copy. This is a local toolchain issue, not an application build failure.

## Browser validation (LOCAL production build; Chrome headless)

Test server ran only on `127.0.0.1:3313`, with a QA-only local backend fixture on `127.0.0.1:8313` sourced from a previously captured stale, no-plan production QA response. The browser used manual prefecture selection (Tokyo), so browser screenshots/measurements below are not evidence of physical GPS accuracy. All fixture-driven screens remained fail-closed: no movement plan, no route map.

| Screen | P1.2 baseline scroll height at 390 × 844 | P1.3 measured height at 390 × 844 | P1.3 outcome |
| --- | ---: | ---: | --- |
| Home | 944–971 px | **844 px** | No scroll, NOW visible above fold |
| Plan (no actions) | 1133 px | **844 px** | No scroll, one empty message |
| More | 1081 px | **844 px** | No scroll, four settings visible |

Final screen measurements, CSS pixels:

| Viewport | Home scroll height | Plan scroll height | More scroll height | More last settings bottom / fixed nav top |
| --- | ---: | ---: | ---: | ---: |
| 320 × 700 | 735 | 700 | 803 | 584 / 627 |
| 375 × 667 | 680 | 667 | 803 | 584 / 594 |
| 390 × 844 | **844** | **844** | **844** | 576 / 771 |
| 430 × 932 | **932** | **932** | **932** | 576 / 859 |

- Mobile header after session: **56 px** (prior 96–134px).
- More location card: **220–229 px** (prior ~360px).
- Home NOW primary card bottom: **381 px** on 390 × 844; **414 px** on 320 × 700, before the fixed bottom nav.
- On 320 × 700 and 375 × 667, secondary content can scroll; all four More settings are in view before the fixed nav.
- 200% document font scaling on 390 × 844: More scroll height 1412px; no horizontal overflow. Scrolling intentionally permitted for legibility.
- All viewport runs: `scrollWidth === innerWidth` (no horizontal overflow).

These measurements are **headless Chrome viewport emulation, not independent handheld or screen-reader testing**. Do not claim a 100% scroll-free experience on all devices or for a long, active emergency plan.

## Safety invariants

This is purely a presentation/disclosure change:
- GPS never refreshes official disaster verification by itself.
- Reconnection never renews evidence trust/TTL.
- An empty Plan cannot create or imply actions.
- Populated approved NOW/NEXT/AVOID action content is not discarded.
- Stale evidence cannot authorize HIGH movement; route candidates are never safe guarantees.
- Critical `EMERGENCY_PROTECT`, `SAFETY_CHECK`, `SURVIVAL`, and authorized `MAP_ASSISTED` logic stays unchanged.
- Offline emergency basics and 119/110 remain reachable; language remains changeable.

## Remaining release gates

- Physical Android / iPhone validation of visual safe-area, OS font scaling, VoiceOver/TalkBack focus, GPS permission and foreground/background lifecycle.
- Verify populated-plan and critical-event browser screenshots with authoritative QA fixtures; tests already cover deterministic emergency and authorized-map contracts.
- Independent PR/CI review, then optional immutable 0%-traffic Cloud Run preview **only if separately requested**.
- P1.2 production continues to serve 100% of traffic; P1.3 has not been deployed.

**Local implementation is complete. Production release is not authorized by this report.**
