# 72H Hackathon Compliance Checklist

**Event:** 第5回 Agentic AI Hackathon with Google Cloud

**Project:** 72H / Google Cloud target `h-japan`

**Audit date:** 2026-10-05 JST

**Verdict:** **PARTIAL — NOT SUBMISSION READY**

[Official event rules](https://zenn.dev/hackathons/google-cloud-japan-ai-hackathon-vol5)
were checked again on the audit date. Official requirements and the repository's
stricter product requirements are distinguished below. Detailed local evidence
is in [VALIDATION.md](VALIDATION.md).

## Official submission requirements

The event requires at least one listed Google Cloud application runtime and at
least one listed AI technology. Cloud Run, Gemini and ADK are eligible choices;
the event does not require all three together. **72H's own AGENTS.md requires
material Cloud Run and Gemini use, plus real ADK integration if claimed.**

| Requirement | Status and evidence |
|---|---|
| Eligible participant(s), registration for all team members | UNVERIFIED. Residence/age/exclusion conditions need personal confirmation. An earlier repository checkbox asserted registration; no account evidence was supplied. |
| Google Cloud application runtime | IMPLEMENTED / NOT DEPLOYED. Cloud Run container and private staging script prepared; no deployed service or image digest. |
| Google Cloud AI technology | IMPLEMENTED / NOT LIVE VERIFIED. Locked ADK and Vertex/Gemini execution path exist; local calls without ADC fell back. |
| GitHub App repository integration | UNVERIFIED. Target repository is `jacksin2031/72H`; linkage and default-branch implementation have not been verified. |
| Deployed judging URL and usable sample data | PARTIAL. Synthetic sample replay works locally; no judging URL or clean-cloud-browser acceptance. |
| Project explanation, architecture image, self-made approximately 3-minute YouTube demo | PARTIAL. Japanese summary, script and SVG draft exist; final uploads/video remain pending. |
| Preserve submitted default branch and runnable deployment until 2026-12-01 | PENDING. Submission SHA and service are not yet established. |

The event schedule lists the registration/submission deadline as **2026-10-15**.
Zenn article publication is optional. A private staging URL requiring Google IAM
login is not yet suitable judging access; configure public access after acceptance
or provide a supported test account with sample data.

## Implemented local product gate

Checked items below describe local synthetic replay, not live disaster data or
deployed cloud behavior.

- [x] Replay events enter the actual evidence → situation → Safety Core pipeline.
- [x] Relevant state/dependency changes generate plans without timeline-specific
  UI branches or a manually authored plan for each replay step.
- [x] Four append-only plan versions emerge from the complete replay; social
  content does not trigger a trusted replan.
- [x] Source registry restricts claim type/key/value; invalid input is rejected
  before mutation.
- [x] Publication-time TTL, conflicts, expiry and action dependencies are
  deterministic. Route availability never becomes route safety.
- [x] Synthetic/unverified/stale evidence cannot authorize high-risk movement.
- [x] Immutable evidence/plan publications remain separate from evaluations.
- [x] Typed intent/evidence candidate output is validated before publication.
- [x] Public trace uses structured reasons/references; no private thoughts.
- [x] Japanese, English and Traditional Chinese UI and server-owned action text.
- [x] Service Worker shell, IndexedDB snapshot, static emergency pack and local
  age/expiration logic retain a nonempty plan during actual offline reload.
- [x] Replay reconnect requires newly received eligible official and transport
  evidence after restoration. Actual browser restoration without new evidence
  correctly stays RECONNECTING.
- [x] Missing server session exposes a new-demo recovery control.
- [x] Backend 51 tests (40 original + 11 Ekispert), frontend 18 with real snapshot,
  typecheck and build pass.
- [x] Independent reproduction closes source-scope and reconnect P1 findings.

## Google AI scope and honest claims

The implemented ADK agent selects from a closed catalog of safe action intents
and current eligible evidence IDs. The server owns risk, dependencies, wording
and publication. A model selection can affect changed action categories only;
unchanged actions and historical publications are preserved.

The broader specification's semantic source extraction, ambiguity detection and
separate Situation/Source/Mobility agents are **future work**, not shipped claims.
Live JMA/Safety Tips/transport evidence normalization, Firestore and Cloud Logging
export are also not implemented. The Ekispert MCP provider boundary is implemented
and tested separately; no successful live connection is claimed. Current traces
are application trace records.

- [x] Actual SDK and ADK boundaries are integrated and tested with controlled
  provider responses, including the real installed SDK response Part type.
- [x] Actual SDK attempt without ADC produces labeled TIMEOUT/MISSING_ADC fallback.
- [ ] Successful credentialed Gemini request and `GEMINI_ADK` trace recorded.
- [ ] Successful model output changes a real candidate plan in Cloud Run.
- [ ] Demo recording shows that actual execution and its deterministic guard.

Fallback is operational resilience, **not evidence that required Gemini use has
been satisfied**. Do not record or submit a fallback run as real-model success.

## Security and operational gate

Normative policy: [SECURITY_AND_SECRETS.md](SECURITY_AND_SECRETS.md).

- [x] No static Google credential, browser model key or secret env value added.
- [x] Env examples contain non-secret configuration only; private env/key files
  are ignored. Local secret-pattern gate passes (not a comprehensive audit).
- [x] Browser schemas project approved data; snapshots/SW exclude credentials and
  API/authenticated responses.
- [x] Structured outputs, one model attempt, timeout, token cap, session/global
  call limits, bounded session storage and sanitized failure codes implemented.
- [x] Source-hashed Cloud Shell export and manifest verification implemented.
- [ ] `h-japan` project access, billing, APIs and runtime IAM verified.
- [ ] Docker/Cloud Build image and Cloud Run service identity / ADC verified.
- [ ] Cloud budget alerts and public abuse/cost acceptance completed.
- [ ] Deployed fresh-browser, real-model, offline and restart acceptance passed.

Third-party secret storage is not exercised: replay uses synthetic input and no
configured third-party key. The Ekispert adapter requires a backend key for live
use; production must use Secret Manager. Firestore/Logging
identity claims remain pending with those integrations. Server sessions currently
live in one process and are lost on restart; cached browser recovery does not
provide durable cloud persistence.

## Submission assets and final gate

- [x] Japanese summary draft and approximately three-minute script:
  [DEMO_SCRIPT.md](DEMO_SCRIPT.md).
- [x] Exported [architecture-mvp.svg](architecture-mvp.svg) shows implemented
  local boundaries and marks cloud deployment / future integrations as pending.
- [x] README identifies implemented components, dependencies and limitations.
- [x] [DEPLOYMENT.md](DEPLOYMENT.md) provides the selected Cloud Shell procedure.
- [ ] Final description and diagram checked against the actual deployed revision.
- [ ] GitHub integration and submitted default-branch SHA recorded.
- [ ] Judging URL accessible without requiring judges' API keys or Google login.
- [ ] Architecture image and accessible self-made YouTube demo uploaded.
- [ ] Eligibility/registration confirmed and submission completed.
- [ ] Default branch frozen; further work moved to another branch; deployed
  service remains runnable through 2026-12-01.

## Current execution boundary

The selected Cloud Shell browser reached Google sign-in only. No cloud login,
resource creation, build, deploy or public release was performed. The local MVP,
tests, diagram and reviewable deployment source are prepared. **Cloud Run actual
use, successful Gemini actual use and submission assets remain blocking items.**
