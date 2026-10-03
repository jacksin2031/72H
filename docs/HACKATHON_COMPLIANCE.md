# 72H Hackathon Compliance Checklist

**Event:** 第5回 Agentic AI Hackathon with Google Cloud  
**Project:** 72H  
**Status:** Design-compliant; implementation and submission evidence pending  
**Submission deadline:** 2026-10-15 23:59 JST  
**Final judging date:** 2026-12-01

Official event page: https://zenn.dev/hackathons/google-cloud-japan-ai-hackathon-vol5

---

## 1. Participation Eligibility

Official requirement:
- Participant must reside in Japan.
- Participant must be at least 18 years old.
- Individuals and teams are allowed.
- Certain excluded categories apply, including government employees and event/sponsor-related personnel.

### 72H status

- [ ] Participant eligibility personally confirmed before submission.
- [ ] Participant registration completed.
- [ ] If submitting as a team, every member has completed registration.

**Release gate:** Do not submit until all participant eligibility requirements are confirmed.

---

## 2. Required Google Cloud Application Runtime

The project must use at least one approved Google Cloud application execution product.

72H selected runtime:

- **Cloud Run**

Planned use:

```text
72H Web/API
   ↓
Cloud Run
   ↓
FastAPI / Agent Runtime
```

### Compliance evidence required

- [ ] Production or judging deployment exists on Google Cloud.
- [ ] Cloud Run service URL is reachable by judges.
- [ ] Core project functionality is actually served through Cloud Run.
- [ ] Deployment remains available until 2026-12-01.

### Current status

**DESIGN: PASS**  
**IMPLEMENTATION: PENDING**

---

## 3. Required Google Cloud AI Technology

The project must use at least one approved Google Cloud AI technology.

72H selected technologies:

- **Gemini**
- **Agent Development Kit (ADK)**

Planned responsibilities:

### Gemini / ADK

- Situation interpretation
- Evidence claim extraction
- Ambiguity detection
- Candidate action planning
- Multilingual user-facing explanations
- Agent orchestration

### Deterministic application code

- Source trust classification
- Freshness / TTL
- Plan expiration
- Plan invalidation
- Safety blocking
- Replay determinism
- Offline degradation

This separation is intentional: the model participates materially in the system, while safety-critical state transitions are not delegated to unconstrained free-form reasoning.

### Compliance evidence required

- [ ] Gemini is called by a real execution path.
- [ ] ADK is integrated into the real agent runtime.
- [ ] Gemini output affects the actual candidate-plan pipeline.
- [ ] Repository clearly identifies which parts are agentic and which are deterministic.
- [ ] Demo shows at least one real agent-driven interpretation or planning step.

### Current status

**DESIGN: PASS**  
**IMPLEMENTATION: PENDING**

---

## 4. Real Implementation vs Mocking

Official guidance requires the repository to contain enough implementation to demonstrate that the project's major functionality is real rather than merely mocked.

72H uses a deterministic **Replay Mode**, but replay only controls external event timing and input data.

Allowed architecture:

```text
Replay Event
   ↓
Real Evidence Pipeline
   ↓
Real Situation State
   ↓
Real Agent Runtime
   ↓
Real Safety Core
   ↓
Real Dependency Evaluation
   ↓
Real Plan Invalidation
   ↓
Real Re-planning
```

Not acceptable:

```text
Replay Step 3
   ↓
Hard-coded "show Plan v2"
```

### Release checks

- [ ] Replay events are data, not pre-rendered UI states.
- [ ] Plan invalidation is caused by dependency/state changes.
- [ ] Re-planning executes through the same plan pipeline used outside replay.
- [ ] Safety decisions are calculated from current evidence state.
- [ ] No critical demo outcome is implemented as a timeline-specific hard-coded UI branch.
- [ ] README explains what is simulated and what is real.

### Current status

**DESIGN: PASS**  
**IMPLEMENTATION: PENDING**

---

## 5. GitHub Repository Requirement

Official submission requires a linked GitHub repository. Public or private repositories are accepted.

72H repository:

`jacksin2031/72H`

### Current repository evidence

- `README.md`
- `docs/PRODUCT_SPEC.md`
- `docs/REPLAY_SCENARIO.md`
- `docs/AGENT_SAFETY_CONTRACT.md`
- `docs/OFFLINE_CONTINUITY.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/HACKATHON_COMPLIANCE.md`

### Submission checks

- [ ] Repository linked from the hackathon dashboard using the required GitHub integration.
- [ ] Default branch contains the submitted implementation.
- [ ] No secrets, API keys, credentials, or private user data are committed.
- [ ] README identifies hackathon-built components and external dependencies.

### Current status

**PASS — repository exists**  
**SUBMISSION LINKING: PENDING**

---

## 6. Deployment URL Requirement

A deployed URL must be submitted.

For 72H:

- Browser-based judging experience preferred.
- No required social login.
- Demo should open directly or use a simple judge-friendly test flow.

### Release checks

- [ ] Cloud Run deployment URL created.
- [ ] URL works in a clean browser session.
- [ ] No local environment is required.
- [ ] If authentication exists, a dedicated test account is provided.
- [ ] Login does not require email OTP or social login.
- [ ] Sample scenario/data is already available to judges.
- [ ] Deployment remains available through 2026-12-01.

### Current status

**PENDING**

---

## 7. Project Description Requirement

Official submission requires a description covering:

- Target users
- Problem
- Solution
- Key characteristics

72H target user:

> Foreign visitors and residents in Japan who may receive disaster information but do not know how to convert it into context-specific next actions.

Core problem:

> Disaster alerts explain what happened, but users may still not know what to do next as transport, official information, connectivity, and personal circumstances change.

Core solution:

> 72H continuously transforms verified disaster and mobility information into evidence-backed NOW / NEXT / AVOID plans and autonomously re-evaluates those plans when the situation changes.

Key characteristics:

- Evidence-backed planning
- Autonomous plan invalidation and re-planning
- Source provenance
- Unverified-information rejection
- Offline continuity
- Explainable plan changes

### Release checks

- [ ] Final 200–300 Japanese-character project summary prepared.
- [ ] Full project description prepared for submission page.
- [ ] Description matches actual shipped implementation.

### Current status

**DRAFT READY**

---

## 8. Architecture Diagram Requirement

The submission requires an architecture diagram image.

The textual architecture already exists in:

`docs/ARCHITECTURE.md`

### Diagram must show

- Browser / PWA
- Cloud Run
- FastAPI backend
- Google ADK
- Gemini
- Situation Agent
- Source Agent
- Mobility Agent
- Action Agent
- Deterministic Safety Core
- Firestore
- Cloud Logging
- External disaster/mobility sources
- IndexedDB / Service Worker offline path

### Release checks

- [ ] Architecture diagram exported as PNG or SVG.
- [ ] Google Cloud components are visually obvious.
- [ ] Online path is shown.
- [ ] Offline continuity path is shown.
- [ ] Agent vs deterministic safety boundaries are visible.
- [ ] Diagram matches the deployed architecture.

### Current status

**TEXT DESIGN: PASS**  
**IMAGE: PENDING**

---

## 9. Demo Video Requirement

Official requirement:

- Approximately 3 minutes
- Self-produced
- Published on YouTube
- URL submitted in project dashboard

72H demo scenario is defined in:

`docs/REPLAY_SCENARIO.md`

### Required demo beats

1. User is in Tokyo with an existing travel plan.
2. Earthquake event arrives.
3. Verified evidence is ingested.
4. Plan v1 is generated.
5. Transport state changes.
6. Existing plan dependency becomes invalid.
7. 72H autonomously invalidates/re-plans.
8. Unverified social information is rejected as action evidence.
9. Network connectivity is lost.
10. 72H enters Continuity Mode and retains the Last Verified Plan.
11. Network returns.
12. System synchronizes, verifies, and re-evaluates.
13. Trace/source views demonstrate observability.

### Release checks

- [ ] Demo is approximately 3 minutes.
- [ ] Product UI is visible and readable.
- [ ] At least one true agent decision is shown.
- [ ] At least one deterministic safety decision is shown.
- [ ] Re-planning is visibly triggered by situation change.
- [ ] Offline degradation is demonstrated.
- [ ] YouTube URL is public/unlisted and accessible to judges.

### Current status

**SCENARIO: PASS**  
**VIDEO: PENDING**

---

## 10. Judging Criterion: Novelty and Solution Effectiveness

Official judging focus:

> Does the project identify a meaningful problem that remains insufficiently solved, and does the solution address the core problem effectively?

72H differentiation:

Existing disaster services commonly focus on:

- Alert delivery
- Official information display
- Translation
- Static evacuation guidance

72H focuses on:

```text
Alert
→ Verified Situation
→ Personal Context
→ Action Plan
→ Situation Change
→ Plan Invalidation
→ Autonomous Re-plan
```

### Evidence to strengthen before submission

- [ ] At least 1–3 target-user interviews completed if feasible.
- [ ] README explains how 72H differs from ordinary alert/translation apps.
- [ ] Demo clearly shows changing context, not only a one-time answer.

### Current status

**CONCEPT: STRONG**  
**USER VALIDATION: PENDING**

---

## 11. Judging Criterion: Autonomy and Agentic Behavior

Official judging focus includes autonomous judgment, controlled autonomy, observability, and security.

72H agent loop:

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

### Required evidence

- [ ] Agent is not merely invoked manually for every step.
- [ ] Relevant external-state changes can trigger plan review.
- [ ] Agent produces structured candidate actions.
- [ ] Safety Core can allow/modify/block outputs.
- [ ] Trace shows important lifecycle events.
- [ ] Security boundaries are documented.

### Current status

**DESIGN: STRONG**  
**IMPLEMENTATION: PENDING**

---

## 12. Judging Criterion: Implementation Quality and Scalability

72H design elements supporting this criterion:

- Adapter-based external-source architecture
- Firestore domain model
- Structured agent outputs
- Deterministic Safety Core
- Evidence provenance
- Plan versioning
- PWA offline continuity
- IndexedDB snapshots
- Cloud Logging
- Replay-based deterministic testing

### Required evidence

- [ ] Automated safety tests pass.
- [ ] Replay produces stable core transitions.
- [ ] Cloud Run deployment is stable.
- [ ] Failure handling exists for model/API/network errors.
- [ ] Cost-sensitive design is explained.
- [ ] External adapters are replaceable.

### Current status

**DESIGN: STRONG**  
**IMPLEMENTATION: PENDING**

---

## 13. Offline Continuity Compliance Note

Offline functionality does not replace the required Google Cloud runtime.

Normal mode remains cloud-backed:

```text
External Sources
→ Cloud Run
→ ADK / Gemini
→ Safety Core
→ Firestore
→ Client Sync
```

Offline mode is a resilience layer:

```text
Network Lost
→ Cached UI
→ Last Verified Situation
→ Last Verified Plan
→ Local Evidence Freshness
→ Local Safety Degradation
```

The project must never claim that stale cached information is current.

### Release checks

- [ ] Connectivity status is explicit in UI.
- [ ] Last verified timestamp is always visible offline.
- [ ] Transport-dependent actions expire/degrade locally.
- [ ] Offline mode cannot fabricate new official disaster information.
- [ ] Reconnection triggers sync and re-evaluation.

### Current status

**DESIGN: PASS**  
**IMPLEMENTATION: PENDING**

---

## 14. Repository Freeze Requirement

Official rule:

- The submitted default branch must remain in its submitted state through 2026-12-01.
- Deployment must remain operational during judging.
- Continued development after submission should occur on another branch.

Recommended process:

```text
Before 2026-10-15
main = submission candidate

After final submission
main = frozen
post-submission-development = continued work
```

### Release checks

- [ ] Final submission commit SHA recorded.
- [ ] Default branch frozen after submission.
- [ ] No submission content modified after deadline.
- [ ] Separate development branch created if continued work is needed.
- [ ] Cloud deployment remains live through 2026-12-01.

### Current status

**PENDING**

---

## 15. Security and Secret Handling

### Required

- [ ] No Gemini/API credentials in repository.
- [ ] No Google Cloud service account private keys in repository.
- [ ] `.env*` secrets excluded.
- [ ] External input is treated as untrusted data.
- [ ] Prompt-injection-like instructions from source content cannot become system instructions.
- [ ] Agent permissions are role-limited.
- [ ] Source trust cannot be overridden by model output.

### Current status

**DESIGN: PASS**  
**IMPLEMENTATION AUDIT: PENDING**

---

## 16. Final Submission Gate

72H must not be marked `SUBMISSION READY` until every item below is complete.

### Mandatory technology

- [ ] Cloud Run is actually used.
- [ ] Gemini is actually used.
- [ ] ADK is actually used if claimed in submission.

### Product

- [ ] Situation state works.
- [ ] Evidence provenance works.
- [ ] Plan v1 generation works.
- [ ] Dependency-based invalidation works.
- [ ] Autonomous re-planning works.
- [ ] Unverified-source rejection works.
- [ ] Agent trace works.
- [ ] Offline Continuity Mode works.
- [ ] Reconnect reconciliation works.

### Quality

- [ ] Replay scenario is deterministic at the state-transition level.
- [ ] Safety tests pass.
- [ ] No critical demo path depends on hard-coded outcome rendering.
- [ ] No secrets committed.
- [ ] Clean-browser smoke test passes.

### Submission assets

- [ ] GitHub repository linked.
- [ ] Google Cloud deployment URL submitted.
- [ ] Project description finalized.
- [ ] Architecture diagram image uploaded.
- [ ] Approximately 3-minute YouTube demo uploaded.
- [ ] Judge usage instructions prepared.

### Post-submission

- [ ] Default branch frozen.
- [ ] Submission commit SHA recorded.
- [ ] Deployment availability monitored through 2026-12-01.

---

# Current Compliance Verdict

```text
72H REGULATION DESIGN CHECK: PASS
72H REQUIRED TECHNOLOGY DESIGN: PASS
72H AGENTIC DESIGN: PASS
72H SAFETY / OBSERVABILITY DESIGN: PASS
72H SUBMISSION READINESS: NOT READY
```

Reason:

The design satisfies the hackathon's current published requirements, but implementation, Cloud Run deployment, real Gemini/ADK integration, submission assets, and final verification are still pending.

This document should be treated as a release gate and updated as implementation evidence becomes available.
