# 72H Hackathon Compliance Checklist

Current vNext release and submission-freeze decision:
[VNEXT_PRODUCTION_RELEASE.md](VNEXT_PRODUCTION_RELEASE.md). The older revision,
test counts and 10/10 replay below are preserved as historical MVP evidence.
Updated Japanese copy, diagram and recording instructions are in
[SUBMISSION_PACKAGE.md](SUBMISSION_PACKAGE.md) and [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

**P2.7 branch note (2026-10-13 JST, local only).** On
`codex/p2-7-explanation-evacuation-routes`, Gemini/ADK no longer selects candidate
intents before Safety Core gating. The real Gemini/ADK path is now the post-Core
explanation endpoints (`/api/{live,replay,mock-live}/{id}/explanation`), which return
whitelisted clause and reference IDs only. The `GEMINI_CANDIDATE_APPLIED` evidence
below belongs to the earlier candidate path. Cloud Run + real Gemini acceptance of
the explanation path is NOT RUN and must be recorded before this branch is
claimed for submission.

**P2.8 branch note (2026-10-14 JST, local only).** On
`codex/p2-8-distress-assist`, 求助輔助新增兩條 Gemini 路徑：(1) distress extract，
經 google-genai 走 Vertex AI，將使用者語音/文字轉成標籤；(2) distress advice，
在使用者明確送出訊號後產生建議。兩者的輸出皆須通過驗證，不能取代 Safety Core
的判定。本機真實 Gemini 冒煙測試已記錄於
[VNEXT_P2_8_VALIDATION.md](VNEXT_P2_8_VALIDATION.md)，但建議的冒煙測試早於使用者訊號門檻，
當時是在沒有使用者訊號下升級；使用者訊號門檻僅由假模型測試涵蓋，
以真實 Gemini 驗證此門檻：NOT RUN。**Cloud Run 驗收 NOT RUN**，
在記錄之前不得宣稱此分支可供提交。

**Current vNext gate: PASS.** Runtime `8d1836e`, Cloud Build
`623824c3-128e-403e-8d12-cc883e699182`, revision `h72-vnext-8d1836e` at 100% traffic.
Canonical API and clean desktop/mobile GUI each completed 11-event replay with
4 plans, 4 real Gemini/ADK candidates and no fallback. Same-session physical
offline/cached reload/reconnect and mock LKL persistence passed. CI ran 69 backend
and 73 frontend tests (3 ignored-fixture skips); fresh deployed replay fixtures
passed all 77 frontend tests locally. Freeze is deferred while external submission
steps below remain pending. Physical-device GPS/battery acceptance is NOT RUN.

## Historical MVP technical gate

**Event:** 第5回 Agentic AI Hackathon with Google Cloud
**Project:** 72H
**Google Cloud project:** `h-japan`
**Audit date:** 2026-10-05 JST
**Verdict:** **TECHNICAL SUBMISSION GATE PASS / EXTERNAL SUBMISSION STEPS PENDING**

Official source: https://zenn.dev/hackathons/google-cloud-japan-ai-hackathon-vol5

## Official submission requirements

| Requirement | Status and evidence |
|---|---|
| Eligible participant / registration | USER-SIDE CONFIRMATION REQUIRED. Registration was reported completed; final dashboard state and participant information remain outside repository verification. |
| Google Cloud application runtime | PASS. Public Cloud Run service `h72` in `asia-northeast1`; revision `h72-00005-vql` serves 100% traffic. |
| Google Cloud AI technology | PASS. Vertex AI / Gemini + Google ADK executed successfully on Cloud Run with `GEMINI_ADK` and no fallback. |
| GitHub repository | PASS for source availability. `jacksin2031/72H`, default branch `main`; Hackathon dashboard GitHub App linkage still needs final dashboard confirmation. |
| Deployed judging URL | PASS. `https://h72-602701455122.asia-northeast1.run.app` is publicly accessible without Google login. |
| Sample data / judge path | PASS. Synthetic Tokyo earthquake replay is built in and explicitly labeled as simulation. |
| Project description | READY. Japanese submission copy is maintained in `SUBMISSION_PACKAGE.md`. |
| Architecture image | READY. `architecture-mvp.svg` and upload-ready `architecture-mvp.png` reflect the deployed system. |
| Approx. 3-minute self-made YouTube demo | CONTENT READY / UPLOAD PENDING. Final recording script is in `DEMO_SCRIPT.md`; YouTube URL still required. |
| Preserve submitted default branch and deployment through 2026-12-01 | PENDING UNTIL FINAL SUBMISSION. Freeze `main` at the submitted SHA and continue later work on another branch. |

Official deadline: **2026-10-15 23:59 JST**.

## Verified product gate

- [x] Replay input enters the real evidence → situation → Safety Core pipeline.
- [x] Four append-only plan versions and twelve actions emerge from the full replay.
- [x] Changed dependencies invalidate stale plans and trigger re-planning.
- [x] Unverified social input remains visible but cannot become trusted action evidence.
- [x] Source trust, publication-time TTL, freshness, conflict and dependency logic are deterministic.
- [x] `No Source → No High-Risk Action` is enforced by deterministic application code.
- [x] Route availability is explicitly separated from disaster safety.
- [x] Gemini/ADK chooses only bounded typed intents/evidence references; server code owns wording, risk, dependencies and publication.
- [x] Missing/invalid model output produces labeled conservative fallback.
- [x] Japanese, English and Traditional Chinese UI are available.
- [x] Public structured trace contains reasons/references without private chain-of-thought.
- [x] Service Worker + IndexedDB + emergency pack support offline continuity and local freshness degradation.
- [x] Reconnection alone does not restore verification; required scoped evidence must be refreshed.
- [x] Backend 51 tests pass; frontend 17 tests pass normally / 18 with real snapshot fixture; typecheck/build/secret scan pass.

## Production verification

### Cloud Run / Gemini / ADK

- Public service: `https://h72-602701455122.asia-northeast1.run.app`
- Revision: `h72-00005-vql`
- Image digest: `sha256:64e1026d3cd46b2e787d9a2866a016a73005b15a2c491bae2f85bf9f3a18f31b`
- Runtime service account: `h72-runtime@h-japan.iam.gserviceaccount.com`
- Public unauthenticated health: PASS
- Public unauthenticated full replay: PASS
- Result: `COMPLETED`, four plans, twelve actions, `GEMINI_ADK`, candidate applied, no Gemini fallback
- Paced production golden-path replay: **10/10 PASS**

### Ekispert MCP

- Provider implementation: PASS
- Local live connectivity: PASS, six MCP tools discovered
- Credential storage: Google Secret Manager, fixed to version 2
- Production smoke: Cloud Run Job `h72-ekispert-smoke-9k6rs` completed successfully
- Important boundary: Ekispert output remains mobility/provider data and is not automatically promoted to disaster-safety evidence.

### Public browser acceptance

Fresh Chromium contexts with no saved cookies/storage or Google authorization:

- Desktop full UI replay: PASS, `11 / 11`
- Plan v4 visible: PASS
- Gemini / ADK label visible: PASS
- Sources and Agent Trace visible: PASS
- `GEMINI_CANDIDATE_APPLIED` visible: PASS
- Desktop console warnings/errors: 0
- 390×844 mobile navigation: PASS
- Mobile console warnings/errors: 0

Screenshots are stored under `output/playwright/cloud-public/`.

## Security / operational gate

- [x] No Google service-account JSON or browser Gemini key in repository.
- [x] Third-party credential is backend-only and supplied from Secret Manager.
- [x] Repository secret-pattern scan passes.
- [x] Runtime uses dedicated service identity and ADC for Vertex AI.
- [x] Model attempt/time/token/session/global limits are implemented.
- [x] Cloud Run is capped at one instance for the Hackathon MVP.
- [x] Billing alert budget exists for `h-japan`: ¥5,000/month, notifications at 50% / 80% / 100%. This is an alert only, not a hard cap.
- [x] Public judging access works without judge credentials.

## Honest scope / non-claims

The following are intentionally **not** claimed as shipped:

- Live JMA disaster feed ingestion
- Live Safety Tips ingestion
- Ekispert route output as verified disaster-safety evidence
- Firestore durable server session persistence
- Cloud Logging export as the product trace store
- A fully decomposed four-agent production orchestration topology
- Live municipal shelter/JARTIC ingestion, hazard/shelter/route overlays
- Web Push/FCM, Rescue Beacon or native background life-protection service
- Real-device GPS/battery endurance acceptance or guaranteed background alarms

The judged MVP uses a synthetic earthquake scenario to exercise the real state, planning, safety, invalidation, offline and reconciliation paths. Synthetic input is always labeled and never presented as live disaster data.

## Submission assets and remaining external steps

- [x] Public Cloud Run judging URL
- [x] GitHub `main` implementation
- [x] Japanese project description draft/final copy
- [x] Final architecture SVG + PNG
- [x] Final three-minute recording script
- [ ] Confirm Hackathon dashboard GitHub App linkage
- [ ] Record self-made ~3 minute demo and publish to YouTube
- [ ] Upload architecture PNG and paste project description / deployed URL
- [ ] Confirm participant information / eligibility in dashboard
- [ ] Submit project before 2026-10-15 23:59 JST
- [ ] Record submitted commit SHA
- [ ] Freeze default branch through 2026-12-01; continue later work on a separate branch

Detailed execution evidence: [VALIDATION.md](VALIDATION.md).
