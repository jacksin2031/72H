# P2.1 — Cloud Preview acceptance

2026-10-10 JST | **Cloud Preview PASS; Production HOLD**

## Provenance
- Branch: `codex/p2-1-expanded-map-dark-ui`
- Deployed source commit: `352dcc985b3400f64f7a6f77270b4ec55f5b27ba`
- Cloud Build: `c4307152-0489-40ec-8a87-3eb420004bc9` SUCCESS
- Image digest: `sha256:880aae62f8f6de6c1c72894012c1471f498d67c320a70b6b8e26d2c7b17447e8`
- Google Cloud Run: project `h-japan`, region `asia-northeast1`, service `h72`
- Preview revision: `h72-mapui-352dcc9`, tag `mapui-352dcc9`, 0% traffic
- Preview: https://mapui-352dcc9---h72-vux6j7xjka-an.a.run.app/disaster-test
- Production traffic before and after deployment: `h72-more-0434633` **100%**.

## Verified physical Android Chrome (ASUS_AI2201_A, 411 CSS px)

- Historical 311 scenario prelude: simulated countdown 600× and no early Mock Live start; first request at ~6150ms real elapsed at event boundary.
- Actual cloud Gemini / ADK updated NOW and kept mock drill isolation.
- Home, Plan, Timeline, Full Map, Settings navigated successfully; no horizontal overflow.
- Timeline background `rgb(16,28,25)` (dark); embedded map preview 257.45 CSS px height.
- Full map: 695.48 CSS px tall. Default collapsed risk sheet 104.71 CSS px tall, **84.94%** of full map height exposed.
- Cloud computed map-back and title controls `rgba(17,40,34,.91)`; zoom controls `rgba(17,43,37,.91)`; bottom risk panel `rgba(16,31,29,.96)`. No legacy white floating controls.
- Risk detail panel expands/collapses on request; opt-in synthetic GPS (Tokyo 35.6895,139.6917, accuracy 18m) shows 389.1km epicentral surface distance, no high-risk safety clearance. Collapsing restores full map view while preserving the in-memory GPS observation for this exercise.
- Exit drill returned to settings; no persisted drill key.
- Maps still display only verified local OSM road reference. Tsunami / earthquake location safety remains undetermined without the requisite official hazard and verified route evidence.

## Regression
- Frontend 269 tests PASS, 3 existing SKIP; backend 150 tests PASS (Starlette deprecation warning only).
- TypeScript, Next optimized build, secret pattern scan, `git diff --check`: PASS.
- Two additional unit tests cover default-collapsed map, expanded GPS/details, safety banner visible on collapsed tsunami warning.

No production promotion, GitHub push or merge has been performed.
