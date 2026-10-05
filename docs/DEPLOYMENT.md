# 72H deployment runbook

Target project: **h-japan**. Cloud Run region: **asia-northeast1**.

The current vNext release identity and acceptance gates are tracked in
[VNEXT_PRODUCTION_RELEASE.md](VNEXT_PRODUCTION_RELEASE.md). Stable rollback
revision: `h72-00005-vql`.

Current public service: **https://h72-602701455122.asia-northeast1.run.app**.
Current revision: `h72-vnext-8d1836e` (100% traffic). Runtime source: `8d1836e`.
Image digest: `sha256:9d7e22b877aff64502903cfe90b233c8365a8df065e8e3b75fee5bcda6eb3005`.
Runtime service account: `h72-runtime@h-japan.iam.gserviceaccount.com`.
Secret Manager injects `EKISPERT_API_ACCESS_KEY` from `h72-ekispert-api-key:2`.
The service is publicly invokable for judging; `max-instances=1` and application
rate/model limits remain enabled.

## Repeatable route: Google Cloud Shell

The production deployment was completed with an authenticated portable Google
Cloud CLI on the authorized Windows machine. The Cloud Shell bundle remains a
repeatable fallback/review path.
Open [Cloud Shell for h-japan](https://shell.cloud.google.com/?project=h-japan)
in your authenticated browser. Cloud Shell includes the Google Cloud CLI; see
[the official Cloud Shell guide](https://docs.cloud.google.com/shell/docs/using-cloud-shell).

Upload `output/cloud-shell/72h-cloud-shell-source.zip` with Cloud Shell's upload
control, then run:

```bash
TASK_SOURCE_DIR="$(mktemp -d -t 72h-source-XXXXXX)"
unzip -q 72h-cloud-shell-source.zip -d "$TASK_SOURCE_DIR"
cd "$TASK_SOURCE_DIR/72h"
python3 scripts/verify_cloud_bundle.py
bash infra/cloud-run/deploy-cloud-shell.sh
```

This performs read-only project/billing/API checks. The exported bundle includes
`bundle-manifest.json` with hashes for each source file. Verify it before building;
the source snapshot hash identifies uncommitted content accurately. Do not use
the baseline documentation commit as the implementation identity.

After the prerequisites below are met and budget controls reviewed, run:

```bash
bash infra/cloud-run/deploy-cloud-shell.sh --deploy
```

The legacy script targets the existing `h72` service, does not use `--no-traffic`,
and passes `--no-allow-unauthenticated`. It is **not** the preview route for an
existing public service and may change traffic/IAM. Use the digest-pinned,
zero-traffic procedure below for release staging. A tagged revision inherits the
service's public invoker policy; it is not private staging. A genuinely private
staging service requires a separate service and reviewed IAM.
The commands below work in Cloud Shell Bash and PowerShell; the later release-tag
example uses PowerShell variables.

## Runtime boundary

One container runs Next.js on `$PORT` and a private FastAPI process on
`127.0.0.1:8000`. Only Next.js is public. API payloads are validated and replay
sessions are bounded. Service-account credentials are supplied by Cloud Run;
never mount a service-account JSON key or expose a model key in the browser.

Sessions currently live in process memory. Instance replacement loses server
sessions; the browser retains a snapshot and must start a new demo. Restrict the
demo to one instance and one Python worker. This does not provide durable state.
Firestore is a future persistence integration; session affinity is only best
effort and cannot replace persistence. See [Google's session-affinity guidance](https://docs.cloud.google.com/run/docs/configuring/session-affinity).

The configured Gemini model is `gemini-3.5-flash-lite`, using endpoint `global`.
The [official model page](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite)
lists structured output support and availability through July 2027 or later.
This endpoint is separate from the Cloud Run region; no Japan-only model
processing residency is claimed. Verify project access and model compatibility
with the installed ADK before deployment. Gemini 2.5 retirement precedes judging;
avoid using it as a submission default.

## Prepare Google Cloud

Run with an authenticated Google Cloud CLI account that can manage **h-japan**.
Review the project's existing resources before creating duplicates. Enable
Cloud Run, Artifact Registry, Cloud Build and Vertex AI APIs, configure billing
budget alerts, and create a dedicated runtime identity. Budget alerts are
notifications, not a hard spending cap.

```bash
gcloud projects describe h-japan
gcloud billing projects describe h-japan
gcloud artifacts repositories describe h72 --location asia-northeast1 --project h-japan
gcloud iam service-accounts describe h72-runtime@h-japan.iam.gserviceaccount.com --project h-japan
```

Use the following setup commands only for missing resources / required role
bindings after checking the existing configuration. Cloud Shell already has an
authenticated CLI session after Google sign-in; deployed Gemini uses the runtime
identity. Local model development separately requires ADC login.

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com secretmanager.googleapis.com --project h-japan
gcloud artifacts repositories create h72 --repository-format docker --location asia-northeast1 --project h-japan
gcloud iam service-accounts create h72-runtime --display-name '72H runtime' --project h-japan
gcloud projects add-iam-policy-binding h-japan --member 'serviceAccount:h72-runtime@h-japan.iam.gserviceaccount.com' --role roles/aiplatform.user
```

Grant the actual Cloud Build identity Artifact Registry write and required
logging permissions. Deployment identity also needs Cloud Run deployment and
`iam.serviceAccounts.actAs` on the dedicated runtime account. Do not grant
project Owner just to make deployment work.

## Build and stage

First run the checks in `VALIDATION.md` and commit the reviewed implementation.
Require a clean working tree so the image tag identifies the actual source.
For the vNext release, build an immutable `git archive` of the runtime SHA;
exclude subsequent documentation edits and ignored local evidence from the image.
Alternatively, the Cloud Shell ZIP procedure above verifies its manifest and
tags the build with the exported working-tree source hash.

```powershell
$release = git rev-parse HEAD
gcloud builds submit --project h-japan --config infra/cloud-run/cloudbuild.yaml --substitutions "_RELEASE=$release" --async
# Observe this build ID until SUCCESS; obtain results.images[0].digest.
$runtimeDigest = 'sha256:<successful-build-digest>'
$revisionSuffix = "vnext-$($release.Substring(0, 7))"
gcloud run deploy h72 --project h-japan --region asia-northeast1 --image "asia-northeast1-docker.pkg.dev/h-japan/h72/72h@$runtimeDigest" --revision-suffix $revisionSuffix --no-traffic --tag vnext
# After preview acceptance, promote this explicit revision (not latest).
gcloud run services update-traffic h72 --project h-japan --region asia-northeast1 --to-revisions "h72-$revisionSuffix=100"
# If production acceptance finds a critical regression, restore the known baseline.
gcloud run services update-traffic h72 --project h-japan --region asia-northeast1 --to-revisions 'h72-00005-vql=100'
```

For an existing public service, preserve service identity, env configuration,
fixed secret version `h72-ekispert-api-key:2`, scaling/resource limits and invoker
IAM; do not replace them with `latest` or change public access during a release.
Verify actual model execution, rate/cost safeguards and browser acceptance on
the zero-traffic preview before promoting. Re-run acceptance on the canonical
production origin after promotion. Do not submit a deterministic fallback run as
Gemini evidence.
Deployment flags are documented by [gcloud run deploy](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy).

## Acceptance and submission

Record image digest, source SHA, service revision, runtime identity and URL.
Verify `/api/health`, a fresh Japanese replay, actual successful Gemini/ADK trace,
dependency invalidation, offline reload and reconnect reconciliation. Check that
the browser contains no credentials and that a model failure produces labeled
conservative fallback. Verify restart behavior and the bounded session limit.

Judging access is now configured and the public URL has passed unauthenticated
API plus clean desktop/mobile browser acceptance. Remaining submission work is to
provide the URL and GitHub integration in the Hackathon form, upload the final
architecture image, publish the approximately three-minute YouTube demo, and
complete the submission checklist. Preserve the submitted default branch and
service availability through 2026-12-01.
