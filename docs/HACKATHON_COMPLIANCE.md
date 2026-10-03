# 72H Hackathon Compliance Checklist

**Event:** 第5回 Agentic AI Hackathon with Google Cloud  
**Project:** 72H  
**Status:** Design-compliant; implementation and submission evidence pending  
**Submission deadline:** 2026-10-15 23:59 JST  
**Final judging date:** 2026-12-01

Official event page: https://zenn.dev/hackathons/google-cloud-japan-ai-hackathon-vol5

---

## 1. Participation Eligibility

- [ ] Participant eligibility personally confirmed before submission.
- [x] Participant registration completed.
- [ ] If submitting as a team, every member has completed registration.

---

## 2. Required Google Cloud Runtime

72H selected runtime:

- **Cloud Run**

Required evidence:

- [ ] Production/judging deployment exists on Google Cloud.
- [ ] Cloud Run URL is reachable by judges.
- [ ] Core functionality is actually served through Cloud Run.
- [ ] Deployment remains available through 2026-12-01.

**DESIGN: PASS**  
**IMPLEMENTATION: PENDING**

---

## 3. Required Google Cloud AI Technology

72H selected technologies:

- **Gemini through Vertex AI**
- **Agent Development Kit (ADK)**

Gemini/ADK responsibilities:

- situation interpretation
- evidence claim extraction
- ambiguity detection
- candidate action planning
- multilingual explanation
- agent orchestration

Deterministic application code remains responsible for:

- source trust
- freshness / TTL
- plan expiration
- plan invalidation
- safety blocking
- replay determinism
- offline degradation

Required evidence:

- [ ] Gemini is called by a real execution path.
- [ ] ADK is integrated into the real runtime if claimed.
- [ ] Model output affects the real candidate-plan pipeline.
- [ ] Demo shows at least one real agent-driven interpretation/planning step.

**DESIGN: PASS**  
**IMPLEMENTATION: PENDING**

---

## 4. Real Implementation vs Replay

Replay is allowed only as deterministic input/control infrastructure. It must not fake the core agent outcome.

Expected flow:

```text
Replay Event
→ Real Evidence Pipeline
→ Real Situation State
→ Real Gemini/ADK path
→ Real Safety Core
→ Real Dependency Evaluation
→ Real Plan Invalidation
→ Real Re-planning
```

Forbidden shortcut:

```text
Replay Step 3
→ hard-coded "show Plan v2"
```

Release checks:

- [ ] Replay events are data, not pre-rendered states.
- [ ] Plan invalidation is caused by dependency/state change.
- [ ] Re-planning uses the real planning pipeline.
- [ ] Safety decisions are computed from current evidence.
- [ ] No critical demo outcome is timeline-hard-coded.

---

## 5. Repository Requirement

Repository:

`jacksin2031/72H`

Current design documentation includes:

- `README.md`
- `docs/PRODUCT_SPEC.md`
- `docs/REPLAY_SCENARIO.md`
- `docs/AGENT_SAFETY_CONTRACT.md`
- `docs/OFFLINE_CONTINUITY.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/HACKATHON_COMPLIANCE.md`
- `docs/SECURITY_AND_SECRETS.md`

Submission checks:

- [ ] Repository linked through the Hackathon GitHub integration.
- [ ] Default branch contains submitted implementation.
- [ ] README identifies Hackathon-built components and dependencies.
- [ ] No secrets, credentials, or private user data are committed.

---

## 6. Deployment URL

- [ ] Cloud Run deployment URL created.
- [ ] URL works in a clean browser session.
- [ ] No local setup is required for judges.
- [ ] Judges are not required to provide their own API key.
- [ ] Sample replay data is ready.
- [ ] Deployment remains available through 2026-12-01.

**STATUS: PENDING**

---

## 7. Project Description

72H targets foreign visitors and residents in Japan who may receive disaster information but still do not know how to convert it into context-specific next actions.

Core flow:

```text
Alert
→ Verified Situation
→ Personal Context
→ Action Plan
→ Situation Change
→ Plan Invalidation
→ Autonomous Re-plan
```

Release checks:

- [x] 200–300-character Japanese summary drafted.
- [ ] Full project description finalized.
- [ ] Description verified against shipped behavior.

---

## 8. Architecture Diagram

Final architecture image must show:

- Browser / PWA
- Cloud Run
- runtime service account / ADC boundary
- Vertex AI / Gemini
- Google ADK
- Situation / Source / Mobility / Action Agents
- deterministic Safety Core
- Firestore
- Cloud Logging
- Secret Manager
- external disaster/mobility sources
- IndexedDB / Service Worker offline path

Release checks:

- [ ] PNG or SVG exported.
- [ ] Google Cloud components are obvious.
- [ ] Agent vs deterministic boundaries are visible.
- [ ] Credential boundary is visible.
- [ ] Offline continuity path is visible.
- [ ] Diagram matches deployment.

---

## 9. Demo Video

Target: approximately 3 minutes.

Required beats:

1. Existing Tokyo travel plan.
2. Earthquake event.
3. Verified evidence ingested.
4. Plan v1 generated.
5. Transport condition changes.
6. Existing plan becomes invalid.
7. Autonomous re-plan occurs.
8. Unverified social information is rejected.
9. Network is lost.
10. Continuity Mode retains Last Verified Plan.
11. Network returns.
12. Sync → verify → re-evaluate occurs.
13. Sources/trace demonstrate observability.

Release checks:

- [ ] Product UI readable in video.
- [ ] At least one genuine agent step shown.
- [ ] At least one deterministic safety decision shown.
- [ ] Offline degradation shown.
- [ ] YouTube URL accessible to judges.

---

## 10. Judging: Novelty and Effectiveness

72H differentiates from ordinary alert/translation apps by focusing on changing action plans under changing evidence and connectivity.

Evidence to strengthen:

- [ ] 1–3 target-user interviews if feasible.
- [ ] README explicitly compares 72H with static alert/translation workflows.
- [ ] Demo shows changing context, not only one answer.

---

## 11. Judging: Agentic Behavior

Target agent loop:

```text
Observe
→ Verify
→ Update Situation
→ Evaluate Existing Plan
→ Detect Relevant Change
→ Invalidate Dependencies
→ Re-plan
→ Explain
→ Monitor
```

Required evidence:

- [ ] Relevant state changes can trigger plan review without a user manually asking every time.
- [ ] Agents produce structured candidate actions.
- [ ] Safety Core can allow/modify/block candidate output.
- [ ] Trace records lifecycle events.

---

## 12. Judging: Implementation Quality

Expected engineering evidence:

- [ ] adapter-based source architecture
- [ ] structured agent outputs
- [ ] deterministic Safety Core
- [ ] evidence provenance
- [ ] plan versioning
- [ ] PWA offline continuity
- [ ] IndexedDB snapshots
- [ ] Cloud Logging
- [ ] deterministic replay tests
- [ ] failure handling for model/API/network errors

---

## 13. Offline Continuity

Offline functionality complements rather than replaces required Google Cloud execution.

Normal path:

```text
External Sources
→ Cloud Run
→ ADK / Gemini
→ Safety Core
→ Firestore
→ Client Sync
```

Offline path:

```text
Network Lost
→ Cached UI
→ Last Verified Situation
→ Last Verified Plan
→ Local Evidence Freshness
→ Local Safety Degradation
```

Release checks:

- [ ] Connectivity state explicit in UI.
- [ ] Last verified timestamp visible offline.
- [ ] Live-dependent actions expire/degrade locally.
- [ ] Offline mode cannot fabricate current official information.
- [ ] Reconnection triggers sync and re-evaluation.

---

## 14. Security and Secret Handling

Normative document:

`docs/SECURITY_AND_SECRETS.md`

### Google Cloud credentials

Production must use a dedicated Cloud Run runtime service account and Application Default Credentials where possible.

Required:

- [ ] No checked-in service-account JSON key.
- [ ] No Gemini API key required in the browser.
- [ ] Vertex AI/Gemini works through Cloud Run service identity / ADC.
- [ ] Firestore/Logging access uses service identity / ADC.

### Third-party credentials

Required:

- [ ] Third-party API keys/tokens are stored in Secret Manager.
- [ ] Only the backend runtime can read them.
- [ ] Secret access follows least privilege.

### Browser / offline

Required:

- [ ] No privileged value is exposed via `NEXT_PUBLIC_*`.
- [ ] IndexedDB contains no secrets.
- [ ] Service Worker caches no credentials.
- [ ] Replay fixtures contain no credentials.

### Git / local development

Required:

- [ ] `.env`, `.env.local`, `.env.*`, private keys, and service-account JSON files are ignored.
- [ ] `.env.example` contains placeholders only.
- [ ] Local Google Cloud development uses ADC where possible.

### Logging

Required:

- [ ] Logs do not expose API keys, access tokens, authorization headers, or Secret Manager values.

### Public demo abuse/cost controls

Required before public judging:

- [ ] reasonable per-session limits
- [ ] request/agent-cycle bounds
- [ ] backend timeouts
- [ ] Google Cloud budget alerts

**DESIGN: PASS**  
**IMPLEMENTATION AUDIT: PENDING**

---

## 15. Repository Freeze

After final submission:

```text
main = frozen submission
post-submission-development = continued work
```

Release checks:

- [ ] Final submission commit SHA recorded.
- [ ] Default branch frozen through 2026-12-01.
- [ ] Continued work uses another branch.
- [ ] Deployment remains live.

---

## 16. Final Submission Gate

72H must not be marked `SUBMISSION READY` until all mandatory items are complete.

### Mandatory technology

- [ ] Cloud Run actually used.
- [ ] Gemini actually used.
- [ ] ADK actually used if claimed.

### Product

- [ ] Situation state works.
- [ ] Evidence provenance works.
- [ ] Plan v1 generation works.
- [ ] Dependency invalidation works.
- [ ] Autonomous re-planning works.
- [ ] Unverified-source rejection works.
- [ ] Agent trace works.
- [ ] Offline Continuity works.
- [ ] Reconnect reconciliation works.

### Security

- [ ] Cloud Run runtime identity configured.
- [ ] No static Google Cloud credential in repository.
- [ ] Third-party secrets stored in Secret Manager.
- [ ] No browser/offline secrets.
- [ ] Secret scan passes.
- [ ] Budget/rate safeguards configured.

### Quality

- [ ] Replay is deterministic at the state-transition level.
- [ ] Safety tests pass.
- [ ] No critical demo path uses hard-coded outcome rendering.
- [ ] Clean-browser smoke test passes.

### Submission assets

- [ ] GitHub repository linked.
- [ ] Google Cloud deployment URL submitted.
- [ ] Project description finalized.
- [ ] Architecture diagram uploaded.
- [ ] Approximately 3-minute YouTube demo uploaded.
- [ ] Judge usage instructions prepared.

### Post-submission

- [ ] Default branch frozen.
- [ ] Submission SHA recorded.
- [ ] Deployment monitored through 2026-12-01.

---

# Current Compliance Verdict

```text
72H REGULATION DESIGN CHECK: PASS
72H REQUIRED TECHNOLOGY DESIGN: PASS
72H AGENTIC DESIGN: PASS
72H SAFETY / OBSERVABILITY DESIGN: PASS
72H CREDENTIAL / SECRET DESIGN: PASS
72H SUBMISSION READINESS: NOT READY
```

Reason:

The design is aligned with the current published Hackathon requirements, but implementation, Cloud Run deployment, real Gemini/ADK integration, credential configuration, submission assets, and final verification remain pending.
