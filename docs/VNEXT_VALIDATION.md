# vNext P0 validation — 2026-10-05 JST

Production release evidence is recorded separately in
[VNEXT_PRODUCTION_RELEASE.md](VNEXT_PRODUCTION_RELEASE.md). The local builds,
fixture counts and pre-release authorization statements below are historical;
they do not establish acceptance of a later deployed image.

## Map/profile, Last Known Location and generic area follow-up

User-authorized on 2026-10-05 JST. Status: **COMPLETE — implementation and required
local validation**. Production and real-device acceptance remain separate.
The subsequent local commit/RC preparation is recorded in
`VNEXT_RELEASE_CANDIDATE.md`; historical uncommitted-state statements below refer
to the pre-RC stage. RC checks re-ran 69 backend / 77 frontend tests and TypeScript
with fresh canonical frontend-proxy fixtures.
Frontend production build: `qsh1YmaIahspngAHgjxoR`, local port 3005 with the
dedicated deterministic backend on port 8005. Earlier P0 results below refer to
their own build and are preserved as historical evidence.

This follow-up removes city/coordinate assumptions from UI and generic planning
consumers. Replay source configuration retains explicit legacy adapters; installed
map coverage remains central Tokyo. The contract is `VNEXT_AREA_LOCATION.md`.

| Follow-up check | Result |
|---|---|
| Final backend pytest | PASS — 69 tests; existing Starlette/httpx deprecation warning only |
| Final frontend with fresh frontend-proxy API fixtures | PASS — 77 tests across 12 suites |
| TypeScript / production build | PASS — direct TypeScript CLI and `node scripts/build.mjs`; build ID above |
| Real local frontend-proxy integration | PASS — Tokyo 11 events / four immutable plans, Osaka typed L2 / retained profile on reset; unknown/path scenario keys rejected with 422 |
| Generic area and source guards | PASS — hierarchy/cycle/path validation, regional source authorization, typed/legacy contradiction rejection, scoped severity/reconciliation, legacy-cache degradation, 96-character area plan dependencies |
| Map config / integrity | PASS — real pack hash, bounded catalog/assets, configured Tokyo reference coverage and Osaka noncoverage |
| Last Known Location unit boundaries | PASS — consent/restore/expiry/corruption/storage failure, timestamp monotonicity and opt-out deletion |
| Maintainer CLI | PASS — help and invalid extent/path rejection without a network query |
| Lint | NOT RUN — no project lint script; Ruff is not installed in this environment |
| Independent backend closure | PASS — 16 claim-scope cases plus five selected capability/long-area/reconnection cases; no new blocker found |
| Secret / diff checks | PASS — repository credential-file/secret-pattern gate and `git diff --check`; line-ending normalization warnings only |

### Rebuilding integration fixtures

The pre-area-schema `.work/p0-api-states.json` and `.work/p0-api-final.json` from
16:48 were stale artifacts. Reusing them produced L4/verification-restored
projection failures; a freshly captured current replay passes. These canonical
files are now replaced by current frontend-proxy responses. Historical test
counts below remain tied to their original code/build, not to these refreshed
files.

Canonical refresh verified at **2026-10-05 21:15 JST**: 12 snapshots for 11 events,
four plan versions, final ONLINE_VERIFIED; pair/session/manifest hashes match.
The documented canonical filenames then passed all **77 frontend tests**.

Before running fixture-dependent tests, use this sequence from the repo root.
The web proxy at port 3005 must target the current deterministic backend. The
backend must be started with `PLANNER_MODE=deterministic`; a start snapshot's
planning-mode label is an execution result, not proof of server configuration.
The generator checks current area/profile/assessment fields and that returned
snapshots remain deterministic. It stages the new files only after replay
completes, then writes capture time, session ID and
SHA-256 hashes in `.work/p0-api-fixtures-manifest.json`. Fixtures remain ignored
local artifacts; regenerate them for each integration run rather than copying
old JSON into CI.

```powershell
uv run --project services/agent-api --frozen python scripts/generate_replay_fixtures.py
if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed; do not use old artifacts' }
$fixtureRoot = (Resolve-Path .work).Path
$env:P0_API_FIXTURE = Join-Path $fixtureRoot 'p0-api-states.json'
$env:CONTRACT_FIXTURE = Join-Path $fixtureRoot 'p0-api-final.json'
Push-Location apps/web
try {
  node node_modules/vitest/vitest.mjs run
  if ($LASTEXITCODE -ne 0) { throw 'Frontend integration tests failed' }
} finally { Pop-Location }
```

Independent review and GUI found four issues during acceptance, corrected with
regressions:

- Tokyo profile seed omitted coordinates after fixed UI coordinates were removed.
  Reference pairs were moved into synthetic scenario configuration; coverage and
  API regressions pass; GUI retest shows two profile-reference pins and real roads.
- A disaster-source verified update could generate a trusted transport claim
  from route fields. Scenario and reducer boundaries now reject it atomically;
  the inverse transport-to-disaster payload is also rejected. Generated claims
  require the registration's claim type/source class/trust and authorized areas.
- A valid 96-character area generated a dependency longer than the entity ID
  limit. Dependency keys now share the bounded 160-character claim-key contract;
  a full reducer/plan regression passes and a 161-character key is rejected.
- A browser could return an older/equal cached position after a newer saved fix.
  The hook now accepts only a strictly newer validated timestamp; the original
  point/time remain and the UI degrades to last known on rejection.

| Browser acceptance on the build above | Result / evidence |
|---|---|
| Current build/cache | PASS — browser build ID and SW cache both `qsh1YmaIahspngAHgjxoR` |
| Tokyo configuration | PASS — Shibuya / Asakusa labeled profile-reference pins, real roads, one MapLibre canvas; `qsh1-tokyo-profile-pins.png` |
| Alternate region | PASS — Kita / Osaka City profile and explicit unsupported map; no canvas/Tokyo roads. Second official event yields L2 / PREPARE with linked Osaka evidence; `qsh1-osaka-profile-unsupported.png` |
| Consent and mock live fix | PASS — consent defaults off, storage null before and after a one-shot unconsented QA fix; UI LIVE. Opt-in stores one validated point |
| Restore/offline/power | PASS — exact saved latitude/longitude/accuracy/capture time survive reload; restored/offline/SURVIVAL UI is LAST, never renewed LIVE; `qsh1-lkl-offline-survival-denied.png` |
| Permission denial / forget | PASS — denied new fix leaves original JSON/time intact; Forget changes UI to unavailable and removes the storage key |
| Existing replay/history | PASS — GUI Tokyo 11/11 with v1–v4 history |
| Final running backend smoke | PASS — fresh Tokyo session after source-boundary fix: ONLINE_VERIFIED, L4 / PREPARE, v2 ACTIVE, reference map; linked official evidence with age/expiry readable. Returned Home / online / AUTO; `qsh1-final-tokyo-home-l4.png`, `qsh1-final-tokyo-source-l4.png` |

Location QA used browser-context geolocation/permission overrides only:
`latitude=35.6595`, `longitude=139.7005`, `accuracy=12m`, capture epoch
`1791194725210`. The storage key was `72h-last-known-location-v1` with explicit
`BROWSER_GEOLOCATION` source and consent. No real GPS was accessed. Screenshots
are under ignored `output/playwright/vnext-p0/`.

The initial `qsh1-tokyo-profile-map.png` records the omitted-coordinate issue,
not a successful map pass. Backend restarts invalidated old in-memory sessions,
producing expected 404/ended-session UI; subsequent GUI checks started new
sessions through the normal controls. No state was injected to fabricate plans.

Browser location acceptance uses explicitly mocked QA geolocation. It is not real
device GPS acceptance. No live feed, nationwide map, cloud release or background
delivery is claimed.

## Earlier seven-module P0 acceptance

Scope: the seven P0 modules in `VNEXT_PRODUCT_PLAN.md`, authorized by the user.
Status: **COMPLETE — local P0 implementation and required local validation**.
Production and real-device acceptance remain outside this status.
Branch: `codex/vnext-p0`; baseline: `772c264`. Changes are local and uncommitted.
This report does not extend the baseline production acceptance to this branch.
Production build under final browser acceptance: `4IddiNwtfzjqgu_AOm6KB`.
The earlier final-map pass used `pUhD_iLVhGq-I_DK5h4oh`; a subsequent bounded
notification-anchor correction required rebuilding and restarting port 3005.

## Implemented scope

| P0 module | Implementation |
|---|---|
| Map-first UI | Home / Plan / More; one eligible NOW, expandable NEXT / AVOID / evidence; replay and trace under Demo / Judge |
| Offline emergency map | Bounded central-Tokyo real OSM road extract, MapLibre, integrity manifest, app-owned SW cache, optional foreground coarse location and readable failure state |
| Disaster severity | Deterministic location-relevant official L0–L4 projection, UNKNOWN / CONFLICT fallback, freshness and reconnect gates; no severity-only movement authorization |
| Source authority | A0–A3 projections from typed server evidence, A4 reserved; no safety permission inferred from labels |
| Notifications | Stable transition events, bounded local inbox, dedup and aggregation, plan/evidence deep links; physical reconnect and verified recovery are separate |
| Power / survival | Battery thresholds, unknown-battery fallback, stricter manual override, reduced refresh, noncritical POST gate, minimal survival screen; TTL checks retain their earliest deadline |
| Life-protection check | Prior consent + fresh relevant L4; bounded retries, explicit responses, validated local persistence, revocation; silence becomes UNRESPONSIVE_UNKNOWN |

The Safety Core and immutable plan pipeline remain authoritative. The replay
fixture adds an official synthetic severity claim to exercise the normal evidence
pipeline. It does not select a hardcoded plan by timeline index. No beacon or
automatic emergency dispatch is implemented in P0.

## Automated and integration evidence

| Check | Result |
|---|---|
| Backend pytest | PASS — 55 tests; one existing Starlette/httpx deprecation warning |
| Frontend Vitest with real local API fixtures | PASS — 61 tests |
| Frontend without optional API fixtures | PASS — 56 tests; 3 optional tests skipped before the final additional second-outage regression (that regression passed in the 61-test fixture run) |
| TypeScript noEmit | PASS |
| Production build | PASS — 22 generated Next.js static assets; map pack and explicit MapLibre worker modules are additionally listed in the SW core cache |
| Actual local HTTP replay via frontend API proxy | PASS — 11 / 11 events; 4 immutable plan versions, 12 actions; final ONLINE_VERIFIED; DETERMINISTIC_REPLAY_ONLY |
| Secret / whitespace checks | PASS — tracked and non-ignored new files scanned; git diff --check clean (CRLF normalization warnings only) |
| Independent source review | PASS — bounded read-only review, no confirmed blocking issue; identified defects corrected and covered by automated regression tests |

Historical P0 command paths (PowerShell, repo root unless stated): regenerate
the canonical fixtures with the sequence above before reusing these commands.

```powershell
uv run --project services/agent-api pytest services/agent-api/tests
uv run --project services/agent-api python scripts/check_secrets.py
# apps/web working directory:
$env:P0_API_FIXTURE='C:/Users/jacks/.codex/worktrees/3660/72H/.work/p0-api-states.json'
$env:CONTRACT_FIXTURE='C:/Users/jacks/.codex/worktrees/3660/72H/.work/p0-api-final.json'
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
# repo root:
git diff --check
```

The optional API-fixture tests are skipped when fixture environment variables
are absent. Local fixture files are ignored under `.work/`; they contain actual
responses from the isolated local deterministic backend at port 8005. The web
server is port 3005. No other local service was stopped or reused.

The installed global npm has a pre-existing `minipass-flush` export mismatch.
A local ignored shim was used for `npm ci`; global npm was not edited. The pinned
npm lockfile is retained. A reviewer accidentally invoked pnpm and displaced
node_modules; its generated lockfile was removed and dependencies restored via
npm ci before final test/typecheck/build. No pnpm lockfile is part of this change.

## Browser acceptance

Luna Lightweight GUI operator, local browser only, desktop and 390 × 844 viewport.
First pass verified all 11 replay events, v1–v4 history, three languages, L4
consent / safe reply / revocation, mobile survival and actual offline shell/plan
reload. It exposed a MapLibre worker path error in the Turbopack build. The fix
uses explicit pinned worker/shared modules copied at install/build and precached.
The first-pass map failure was corrected and verified on subsequent builds.

The map was subsequently visibly rendered on build `pUhD_iLVhGq-I_DK5h4oh`, with
both explicit worker modules returning HTTP 200 and zero console errors/warnings.
During its replay retest, event 4 encountered connection refused because the
main agent had stopped the frontend for the last rebuild. This is an environment
interruption, not a replay product failure; retest resumed on the new build.

Focused review raised a possible second-API-outage notification issue, then
withdrew the false-recovery claim after tracing the existing central offlineBase
reconciliation gate. The final minimal change still resets the notification
anchor to the current outage baseline, preventing references to earlier recovery
evidence. The second-outage test requires new official and partner evidence and
checks the notification's evidence IDs.

Latest-build results so far:

| Browser check | Result / evidence |
|---|---|
| Build and SW identity | PASS — BUILD_ID `4IddiNwtfzjqgu_AOm6KB`, cache `72h-shell-4IddiNwtfzjqgu_AOm6KB` |
| Real road map | PASS — visible MapLibre canvas and Tokyo geometry; explicit worker/shared 200, zero console errors |
| Replay and history | PASS — 11 / 11, v1–v4 history; `final-4Iddi-replay-11-11.png`, `final-4Iddi-plan-history.png` |
| Inbox aggregation / read persistence | PASS — six entries, no stacked repeated dependency/new-plan titles; mark read 6 → 5 persists across Plan navigation; `final-4Iddi-notification-inbox.png` |
| Latest-build offline map reload | PASS — real roads visible in one MapLibre canvas; OFFLINE_STALE and expired v4/timestamps correctly retained; `final-4Iddi-offline-map-desktop.png` |
| Physical online recovery without new proof | PASS — remains RECONNECTING with unchanged 17:52 last-verification time and expired v4; `final-4Iddi-reconnecting-home.png` |
| Latest-build mobile power modes | PASS — 390 × 844 SURVIVAL minimal screen; AUTO restores Home/map; CONSERVE choice persists across pages; `final-4Iddi-mobile-survival.png`, `final-4Iddi-mobile-auto.png` |
| Emergency power noncritical POST controls | PASS — Continue / Next / Reset / speed disabled, Reset enabled under AUTO but disabled under EMERGENCY_POWER; blocked click produced no `/api/replay` request and event index stayed 11 / 11; `final-4Iddi-emergency-power-gate.png` |

The consent response was already persisted in the reused browser on this final
replay, so a new safety prompt was not re-created in that run. The first-pass
GUI consent/reply/revocation evidence and final automated policies cover it.

Offline reload produced two expected `ERR_INTERNET_DISCONNECTED` diagnostics for
`/` and `/sources` RSC requests. Cached HTML/map continued to render. These
network diagnostics are recorded rather than hidden or counted as online
console success. The final browser was restored to online / AUTO / Home.

Screenshots and browser artifacts: `output/playwright/vnext-p0/` (ignored local
evidence). Tests and UI distinguish simulated official/transport data from real
map geography. Returning online without new relevant official and partner proof
must remain RECONNECTING rather than claim verified recovery.

## Offline map provenance

Pack: `tokyo-central-v1`, bounds `[139.68, 35.64, 139.82, 35.74]`,
7,639 major-road features, 2,386,863 bytes.

SHA-256: `435055cff10f664da638c0c7d1472e466ef9da6013c00eada56b7cf89cd04db1`.

Capture: `2026-10-05T07:29:40.982908Z`; OSM data time:
`2026-10-05T07:27:41Z`. Attribution and ODbL license accompany the extract.
Runtime makes no Overpass calls. The maintainer extraction script enforces
response and feature limits; a broader query exceeded the 8 MB limit and was
rejected before the bounded major-road extract was generated.

## Remaining acceptance boundaries

- Live JMA / municipality shelters / GSI hazards / JARTIC / Web Push are candidate
  source integrations, not activated live services in this local P0. Existing
  Gemini / ADK / Cloud Run paths remain; no paid model or cloud release was run.
- No real-device battery endurance, guaranteed OS background delivery, native
  timers, GPS accuracy, emergency dispatch or rescue beacon claim is made.
- The map is central Tokyo only and has no hazard, shelter or safe-route layer.
  First successful online cache is required; WebGL/storage failure exposes the
  explicit fallback. It is not nationwide offline navigation.
- Release, commit/push, billing and P1+ require a separate task/authorization.
