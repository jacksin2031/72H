# P1.7 final revised Preview acceptance (2026-10-10 JST)

## Outcome
**PREVIEW PASS / 0% PRODUCTION TRAFFIC; PRODUCTION RELEASE HOLD.**

The initial 421fcb7 Preview exposed a Mock-Live-only client schema incompatibility: historic cases with four milestones exceeded the original three-step cap and the official Live schema rejected `mock://` synthetic sources. The follow-up source commit **a1e9fdddffba18d7b88ea7864f78de70c34d2779** introduced a separate strict Mock Live client parser, retaining the unmodified official `liveSnapshotSchema` for real data. That parser explicitly rejects non-synthetic events/evidence, official-looking mock sources, high-risk movement permission, map mounting and populated real route/destination lists, while validating all other Live structural and reference constraints. Three dedicated automated negative/positive tests pass.

### Immutable Cloud Preview
- Cloud Build: `0b86d6dc-4b21-44c5-b7b5-24973ceb35b7` — SUCCESS
- Container image digest: `sha256:1ff28f728886dae7253e24800e6b1bcd283171065147ec633e3179c62ebb846e`
- Cloud Run: project `h-japan`, region `asia-northeast1`, service `h72`, revision `h72-historyfix-a1e9fdd`
- URL: https://historyfix-a1e9fdd---h72-vux6j7xjka-an.a.run.app/disaster-test
- Production remains `h72-more-0434633` at **100%**. P1.7 Preview **0%**; all previous tagged Previews retained.
- Revision Ready=True, Active=True, ContainerHealthy=True; HTTP 200 `/api/health`, `/disaster-test`, `/api/mock-live/cases`.

### Real Cloud Gemini / bounded Mock Live exercise
- Access without `X-Drill-Key`: HTTP **403**.
- Missing milestones within an explicitly selected historical time range: HTTP **422**.
- Five historical case catalog entries found; 311 milestone times validated.
- Authorized cloud 311 fast-range 14:46–14:49 JST: 2 selected steps.
  1. EARTHQUAKE — real `GEMINI_ADK`, plan version 1.
  2. TSUNAMI_WARNING — context only, **not supported by earthquake-only Safety Core**; retained the prior plan without claiming tsunami evaluation.
- Every recorded evidence entry remained `is_synthetic=true`, `eligible_for_high_risk=false`, no real routes/destinations, no authorized movement, and the Mock session ID was not readable as a real Live session (404).

### Android end-to-end acceptance
- Connected **ASUS_AI2201_A**, Android Chrome, 411px CSS viewport, document width 411px.
- 311 selected by default. Historical accelerated mode selected with default pre-event start at **2011-03-11 13:46 JST**, acceleration **600×**. The clock progressed through 13:56, 14:06 etc. in real elapsed seconds and at approx. 6s reached **14:46 JST**, switched automatically to **1×**.
- No event or AI decision issued during the accelerated *prelude* in the UI. After the 14:46 milestone, the actual cloud Mock Live session advanced to **1/4**, source **FRESH / ONLINE_VERIFIED**, displayed **Gemini/ADK succeeded**, **3 generated Safety Core actions** and **1 synthetic evidence entry**. No UI error, no horizontal overflow.
- A strict ADB/Chrome verification asserted simultaneously: `1×` and Gemini success and `1/4` and action count above zero. Result **PASS**. Afterwards the test page was reloaded, clearing the temporary access key held only in page memory.
- The entire four-milestone 311 run was NOT watched at 1× (historical 14:49 and 15:14 delays take real wall time). The quick-range test above covers partial event execution separately.

### Regression and release gate
- Complete frontend tests **251 PASS, 3 pre-existing SKIP**; backend **150 PASS**; Next.js build, type check and repository secret scan PASS.
- Remains a synthetic-only engineering rehearsal. It does not validate tsunami-specific evacuation logic, actual weather/transport disruptions, physical battery drain, notifications, emergency calls, GPS or real device network outages.
- Screen readers (iOS VoiceOver, Android TalkBack), OS-large-font rendering, genuine low-power device endurance and disaster field readiness remain unverified.
- Branch: `codex/p1-7-historical-drills`. No Git push, merge or Production traffic switch was performed.
