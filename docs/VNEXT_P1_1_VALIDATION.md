# P1.1 accessible GPS UI — local acceptance

Status: **COMPLETE for the authorized local implementation and acceptance**.
Full P1.1 release: **PENDING real-device and production acceptance**.
Date: 2026-10-08 JST.

## Provenance and boundary

- Baseline: `6eeba78b180d52ce1bb845728442251b9d38a50b` from the original 734d checkout.
- Dedicated branch: `codex/vnext-p1-1-accessible-gps`.
- Workspace: `C:\Users\jacks\.codex\worktrees\vnext-p1-1-accessible-gps\72H`.
- Implementation commit: `2bea4a70fe953c32f4f6a5bab5c427703231dd86`.
- Final production web build: `9H889OhKjWnSKj1ZwsfEQ`, served locally on port 3015; backend on 8014.
- The original checkout still has the baseline HEAD and only its original untracked approved requirement document.
- This acceptance record and completion-status updates are a subsequent documentation-only commit.
- Local planner uses deterministic mode. This is not new Gemini/ADK, cloud or live movement-provider acceptance.
- Browser GPS and positive movement evidence are controlled test inputs, not real-device measurements or official movement instructions.
- Actual JMA HTTP results are recorded separately from typed controlled browser fixtures. No production test endpoint or source allowlist was added.

## Gates

| Gate | Result |
| --- | --- |
| National artifact validation and reproduction | PASS: 47 prefectures, 1,953 areas, 125,130 original features, 1,120 shards; regenerated manifest hash identical; packaged registry byte-identical to catalog |
| Geometry / worker boundaries | PASS: 15 tests, included in the frontend suite; Tokyo, Osaka, Hokkaido, Okinawa, Ishigaki, cross-boundary/provisional/hole, foreign coordinates, missing/error worker, corrupt catalog |
| Converter decoded-byte boundaries | PASS: 2 tests, including JSON array overhead |
| Full backend regression | PASS: 133 tests; independently rerun in this worktree |
| Full frontend regression with three fresh API fixtures | PASS: 27 files / 211 tests / zero skipped; independently rerun and confirmed by Main |
| Typecheck / production build | PASS; 10 static pages, 23 offline-shell assets |
| Browser mobile / desktop | PASS; three languages, 320/375/390/430px, 100%/200% text; Home onboarding, Plan and More matrices total 72 cases with zero horizontal overflow |
| Accessibility | PASS: semantic headings, explicit control labels, polite location-result announcement, keyboard-visible 3px focus outline; body paragraphs >=18px, primary controls >=56px, emergency/onboarding GPS actions >=64px; measured onboarding text contrast >=9.48:1; reduced-motion disables animation |
| GPS lifecycle / movement presentation | PASS: explicit request, denial without automatic retry, real N03 worker resolution; MONITOR/SHELTER_IN_PLACE have no map/watch; controlled authorized Home reaches ready map with one stable watch; background/offline/route expiry clears watch and closes movement UI |
| Offline / cached reload / reconnect / storage | PASS: installed shell provides emergency basics before setup while offline; cached location is labelled last known with original timestamp; GPS does not verify safety; network restoration remains RECONNECTING without renewed proof; storage failure produces a readable warning and forgetting clears the point |
| Location / profile API through local production proxy | PASS: same session, canonical municipality path, unchanged GPS time after settings save, no network/movement promotion, valid unknown session 404, invalid path/coordinate payload 422 |
| Independent Luna Max review | PASS; initial GPS/reconnect, metadata update, stale retry, map disclosure and map/watch-loop findings closed; final CSS evidence checked |
| Secret scan / diff check | PASS |

Backend tests emit one existing Starlette/httpx deprecation warning. No Ruff
gate is configured/installed in this checkout, so Ruff was not run. Existing
bare npm has a local minipass loader problem; tests/build use the installed Node
entry points, and the test-only jsdom dependency/lock was validated with an
isolated npm 11 runtime. Global npm was not changed.

## Browser evidence and regression repairs

The final build's `final-onboarding-matrix.json`, `plan-matrix-final.json` and
`more-matrix-final.json` record all 72 cases. More's 200% power selector and
English profile-grid overflow were found in browser QA and repaired with
bounded widths and shrinkable grid tracks. Fixed navigation has labels and
safe-area padding; pages scroll to reach controls. Existing critical protection
scenes may suppress navigation, as permitted by the approved spec.

Controlled watch callbacks exposed a map reconstruction feedback loop missed
by pure lifecycle tests. Map initialization now uses route geometry semantics
instead of presentation-object identity. A jsdom integration regression
registers a watch, emits a fix and reallocates equivalent route/geometry objects;
the map remains one instance and the watch remains one registration. Main's
final-build browser record confirms `watch=1, clear=0`; going offline confirms
`watch=1, clear=1, active IDs=[]` and no movement map. Route-expiry/background
records were captured on the immediately preceding build
`V7747K1QEs-M7txP3I1EN`, whose map/lifecycle code is identical; the subsequent
change was confined to mobile CSS and was rechecked in the final matrices.

Ignored local artifacts are under `.work/p1-1/`, including:

- `area-validation.json` and `area-validation-reproduced.json`.
- `http-final/manifest.json`, `live-start.json` and `location-profile-probe.json`.
- `frontend-final.log`, controlled browser fixtures and `browser/*` JSON/text/PNG evidence.
- `browser/mobile-zh-375-final.png`, a final-build viewport screenshot.

Replay capture through the real pipeline reached 11 events / four immutable
plans / ONLINE_VERIFIED. Actual JMA capture reported STALE, five official
evidence records, zero plans and movement_authorized=false. Browser manual
region selection and settings save also exercised the actual backend. Positive
movement fixtures are clearly marked controlled input; they are not official
observations, real evacuation instructions or proof of live-provider readiness.
DOM accessibility labels were inspected; a physical screen reader/device was
not part of this local browser acceptance.

Temporary geolocation/fetch/storage/visibility mocks were removed by reload.
Browser network/media/viewport overrides were reset. Controlled cached session
and location records were cleared, leaving the local application before setup.

## National data provenance

Manifest SHA-256:
`4f15407e751faf3b47fe7b92081ee92aa4b83e565d9963752dd378a6a2c91b3b`.
The manifest records official N03-20260101 archive/provisional-boundary PDF
hashes, source URLs, attribution, shard hashes and counts. Original polygon
rings are retained. The complete compressed national set is 422,595,506 bytes;
administrative shards are lazy-loaded and never nationally precached. Device
cache is bounded to 32 MiB. Query limits, missing shards or worker/hash failures
provide manual selection rather than invented jurisdiction or safety.

## Separate release gates

NOT RUN / outside this delivery: real-device GPS precision, permission prompts,
PWA background behavior and endurance; production preview, cloud deployment
and traffic promotion. Offline first-use acceptance assumes the app shell was
already installed/cached; an entirely uncached website cannot bootstrap while
offline. Earlier production release records are historical and cannot be used
as evidence for this branch. Full P1.1 release remains pending these gates.
