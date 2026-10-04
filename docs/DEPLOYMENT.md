# 72H deployment runbook

Target project: **h-japan**. Cloud Run region: **asia-northeast1**.
This is a prepared deployment procedure, not evidence of an existing deployment.
The current machine has no available `gcloud`, Docker engine or ADC; project access,
billing, IAM and cloud APIs have not been verified.

## Selected route: Google Cloud Shell

The user selected Cloud Shell. A separate browser readiness check redirected to
Google sign-in; no credentials were entered and no cloud resource was changed.
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

The script stages a **private** Cloud Run revision, does not change IAM or enable
APIs implicitly, and labels the image with the source snapshot hash. It has not
been executed against Google Cloud. The commands below work in Cloud Shell Bash
and PowerShell; the later release-tag example uses PowerShell variables.

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
Alternatively, the Cloud Shell ZIP procedure above verifies its manifest and
tags the build with the exported working-tree source hash.

```powershell
$release = git rev-parse HEAD
gcloud builds submit --project h-japan --config infra/cloud-run/cloudbuild.yaml --substitutions "_RELEASE=$release"
gcloud run deploy h72 --project h-japan --region asia-northeast1 --image "asia-northeast1-docker.pkg.dev/h-japan/h72/72h:$release" --service-account h72-runtime@h-japan.iam.gserviceaccount.com --port 8080 --cpu 1 --memory 1Gi --min-instances 0 --max-instances 1 --concurrency 8 --timeout 60 --no-allow-unauthenticated --set-secrets 'EKISPERT_API_ACCESS_KEY=h72-ekispert-api-key:latest' --set-env-vars 'GOOGLE_CLOUD_PROJECT=h-japan,GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,GEMINI_MODEL=gemini-3.5-flash-lite,PLANNER_MODE=gemini'
```

The initial service is private for review. Public judging access is a separate
release step after real model execution, rate/cost safeguards and clean-browser
acceptance pass. Do not submit a deterministic fallback run as Gemini evidence.
Deployment flags are documented by [gcloud run deploy](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy).

## Acceptance and submission

Record image digest, source SHA, service revision, runtime identity and URL.
Verify `/api/health`, a fresh Japanese replay, actual successful Gemini/ADK trace,
dependency invalidation, offline reload and reconnect reconciliation. Check that
the browser contains no credentials and that a model failure produces labeled
conservative fallback. Verify restart behavior and the bounded session limit.

Only then configure judging access, submit the URL and GitHub integration,
architecture image and approximately three-minute YouTube demo. Preserve the
submitted default branch and service availability through 2026-12-01.
