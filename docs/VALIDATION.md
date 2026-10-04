# 72H validation evidence

Date: 2026-10-05 (JST). Branch: `main`.
Scope: synthetic Tokyo replay validated locally and on the public Google Cloud Run judging deployment. No live disaster feed is claimed. Overall implementation/deployment status: **PUBLIC MVP VERIFIED; SUBMISSION ASSETS STILL PENDING**.

## Accepted foundation and Safety Core

| Check | Result | Evidence |
|---|---|---|
| Backend tests | PASS | Consolidated suite: 51 tests = original 40 (including Gemini) + 11 Ekispert; one upstream Starlette/httpx deprecation warning. |
| Repeated deterministic replay | PASS | Test repeats full replay 10 times and compares normalized core state. |
| Malformed payload / timestamp / reference / trust rejection | PASS | Domain tests reject input atomically before mutation. |
| TTL, conflicts, social exclusion and high-risk blocking | PASS | Backend safety and frontend continuity tests. TTL uses publication time. |
| Append-only plan/evidence history | PASS | Immutable publication objects; separate evaluations and read projections. |
| Frontend unit/boundary tests | PASS | 17 tests normally; 18 with a real complete API snapshot fixture. |
| Frontend type/build | PASS | TypeScript and Next.js standalone production build; 12 static assets precached. |
| API → proxy → frontend schema | PASS | Browser-origin HTTP start, all 11 events and actual snapshot parsed by Zod. |
| Backend packaging and lock | PASS | Final `uv lock --check` and frozen sync passed with ADK 1.39.1. Cloud Build built the production Docker image successfully and verified `agent_api` / `uvicorn` imports inside the runtime venv. |

The complete API run produced four plan versions and twelve actions. Social
input left Plan v2 unchanged. The local clock event produced `OFFLINE_STALE`.
Network restoration stayed `RECONNECTING` after the official update and reached
`ONLINE_VERIFIED` only after the current transport update. No GET advanced replay
time. These are API/test results, distinct from browser acceptance below.

## Phase 3 candidate planner and independent review

- ADK 1.39.1 and the actual installed GenAI SDK are locked. A real SDK response
  Part test covers `thought=None`; only explicit private thought parts are
  excluded. Fake Runner integration and injected provider tests exercise success,
  schema rejection, timeout and deterministic fallback. They are not live model
  output evidence.
- Model output is a closed intent/evidence selection. Server code owns wording,
  category, risk, dependencies and plan publication. Candidates are checked
  against the current allowed catalog and eligible evidence before state mutation.
- One attempt / 15-second timeout / output token and session/global call budgets
  bound execution. Session reset does not replenish its call budget. No raw model
  reasoning or provider exception is exposed in public trace.
- After Google Cloud authentication and ADC quota-project configuration, a real
  Vertex AI / Gemini + ADK smoke call succeeded against project `h-japan`, location
  `global`, model `gemini-3.5-flash-lite`. The bounded structured selection returned
  `GEMINI_ADK` with no fallback and selected the allowed `protect_and_monitor` intent.
  This proves the live model/ADK/ADC path independently of the deterministic replay.
- Independent re-review closed both prior P1 findings: transport sources cannot
  assert disaster-status claims, and equal-timestamp evidence preceding network
  restoration cannot complete reconciliation. The source page now gives
  `CONFLICTING` precedence over a verified badge. No new blocking finding was
  reported within the bounded review; this is not a comprehensive security audit.

## Ekispert and worktree integration

- Migrated only the provider boundary, names-only smoke script, local key helper,
  Hackathon skills and mobility docs/rules from b25f. The canonical application
  remains `apps/web` / `services/agent-api` on `codex/hackathon-mvp`.
- MCP 1.30.0 is now an explicit pinned dependency alongside ADK 1.39.1. Lock check,
  frozen sync and no-dev production import passed; no MCP 2.x/httpx2 graph or
  second API server was imported.
- Eleven Ekispert tests cover missing key before network access, tool/argument
  validation, bounded calls, cleanup, sanitized RPC/tool failures, credential
  headers and actual SDK cross-origin redirect rejection using MockTransport.
  Raw route data does not mutate trusted claims or Safety Core state.
- Final independent re-review repeated all 51 backend tests and the actual SDK
  redirect regression. Both original P1 reproductions remain closed; no remaining
  P1/P2 blocker was found in this scope. Review made no source or Git changes.
- A live names-only Ekispert MCP smoke succeeded using the backend-only user secret:
  `EKISPERT_MCP=OK`, returning six tools including `ekispert_api_search_routes` and
  `ekispert_api_get_stations_from_geo`. No secret value was printed or committed.
- Secret Manager `h72-ekispert-api-key` version 2 is injected into Cloud Run. A
  one-off Cloud Run Job using the production image, `h72-runtime` identity and the
  same secret completed successfully (`h72-ekispert-smoke-9k6rs`), proving the
  production Cloud-to-Ekispert MCP path without exposing provider payloads or the key.
- The copied skill schedule contained the old office-hours date. It was corrected
  to 2026-10-05 from the current official event page; an unconfirmed old summit
  entry is marked as such.
- Main's 16 legacy modified/untracked files matched the migration source when
  inspected. They are preserved in a named Git stash before the fast-forward
  integration; b25f is retained, not deleted or developed further.

## Browser acceptance

Operator: one Luna Lightweight agent, Playwright CLI, Chromium, local standalone
production server at `http://127.0.0.1:3001`.

- Japanese home, Sources, Plan and Trace empty states display distinct headings.
- Start request originally returned 403 because Next normalized its origin.
  The public Host comparison was fixed and independently tested; GUI replay now
  starts and auto-advances the first event.
- Pause/resume, next, 2× speed, completed-state disabling and reset passed in the
  initial Phase 1 runtime. Sources and public trace were visible.
- At 390×844, all five navigation links now wrap and remain visible.
- With real browser network disabled, a reload still served cached application
  shell, the static emergency pack and the local session snapshot.
- The first offline run happened after reset, so it did **not** demonstrate a
  nonempty Last Verified Plan. The later Phase 2 run did: real offline reload
  retained Plan v4 with NOW/NEXT/AVOID, source cards, verification time and expiry.
- Parent restarted the in-memory backend during the operator run; the old
  session returned 404. This is session loss, not successful reconciliation.
  The new-demo recovery control passed the later GUI run.
- Earlier in-app-browser route failed with `Browser is not available: iab`;
  Playwright CLI supplied the later evidence. These are different tool runs.

- Phase 2 manual 11-event replay passed: v1 from official input, v2 from transport,
  no social-driven replan, v3 after local expiry, v4 after both reconnect refreshes.
  Historical evaluations remained visible; console reported zero errors/warnings.
- After actual browser connectivity returned, no new sources were supplied, so
  reload/retry stayed `RECONNECTING`. This is correct non-promotion, not a claim of
  completed real-network reconciliation. The replay reconciliation passed separately.

Screenshots are local ignored artifacts under `output/playwright/phase1-fixed-*`
and `output/playwright/phase2-*`.
API simulation of offline events does not prove actual network-offline behavior.

The latest production build also passed the narrow Phase 3 fallback GUI check:
new-demo recovery, manual official/transport updates, Japanese fallback label,
`MISSING_ADC` / failed Action Agent trace and successful deterministic Safety
Core publication. No successful Gemini label appeared. Mobile navigation remained
visible and the new session console had zero errors/warnings. Screenshots:
`phase3-fallback-desktop.png` and `phase3-fallback-mobile.png`.

Localization limitation: changing the UI language of an existing Japanese
session translates the fallback label/navigation, but does not retranslate its
immutable published action text. Start a new demo in the selected language for
new server-owned action text. Public trace reason bodies currently remain English.

### Public Cloud Run clean-browser acceptance

- Public URL: `https://h72-602701455122.asia-northeast1.run.app`.
- Unauthenticated `/api/health` returned `ok`; an unauthenticated full replay
  completed with four plans, twelve actions, `GEMINI_ADK`, candidate-applied trace
  and no Gemini fallback.
- A fresh Chromium context with no saved storage, cookies or Google authorization
  completed the UI replay to `11 / 11`, displayed Plan v4 and the Gemini/ADK label,
  exposed Sources and `GEMINI_CANDIDATE_APPLIED` in Agent trace, and reported zero
  browser console errors/warnings.
- A separate fresh 390x844 context showed all five navigation links and Start demo
  with zero console errors/warnings. Screenshots are local ignored evidence under
  `output/playwright/cloud-public/` (`desktop-home.png`, `desktop-complete.png`,
  `desktop-trace.png`, `mobile-home.png`).

## Remaining / intentionally incomplete

- Successful Gemini/ADK invocation and credentialed output: **VERIFIED LOCALLY AND ON PUBLIC CLOUD RUN**. The production replay path completed with `GEMINI_ADK`; a paced 10-run Cloud Run golden path passed 10/10 with no model fallback.
- Google Cloud deployment: **VERIFIED**. Project `h-japan`, billing, required APIs, Artifact Registry `h72`, runtime service account `h72-runtime`, Cloud Build, Secret Manager and public Cloud Run are configured. Public revision `h72-00005-vql` serves 100% traffic from image digest `sha256:64e1026d3cd46b2e787d9a2866a016a73005b15a2c491bae2f85bf9f3a18f31b`.
- Public cost guardrail: **VERIFIED**. Cloud Run remains capped at one instance and application request/model bounds stay enabled. Billing budget `72H Hackathon Guardrail` is scoped to `h-japan` at ¥5,000/month with 50%, 80% and 100% alert thresholds; this is notification-only, not a hard cap.
- Remote GitHub Actions: **NOT RUN**. Workflow exists; local checks and Cloud Build passed.
- Live JMA and Safety Tips integrations are **NOT IMPLEMENTED**; replay provenance explicitly uses synthetic data. Ekispert MCP production connectivity is verified, but route output is not promoted into trusted disaster/safety evidence.
- Firestore persistence: **NOT IMPLEMENTED**. Server sessions are ephemeral by design for the Hackathon MVP.
- External submission assets/process remain **PENDING**: Hackathon GitHub integration/form, final architecture upload, approximately three-minute YouTube demo and final submission confirmation.

## Reproduce

Requires Node 24, Python 3.11 and `uv`.

```powershell
uv sync --project services/agent-api --frozen
uv run --project services/agent-api pytest services/agent-api/tests
uv run --project services/agent-api python scripts/check_secrets.py
npm ci --prefix apps/web
npm test --prefix apps/web
npm run typecheck --prefix apps/web
npm run build --prefix apps/web
```

For the optional 18th contract test, set `CONTRACT_FIXTURE` to an actual API
snapshot path relative to `apps/web`, e.g. `../../.work/phase3-snapshot.json`.

Run the API with `uv run --project services/agent-api python -m agent_api` and
the standalone web server with `npm start --prefix apps/web` in separate terminals.
Stop the standalone server before rebuilding on Windows to avoid directory locks.
The workspace-local npm compatibility shim was needed on this machine; it is
ignored and does not modify global npm or application dependencies.
