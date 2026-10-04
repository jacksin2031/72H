#!/usr/bin/env bash
# Run inside the reviewed source directory; secrets are never printed.
set -euo pipefail
TASK_PROJECT=h-japan
TASK_REGION=asia-northeast1
TASK_RUNTIME="h72-runtime@${TASK_PROJECT}.iam.gserviceaccount.com"

gcloud projects describe "$TASK_PROJECT" --format='value(projectId)'
gcloud billing projects describe "$TASK_PROJECT" --format='value(billingEnabled)'
gcloud services list --enabled --project "$TASK_PROJECT" --format='value(config.name)'
if [[ "${1:-}" != "--deploy" ]]; then
  printf '%s\n' 'Read-only preflight complete. Review docs/DEPLOYMENT.md and prerequisites before --deploy.'
  exit 0
fi

python3 scripts/verify_cloud_bundle.py
gcloud iam service-accounts describe "$TASK_RUNTIME" --project "$TASK_PROJECT" --format='value(email)'
gcloud artifacts repositories describe h72 --location "$TASK_REGION" --project "$TASK_PROJECT" --format='value(name)'
TASK_RELEASE="$(python3 -c 'import json; print(json.load(open("bundle-manifest.json"))["source_sha256"][:24])')"
TASK_IMAGE="${TASK_REGION}-docker.pkg.dev/${TASK_PROJECT}/h72/72h:${TASK_RELEASE}"
gcloud builds submit --project "$TASK_PROJECT" --config infra/cloud-run/cloudbuild.yaml --substitutions "_RELEASE=${TASK_RELEASE}"
gcloud run deploy h72 --project "$TASK_PROJECT" --region "$TASK_REGION" --image "$TASK_IMAGE" \
  --service-account "$TASK_RUNTIME" --port 8080 --cpu 1 --memory 1Gi \
  --min-instances 0 --max-instances 1 --concurrency 8 --timeout 60 \
  --no-allow-unauthenticated \
  --set-secrets 'EKISPERT_API_ACCESS_KEY=h72-ekispert-api-key:latest' \
  --set-env-vars 'GOOGLE_CLOUD_PROJECT=h-japan,GOOGLE_CLOUD_LOCATION=global,GOOGLE_GENAI_USE_VERTEXAI=true,GEMINI_MODEL=gemini-3.5-flash-lite,PLANNER_MODE=gemini'
gcloud run services describe h72 --project "$TASK_PROJECT" --region "$TASK_REGION" --format='value(status.url)'
printf '%s\n' 'Private staging created. Real-model, identity, offline and public-cost acceptance remain required.'
