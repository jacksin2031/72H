# 72H vNext P0 — Release Candidate 1

Candidate ID: `vnext-p0-rc1`.
Acceptance: **LOCAL ACCEPTANCE PASS**.
Authorized scope: local commit and Release Candidate preparation, approved by
the user after the map/profile, Last Known Location and generic area follow-up.

## Source identity

Branch: `codex/vnext-p0`.
Parent baseline: `772c264edf863ab3b6006e67babe43f9418dbae4`.
The candidate is the commit that first adds this record. Resolve its immutable
identity with:

```powershell
git log --diff-filter=A --format=%H -1 -- docs/VNEXT_RELEASE_CANDIDATE.md
```

The local RC package under `.work/releases/` records the full commit and tree IDs,
source ZIP SHA-256, evidence file hashes and fixture capture provenance in
`release-manifest.json`. Its directory name includes the candidate commit ID.
The ZIP is a Git archive of that commit, not a copy of a dirty working directory.
No generated dependencies, credentials or local storage are in the source ZIP.

## Included scope

- Seven P0 modules: Home / Plan / More, reference map, deterministic severity and
  authority, notification inbox, power modes, local consented safety checks.
- Configurable replay profiles/map catalog and explicit unsupported coverage.
- Consented one-point Last Known Location persistence, original capture time,
  monotonic fixes, restore/offline/expiry/forget behavior.
- Canonical area hierarchy, typed assessments, source area and claim-type
  authorization, scoped continuity/reconciliation, immutable plan history.
- Tokyo and Osaka synthetic replays, real licensed central Tokyo OSM road pack,
  bounded map-maintenance and current replay-fixture generation tools.

## Frozen local acceptance evidence

| Gate | Evidence |
|---|---|
| Backend | 69/69 passed; existing Starlette/httpx deprecation warning |
| Frontend | 77/77 passed with newly captured frontend-proxy fixtures |
| TypeScript | Passed |
| Production build | Existing locally built/browser-tested artifact `qsh1YmaIahspngAHgjxoR`; no runtime web source changed during RC preparation |
| Replay | Tokyo 11 events / four plans / COMPLETED / ONLINE_VERIFIED; Osaka typed L2 and configured-profile reset passed |
| Browser | Profile-reference pins, unsupported Osaka coverage, mock-only location consent/restore/offline/SURVIVAL/denial/forget; final source-linked Tokyo Home smoke |
| Independent review | Frontend location boundary and backend source/long-ID fixes independently verified; no remaining scoped blocker |
| Secrets / diff | Repository secret-pattern and credential-file checks, staged diff check passed |
| Map data | 2,386,863 bytes, 7,639 features; SHA-256 `435055cff10f664da638c0c7d1472e466ef9da6013c00eada56b7cf89cd04db1`; ODbL attribution retained |

`VNEXT_VALIDATION.md` contains the commands, historical builds, corrected defects
and browser evidence paths. The RC package includes the latest canonical fixture
pair and capture manifest, plus the five successful current-build screenshots;
historical failing screenshots are retained locally outside this package.

For a new integration run, use `scripts/generate_replay_fixtures.py` against the
running current frontend proxy and a backend configured with
`PLANNER_MODE=deterministic`. Do not reuse frozen fixture files as evidence of a
later code revision. No paid model or official-feed request is part of RC checks.

## Remaining release and product gates

- Merge/review on the target branch, push/remote CI, staging/production deployment
  and deployed version/replay/offline acceptance are **NOT RUN** for this RC.
- Ruff is unavailable and no project lint script exists; lint is **NOT RUN**.
- Live official data, hazard/shelter/route layers, Web Push/FCM and Rescue Beacon
  are separate feature scopes, not claimed by this candidate.
- Only the central Tokyo map is installed. Geolocation QA is a browser mock;
  real-device GPS/battery endurance/background acceptance is **NOT RUN**.
- Cloud Run/Gemini/ADK and Ekispert boundaries remain in the code; prior MVP
  production evidence does not establish deployed acceptance for this candidate.

Next gate: review this exact candidate, then separately authorize and validate
merge/push/deployment. Re-run the relevant tests and browser checks if runtime
code changes before release.
