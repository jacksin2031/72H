# 311 guided judge evidence

Local evidence for the approved four-event `/judge` experience (2026-10-15 JST).
Scope and limits: [validation record](../../docs/validation/JUDGE_311_LOCAL_VALIDATION.md).

- `browser-envelopes.json`: final UI run, real Gemini/ADK, five responses (start + four steps).
- `browser-validation.json`: request/step/plan/AI/movement and 320px geometry summary.
- `desktop-intro.png`, `desktop-home-entry.png`, `mobile-intro.png`, `mobile-step*.png`, `mobile-summary.png`: browser UI evidence.
- `envelopes.json`: test fixture generated with a fixed timeout runner; four fallback results. The compact frontend copy is `apps/web/tests/fixtures/judge-311.json`.
- `browser-step2.json` / `browser-step3.json` / `browser-step4.json`: earlier real-model run, before the final copy cleanup; the aggregate final run above is authoritative.
- `dev-hmr-error.png`, `mobile-summary-before-copy-fix.png`: intermediate failure/copy evidence, not final acceptance screenshots.
- `frontend-tests.log`, `build.log`: final frontend suite and production build output.

No deployment or physical-device acceptance is represented here. Browser session
identifiers and locations in these records belong to synthetic exercises.
