# P1.5 Final Agent Drill Preview — Acceptance Record

Date: 2026-10-10 JST
Status: TRUE GEMINI/ADK DRILL ACCEPTED ON ZERO-TRAFFIC PREVIEW; PRODUCTION RELEASE HOLD

## Immutable runtime

- Branch: `codex/p1-5-agent-drill`
- Runtime commit: `3385c2e93667ad65bfa413267aef88d991236d4c`
- Cloud Build: `bfaa6f77-53ca-431c-b8dd-d71580fdb040` — SUCCESS
- Image digest: `sha256:285015ff9617758a5e365d02f3787f489c66bd457e05bf6aea25d1f3b47426da`
- Cloud Run: project `h-japan`, `asia-northeast1`, service `h72`, revision `h72-drill-3385c2e`
- Preview: https://drill-3385c2e---h72-vux6j7xjka-an.a.run.app/disaster-test
- Production traffic: P1.2 `h72-more-0434633` **100%**; new Preview **0%**
- Runtime revision Ready, Active and ContainerHealthy True.
- This revision uses Secret Manager reference `h72-drill-access` version 1 for `DRILL_ACCESS_KEY`, service account scoped to secret accessor.
- Owner access key is in their Windows profile `C:\Users\jacks\.72h-private\drill-access.txt` (NOT in Git, document, browser URL, or server logs).

## Real AI, not a simulated model stub

- Offline local direct Vertex AI / Gemini ADK integration PASS with synthetic earthquake L4, battery 10%, no mobility; steps 2 and 3 produced actual `GEMINI_ADK` outcomes, Plans v1 and v2.
- Live tagged Cloud Preview authenticated API probe PASS: no key => HTTP 403. With key:
  - Event 1: `disaster_alert`, deterministic only, 0 plans
  - Event 2: `official_update`, `GEMINI_ADK`, 1 plan
  - Event 3: `transport_update`, `GEMINI_ADK`, 2 plan versions, 6 historical actions, 10 trace events
  - `/api/replay/{drill-id}` returns 404, no Replay/Live session mixing
  - All evidence synthetic; no high-risk ALLOW.
- Final revision physical ASUS_AI2201_A Android 12, Chrome, viewport 411 CSS px:
  - Default FRESH simulated evidence; authenticated Run executes 3/3 events
  - Genuine Gemini/ADK success displayed, 3 current actions, 2 synthetic API evidence records
  - Exercise completion shown; no horizontal overflow
  - After changing L2 to L3, prior result (3 actions) was immediately cleared to 0 while access key remained only in page memory.

## Test coverage and isolation

- Frontend Vitest: 240 PASS, 3 existing SKIP; typecheck and Next.js production build PASS.
- Backend pytest: 138 PASS (133 baseline + 5 new gated-drill tests).
- 45 combinations of (L0-L4) × (ONLINE/OFFLINE/RECONNECTING) × (3%/10%/50%) exercised via deterministic/mock-AI fallback matrix: 90 plan versions, zero unsafe high-risk ALLOW, all synthetic. This is NOT evidence of 45 genuine Gemini calls.
- Secret scan and diff whitespace PASS; no key files in Git.
- Cloud HTTP 200: `/disaster-test`, `/dashboard`, `/more`, `/api/health`, `/sw.js`.
- Live JMA smoke separately remains STALE with zero plans and `movement_authorized=false`. No Live provenance promotion due to exercises.
- No real push, emergency dial, device network/GPS manipulation, or real battery drain.

## Scope boundaries

- EARTHQUAKE is the only end-to-end supported hazard type in current Safety Core contracts.
- TSUNAMI/TYPHOON/FLOOD/LANDSLIDE/FIRE selectors remain UI-only, explicitly labelled unsupported for end-to-end drill.
- Gemini is used for bounded candidate intent selection, not unconstrained disaster reasoning. Safety Core retains ultimate decision authority.
- Synthetic battery percent enters the AI candidate context; deterministic UI power policy uses `derivePower`. Server Safety Core does not yet enforce battery-tailored plan actions.
- The exercise uses the Replay reducer and planner boundary; it does not inject mock data into the production Live JMA HTTP adapter or prove that adapter integration.
- Screen-reader services, iOS VoiceOver, OS font scaling, physical low-battery endurance and full emergency-release readiness remain unverified.
- No Git push, merge or production traffic switching was performed.
