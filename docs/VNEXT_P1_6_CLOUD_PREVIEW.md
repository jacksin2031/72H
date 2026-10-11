# 72H P1.6 — Cloud Preview & Mock Live Acceptance

Date: 2026-10-10 JST
Decision: PREVIEW SMOKE PASS; REAL CLOUD AI EXERCISE PENDING; PRODUCTION RELEASE HOLD.

## Version and traffic
- Git branch: `codex/p1-6-mock-live-adapter`
- Runtime source: `6ed01280fc83457bc66fa96ed7d6cca38c375ad9`
- Cloud Build ID: `93b49b46-7f88-4ae3-b287-76707456906d` — SUCCESS.
- Immutable digest: `sha256:adf33dca843f6c077f6a456e52a00d7aa7f8b55acba51c0d11eeef3e877d0fa8`.
- Google Cloud Run project `h-japan`, region `asia-northeast1`, service `h72`.
- Preview revision: `h72-mock-6ed0128`, tagged `mock-6ed0128`.
- URL: https://mock-6ed0128---h72-vux6j7xjka-an.a.run.app/disaster-test
- P1.2 Production `h72-more-0434633` stayed **100%** before and after deployment; new Preview **0%**.
- Revision Ready=True, Active=True, ContainerHealthy=True.

## Acceptance
- Backend full pytest suite PASS (prior 138 + 5 Mock Live focused tests).
- Frontend full Vitest suite PASS (241 passed, 3 existing skipped).
- TypeScript, Next.js production build and repository secret-pattern scan PASS.
- Real Vertex AI / Gemini ADK **local** end-to-end call PASS: synthetic L4 earthquake, 10% battery, cannot move. `MockLiveStore.refresh_async` step 1 used the genuine Live candidate-planner boundary, returned `GEMINI_ADK` and one plan. Step 2 generated another synthetic report with no authorization to move. No actual external JMA or route provider calls.
- 45 Mock Live scenario matrix PASS: 5 severity levels × 3 network states × 3 freshness states (battery varies among 3%, 10%, 50%). Used fake AI fallback; 50 events, 30 plan versions; no unsafe movement, all evidence synthetic. Matrix is not 45 real Gemini calls.
- Cloud HTTP 200: `/disaster-test`, `/dashboard`, `/more`, `/api/health`, `/sw.js`.
- Cloud unauthenticated `POST /api/mock-live/start`: HTTP 403.
- Native Android ASUS_AI2201_A Chrome HTTPS Preview: `Mock Live` panel rendered; inherited Replay collapsed; test banner visible; viewport 411px and document width 411px; initial run button correctly disabled until private key is entered.
- Cloud real Live JMA smoke remains STALE with 0 plans and `movement_authorized=false`, no route call.
- **Cloud authenticated Mock Live + Gemini execution not performed as part of this final P1.6 Preview acceptance**. Must be checked before release-readiness PASS.

## Isolation and release safeguards
- `mode=MOCK_LIVE` outside the nested LiveSnapshot, explicit fake source names and `mock://` references.
- Mock sources are per-session, do not reach real JMA/Tokyo/Ekispert adapters.
- The real domain evaluator and planner are reused; synthetic mode is enabled internally on MockLiveStore only. Ordinary LiveStore default remains `synthetic_mode=False` and rejects mock evidence.
- Mock routes/destinations are empty; mock evidence is synthetic and ineligible for high risk; `movement_authorized=false`.
- `DRILL_ACCESS_KEY` uses existing Secret Manager configuration; no key printed in reports or committed to Git.
- No real alerts, notifications, phone calls, GPS changes, device network toggling or actual battery changes.
- All non-earthquake hazards remain UI-only and cannot be submitted to the real Mock Live or Replay typed engine.
- Severity levels are simulated 72H labels, not a validated JMA intensity conversion. Battery and mobility enter bounded AI context; they do not guarantee a battery-tailored server plan.
- Android TalkBack, system font enlargement, physical battery endurance, iPhone VoiceOver and actual disaster readiness still not validated.

## Release
Keep P1.2 at 100% Production until formal user approval and remaining QA passes. No Git push, merge, or Production promotion.
