# P1.1 GPS-first cloud Preview verification

Date: 2026-10-09 JST

Status: **CLOUD PREVIEW ACCEPTANCE PARTIAL / PRODUCTION PROMOTION BLOCKED**.

This document records independently observed P1.1 cloud build and preview verification, not an endorsement of untested real-device GPS behavior.

## Source and release identity

- Application repository: `jacksin2031/72H`.
- P1.1 accepted source: `4de08c075bdfcdbc8bc89f9f49dac7b0be4209a4`.
- Cloud Build compatibility fix: `2181bc32e3e50fa658f6d8d4b5531561d9ead142`.
- Fix PR: https://github.com/jacksin2031/72H/pull/4 (CI passed; merged).
- Build source: immutable `git archive` of `2181bc3`, 1,319 files, approximately 407.7 MiB.
- Google Cloud project: `h-japan`; region: `asia-northeast1`.
- Cloud Build ID: `c48d20bd-3194-449d-968f-3257f043a2d6`, **SUCCESS**.
- Image digest: `sha256:c4800827a5aed8c95d7bb701b690402089d60080145bd81cb75fc8098c196d8b`.
- Preview Cloud Run revision: `h72-gps-2181bc3`, **Ready**, 0% production traffic.
- Preview URL: https://gps-2181bc3---h72-vux6j7xjka-an.a.run.app/dashboard
- Production URL: https://h72-vux6j7xjka-an.a.run.app/dashboard
- Production revision at verification: `h72-ui-910c1d2`, still **100% traffic**.

## Fixed deployment blocker

The pre-P1.1 Dockerfile did not stage the area-worker bootstrap scripts required by the new `npm ci` postinstall hook. The corrected Dockerfile stages the scripts, the geometry source and pinned national manifest before `npm ci`. Cloud Build now completes this installation step, Next.js 16.3.8 production compilation, TypeScript, static assets and runtime image push.

Source secret scan and GitHub PR #4 validation passed.

## Preview HTTP gates

HTTP 200 confirmed for:
- `/dashboard`, `/plan`, `/more`, `/notifications`, `/sources`, `/demo`;
- `/api/health`;
- `/areas/manifest.json`, `/areas/catalog.json`, `/areas/worker.mjs`, `/areas/area-geometry.mjs`;
- `/sw.js`.

National N03 assets are now present in the actual Cloud Run preview, unlike old production.

## Live API and safety

Executed `python scripts/validate_p1_http.py` against the Preview origin (no provider route search).

Observed actual JMA data:
- Source: `STALE`.
- Non-synthetic typed official evidence: 3.
- Plans: 0.
- Designation candidates: 512.
- `movement_authorized=false`.
- No map mount authorization.
- Live/Replay session isolation tested by the script.

This is expected fail-closed behavior. No official movement authorization or safe evacuation route was fabricated.

Test output is retained in `.work/p1-1-preview-http/`.

## Browser gates

Headless Chrome against the actual Preview origin:

- Mobile viewport 390x844: first-run status `準備が必要`, no text-input field required, GPS action and area-selection fallback present; no horizontal overflow.
- Controlled geolocation (Tokyo station, accuracy 20 m): GPS permission emulated, location confirmed with observed time and accuracy. Municipality ambiguity demoted to verified prefecture `東京都` rather than inventing a precise municipality. The app's main start button worked.
- Subsequent mobile MONITOR: no map mounted, safe waiting/reverification UI; 390 px scroll width at 390 px viewport.
- Desktop viewport 1280x900: preparedness dashboard and evidence/source review rendered; no map mounted, footer `Judge / Demo →` correct, no horizontal overflow.
- Browser network emulation: on offline reload, cached mobile Home remained available, visibly labelled offline and with expired/stale evidence, and no map mounted. Network override restored afterwards.

**These tests use simulated browser GPS and simulated network loss. They are not real-phone GPS precision, background-location, or battery measurements.**

## Outstanding blockers / observations

- **Real-device GPS acceptance is NOT RUN:** requires an Android or iPhone for OS/browser permission, first fix, actual accuracy, large OS text, background/foreground, lock/unlock and battery behavior.
- **No production traffic promotion.** Existing `h72-ui-910c1d2` remains 100%; `h72-gps-2181bc3` remains Preview-only.
- One non-safety UX wording issue remains: after a GPS fix, Mobile MONITOR uses `現在地（自己申告）` from `adaptive-i18n.ts` even though the area was GPS-derived. Update source-specific or neutral wording before public promotion.
- Tested official JMA status was STALE; verified positive live evacuation/route evidence was not present, so it cannot be claimed as a real-world positive-path validation.

## Required next steps

1. Test Preview on a real phone and record GPS permission/fix/accuracy and failure fallback.
2. Fix the GPS-derived-location label mismatch and recheck frontend/browser tests.
3. Check source status, stale fail-closed handling, 200% text, offline behavior and rollback on the final release image.
4. Only after gates pass, perform a deliberate production traffic promotion and verify the previous revision remains accessible for rollback.

**Core invariants remain: GPS_UPDATED != SAFETY_VERIFIED; NETWORK_RESTORED != VERIFICATION_RESTORED; route candidate != safe route.**
