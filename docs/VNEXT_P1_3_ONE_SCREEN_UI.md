# P1.3 — One-Screen UX & Context-Aware Progressive Disclosure

**Status:** IMPLEMENTATION SPECIFICATION — DEVELOPMENT BRANCH ONLY (2026-10-09 JST)

**Baseline:** P1.2 official production source commit `847b29b`; mobile 72H web/PWA, languages Japanese / English / Traditional Chinese.

## Goal

At first glance, show **the current action and safety/verification state**, not the machinery behind it. Normal MONITOR, an empty Plan and the More landing should fit into a 390 × 844 CSS-pixel viewport **including the fixed navigation** wherever content length allows. At 320 × 700, critical action / warning text must be visible without scrolling; secondary controls can scroll. At 200% text, preserve readable text and allow ordinary vertical scrolling, never clip or hide critical actions.

## Baseline measured on actual P1.2 production (headless Chrome viewport emulation)

| Viewport | Home scroll height | Plan scroll height | More scroll height | Fixed nav starts |
| --- | ---: | ---: | ---: | ---: |
| 320 × 700 | 1077 | 1171 | 1119 | y=627 |
| 375 × 667 | 971 | 1133 | 1081 | y=594 |
| 390 × 844 | 971–944 | 1133 | 1081 | y=771 |
| 430 × 932 | 944 | 1133 | 1081 | y=859 |

All heights are CSS pixels, simulated desktop Chrome mobile mode. Old state has a 96–134px header; 390px Plan shows 3 × 180px **empty** NOW/NEXT/AVOID cards; More has a 360px location card. These baseline figures are not handset acceptance.

## Changes / ownership

1. **Compact mobile shell header**: single compact line for app brand and concise network/freshness status. The language selector remains available on *first use*, then relocates to **More → Display & accessibility**; desktop header unchanged. Do not suppress essential offline/reconnecting/error indicators on other routes.
2. **Home**: prioritize verified/safety state and primary action. Collapse timestamp and accuracy of GPS into a deliberately accessible `<details>` disclosure below primary action. A truthful concise area and source/freshness must remain visible at all times. Remove duplicate descriptions of the same reconnection/staleness state, but retain one conspicuous alert for unverified sources. Keep immediate protection, Safety Check, survival, map and primary AVOID behavior untouched. Accessible emergency basics available without scrolling when possible and always before onboarding.
3. **Plan**: display a **single compact no-plan state** if all approved `NOW/NEXT/AVOID` categories are empty. For a populated plan, show only populated categories, preserving every NOW/NEXT/AVOID action and corresponding evidence. Plan history and candidate route remain accessible through a labelled `<details>` on-demand tool chooser. Candidate is never an authorized safe route.
4. **More**: reduce the default location card to one accurate area line, source + freshness, one 56px GPS CTA and bounded area fallback. Detailed original observation timestamp, precision and optional device-only point in accessible disclosure; sync failures/permission errors never buried. Four 56px destination links remain visible; personal/drafts, display/language, offline, and privacy features unchanged. Keep 119/110 accessible.
5. **CSS and responsive sizing**: remove redundant spacing / tall placeholders rather than shrinking safety text. Keep bottom nav fixed and ensure primary controls do not overlap it. Keep minimum 56px primary targets, accessible keyboard focus and safe-area padding.

## Fail-closed / safety invariants

Do not change:
- backend source verification or TTL, trust, conflict checks, plan evaluation, active source allowlists;
- `GPS_UPDATED != SAFETY_VERIFIED` or `NETWORK_RESTORED != VERIFICATION_RESTORED`;
- live/replay separation or canonical location area sync;
- gating of stale/unverified HIGH movement, map, or candidate routes;
- active safety check and EMERGENCY_PROTECT takeover precedence, emergency phone link access;
- offline age indicators and original timestamps for any expanded details;
- privacy, one-shot location permission, optional one-point last-known persistence.

**Never hide essential AVOID items or current safety alerts for aesthetic space.** If a real plan or critical presentation requires more screen space, **vertical scrolling is acceptable**; do not truncate safety information.

## Acceptance gates

- Source: independent P1.3 worktree; no direct production writes.
- Empty Plan: exactly one no-plan message, no empty NOW/NEXT/AVOID cards.
- Populated Plan: all approved actions remain with evidence; empty categories suppressed.
- Home: current action visible before GPS diagnostic details; GPS source+freshness remains visible.
- More: four settings destinations + GPS CTA visible at default; details are explicitly accessible; sync/permission errors still visible.
- Language on first-use, More Display (when initialized), desktop; switching persists.
- 320×700, 375×667, 390×844, 430×932, and 200% zoom or font-scaled; no horizontal overflow, fixed nav no clipping, focus order stable.
- Offline, stale, reconnecting, emergency protection, Safety Check, survival, authorized-map and aborted-location-update tests pass.
- Frontend full suite, backend suite, typecheck, production build, secret scan, independent browser audit.
- Keep P1.2 revision unchanged unless separate production rollout authorized.

## Release contract

Commit locally after tests; PR/Preview/prod only after accepted verification and explicit requested deployment scope. P1.2 production remains at `h72-more-0434633` throughout this development.
