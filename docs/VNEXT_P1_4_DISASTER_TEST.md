# P1.4 — Disaster Test Lab (isolated synthetic UI sandbox)

Date: 2026-10-10 JST
Status: LOCAL PASS; PRODUCTION NOT AUTHORIZED
Development branch: `codex/p1-4-disaster-test`
Baseline: P1.3 `4f0db7644c4ced068158dad67a5c3c3ad5b94d83`.

## Navigation and scope

- On mobile More / Settings: collapse **Testing & diagnostics** → **Disaster test (simulation only)**.
- Direct standalone static route: `/disaster-test`; it can be opened without first creating a Live session.
- Default More still shows exactly four primary destinations, with the test tool nested behind disclosure.
- Japanese / English / Traditional Chinese labels supported.
- An explicit TEST banner and sticky simulated-state badge remain visible. Preview NOW is placed above the controls; settings scroll normally as needed.

## Controllable scenarios

- Hazard: earthquake, tsunami, typhoon, flood, landslide, fire.
- Severity: synthetic L0–L4 (not the JMA seismic-intensity scale).
- Simulated battery: 0–100% plus unknown; use existing real `derivePower` thresholds and policy.
- Simulated network: online / offline / reconnecting.
- Simulated evidence age: fresh / stale / unknown.
- Mobility: able / unable to move.
- Presets: routine, moderate, critical-offline, survival 3%.
- A reversible local-only Safety Check response is shown for severe and critical levels; no persistence.

## Non-negotiable isolation

- This route imports no `live-api`, uses no `fetch`, does not write a Replay or Live session, and makes no user notification, device GPS, battery, network or backend changes.
- All inputs are ephemeral React state. Battery figures are display-only and never change the physical device.
- Synthetic events never enable official movement authorization, map mounting, route/shelter safety, or emergency dial links.
- Even simulated fresh evidence does not constitute official verification.
- The UI simulates presentation and actual `derivePower` policy only. It does not claim full end-to-end Safety Core, real-world hazard detection, hardware battery operation or actual screen-reader behavior.

## Local validation

- Frontend Vitest: **239 passed, 3 skipped** across 31 files (30 pass, 1 skipped).
- Backend pytest: **133 passed**, unchanged Starlette/httpx deprecation warning.
- TypeScript: PASS.
- Next.js 16.3.8 production build: PASS; `/disaster-test` statically generated.
- Secret/credential scan: PASS.
- Diff whitespace: PASS.
- Added 4 focused sandbox tests and 1 mobile More disclosure regression test.

## Physical Android validation (ADB, Chrome)

- Device: ASUS_AI2201_A, Android 12; physical pixels 1080x2448, density 420.
- On-device page loaded through `adb reverse tcp:3314 tcp:3314` to a local dev server; Chrome URL is local only.
- Native UIAutomator accessibility tree: banner, hazard, severity, battery, network, evidence, presets all present; labels and tap targets exposed.
- Chrome DevTools connected through ADB port forwarding to the targeted test tab only.
- Measured actual viewport: 411x830 CSS pixels; document width 411; no horizontal overflow.
- Routine/base scenario L2 battery 60%, power NORMAL, no Safety Check.
- Critical/offline preset L4 battery 10%, power EMERGENCY_POWER, Safety Check controls present.
- Survival preset tsunami L4 battery 3%, power SURVIVAL, Safety Check present.
- Reset restored L2 battery 60%, NORMAL.
- Simulated 200% **browser zoom**: viewport width 411, document width 411 (no horizontal overflow); scrolling was permitted.
- No `tel:` anchors in the test lab; no real emergency call.
- Local screenshot evidence (not tracked): `.work/p14-mobile.png`.
- Browser zoom is not a substitute for OS font enlargement. No TalkBack narration, OS font-size, battery discharge, or physical GPS lifecycle acceptance is claimed.

## Release boundary

Do not alter P1.2 production traffic (`h72-more-0434633` = 100%) without separate release approval. P1.4 may be tagged as a zero-production-traffic Preview for manual testing. Keep P1.3 zero-traffic Preview intact. iPhone VoiceOver remains unverified.
