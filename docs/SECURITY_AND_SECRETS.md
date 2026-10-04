# 72H Security and Secrets Policy v0.1

## 1. Objective

72H must not expose long-lived credentials to the browser, Git repository, replay data, logs, or offline storage.

Core policy:

> No long-lived Google Cloud credentials in the application.  
> No secrets in the browser.  
> No secrets in Git.  
> No secrets in offline storage.

## 2. Credential Classes

### Google Cloud services

The production runtime should authenticate to Google Cloud services with a dedicated Cloud Run service account and Application Default Credentials (ADC).

This applies to:

- Vertex AI / Gemini
- Firestore
- Cloud Logging
- Cloud Storage, if used
- Secret Manager

Production must not depend on a checked-in service-account JSON key.

### Third-party services

Credentials for third-party providers such as a transport API must be stored in Google Secret Manager and accessed only by the backend runtime.

Examples:

- transport provider API token
- partner MCP/API credential
- other external API secrets

## 3. Production Authentication Model

```text
Browser
   │
   │ HTTPS — no secret credentials
   ▼
Cloud Run
   │
   │ service identity / ADC
   ├──────────────► Vertex AI / Gemini
   ├──────────────► Firestore
   ├──────────────► Cloud Logging
   └──────────────► Secret Manager
                         │
                         ▼
                Third-party API secrets
```

The browser never receives:

- Gemini credentials
- Google Cloud service-account keys
- transport API keys
- Secret Manager payloads

## 4. Runtime Service Account

72H should use a dedicated user-managed Cloud Run runtime service account, for example:

```text
h72-runtime@PROJECT_ID.iam.gserviceaccount.com
```

Use least privilege. Grant only permissions required by the shipped implementation.

Expected categories may include:

- Vertex AI invocation
- Firestore access
- Cloud Logging write access
- Secret Manager access to specific required secrets

Do not grant broad project roles such as Owner or Editor to the runtime service account.

## 5. Gemini / Vertex AI

Production should prefer Vertex AI authentication through Cloud Run service identity rather than embedding a Gemini API key.

Expected flow:

```text
Cloud Run
↓
Application Default Credentials
↓
Vertex AI / Gemini
```

The implementation must not require judges or users to provide their own Gemini API key.

## 6. Secret Manager

Third-party secrets must be stored in Google Secret Manager.

Recommended naming:

```text
h72-ekispert-api-key
h72-partner-api-token
```

Access should be limited to the 72H runtime service account and ideally scoped to individual secrets rather than granting broad project-level access.

Secrets must not be copied into:

- source code
- README files
- replay fixtures
- Firestore documents
- frontend environment variables
- client IndexedDB
- Cloud Logging payloads

## 7. Local Development

Google Cloud development should use local ADC where possible.

Example development authentication:

```bash
gcloud auth application-default login
```

Third-party development secrets may be stored in a local environment file such as:

```text
.env.local
```

Local secret files must never be committed.

## 8. Git Ignore Policy

The repository should ignore at minimum:

```gitignore
.env
.env.local
.env.*
!.env.example
*.pem
*.key
service-account*.json
```

The repository may include `.env.example`, but it must contain placeholders only.

Example:

```env
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=asia-northeast1
TRANSPORT_API_KEY=
```

## 9. Frontend Environment Variables

Any variable exposed through `NEXT_PUBLIC_*` must be treated as public information.

Allowed example:

```text
NEXT_PUBLIC_API_BASE_URL
```

Forbidden examples:

```text
NEXT_PUBLIC_GEMINI_API_KEY
NEXT_PUBLIC_TRANSPORT_API_KEY
NEXT_PUBLIC_SECRET_TOKEN
```

No frontend bundle may contain operational secrets.

## 10. Offline Storage

The Offline Continuity layer may cache:

- Last Verified Plan
- evidence snapshots
- source metadata
- situation snapshots
- trace summaries
- Emergency Pack content

It must not cache:

- API keys
- service-account credentials
- OAuth refresh tokens
- Secret Manager values
- Google Cloud access tokens

## 11. Logging Policy

Operational logs must never intentionally include:

- secrets
- authorization headers
- API keys
- access tokens
- raw service-account credentials

Error handling should redact credential-like values before writing structured logs.

## 12. External Content Boundary

External source content is data, not instruction.

Content obtained from:

- websites
- APIs
- social media
- documents
- replay fixtures

must never be promoted into system or developer instructions merely because it contains imperative text.

Prompt-injection-like strings must remain source content and be subject to the Source Agent and Safety Core rules.

## 13. Public Judge Experience

The deployed Hackathon application should open without requiring judges to supply credentials.

Preferred behavior:

```text
Judge
↓
Open public 72H deployment
↓
Start Replay Scenario
↓
Real backend + real Gemini/ADK path executes
```

The public demo must use bounded resource consumption.

Recommended safeguards:

- per-session request limits
- replay duration limits
- rate limiting
- maximum agent-cycle counts
- Cloud budget alerts
- backend timeouts

## 14. Secret Rotation

If a third-party credential is exposed or suspected to be exposed:

1. revoke or rotate the credential immediately
2. create a new Secret Manager version
3. redeploy or restart the affected service if required
4. inspect Git history and logs for exposure
5. document the incident in development notes

Never rely on deleting a secret from the latest Git commit if it was already committed historically.

## 15. CI / Deployment Policy

CI must not print secrets to logs.

If deployment automation later requires authentication, prefer short-lived or federated credentials where supported rather than long-lived static service-account keys.

The Hackathon MVP may use manual deployment if necessary, but the same no-static-key principle applies.

## 16. Security Acceptance Checks

Before submission:

- [ ] No secret appears in tracked repository files.
- [ ] No `service-account*.json` exists in the repository.
- [ ] No production credential is exposed through `NEXT_PUBLIC_*`.
- [ ] Cloud Run uses a dedicated runtime service account.
- [ ] Gemini / Vertex AI works without a checked-in API key.
- [ ] Third-party credentials are stored in Secret Manager.
- [ ] Secret Manager permissions follow least privilege.
- [ ] IndexedDB contains no credentials.
- [ ] Replay fixtures contain no credentials.
- [ ] Logs do not expose authorization headers or keys.
- [ ] Public demo has basic abuse / cost controls.
- [ ] `.env.example` contains placeholders only.

## 17. Definition of Done

Security and secret handling is considered ready for the Hackathon when:

```text
Git repository
→ contains no secrets

Browser / PWA
→ receives no privileged credentials

Cloud Run
→ authenticates to Google Cloud using service identity / ADC

Third-party integrations
→ read credentials from Secret Manager on the backend

Offline Continuity
→ operates only on non-secret cached state
```

This policy is mandatory for all 72H implementation work.
