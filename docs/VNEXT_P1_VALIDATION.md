# vNext P1 implementation and acceptance

Status: **IMPLEMENTED / NOT FULLY VALIDATED** (2026-10-06 JST).
The user's `/goal complete` request authorizes the [P1 specification](VNEXT_P1_LIVE_ROUTE_DEVICE_ROLES.md), including the approved mobile scene system.
Local implementation and non-GUI verification are recorded below. Required GUI,
browser offline/reconnect and production acceptance remain pending. No Push,
Rescue Beacon, native background execution or new paid API dependency is included.

Implementation branch: `codex/vnext-p1`; baseline: `80b919d`.
The original `F:\資料夾\下載\72H` checkout remains unchanged.

## Acceptance ledger

| Scope | Evidence | Result |
|---|---|---|
| Official live data | Actual JMA response → typed evidence → situation → Safety Core; separate actual Live Gemini/ADK invocation | Local PASS |
| Live source failures | Timeout, malformed XML/schema, future/stale publication, bounded retries/cache, exact TTL and asynchronous publication deadline | Backend regression PASS |
| Mode separation | Live contracts reject synthetic/foreign-situation payloads; Live session in Replay store returns 404; distinct cache stores | Unit + HTTP PASS; GUI pending |
| Destination and route | 512 static Tokyo designations, actual station-sequence CANDIDATE, scoped destination/directive/road evidence gates | Unit + HTTP PASS; rendering GUI pending |
| Movement authorization | Positive configured-test-source gates and missing/conflicting/stale/offline/partner-trust negatives | Deterministic tests PASS; real candidate remains unauthorized |
| Invalidation/history | Route replacement and destination expiry invalidate dependencies; append-only four-version Replay history | Unit + HTTP PASS; GUI pending |
| Notifications | Deterministic plan transitions, bounded inbox and repeated-update aggregation | Unit PASS; route interaction GUI pending |
| Mobile/desktop | Compact scenes, critical takeover, separate preparedness role, conditional map mount | Policy/renderer tests PASS; GUI BLOCKED |
| Handoff | Public HTTPS app link with language only; rejects private origin/credentials/port/unsupported language | Unit PASS; GUI pending |
| Offline/reconnect | Cached age/TTL, degraded high-risk actions, distinct reconnect verification gates, delivered SW/assets/map pack | Unit + asset HTTP PASS; browser offline execution NOT RUN |
| Accessibility | Keyboard/focus, mobile overflow, contrast and real map interaction | GUI BLOCKED |
| Existing suites | Frozen backend 103 tests; frontend fresh Replay + Live API fixtures | PASS — 103 backend / 148 frontend, zero frontend skips |
| Typecheck/build | TypeScript; optimized Next production build and offline asset preparation | PASS |
| Source hygiene | Secret-pattern and credential-file scan; final staged whitespace check | PASS |
| Independent review | Bounded critical LIVE contract/presentation review and focused fix re-review | PASS — two confirmed findings fixed; no same-class remaining finding in the reviewed diff |
| Production | Immutable source/image, zero-traffic preview, actual cloud/model/GUI/offline acceptance | NOT RUN; local GUI release gate blocks deployment |

Unit fixtures do not establish real disaster conditions, open shelters, physically
safe routes, GPS accuracy, battery endurance or successful production execution.
Current destination opening, hazard suitability, movement directives and road
safety have no enabled production source: their allowlists remain empty. See
[source provenance and capability boundaries](VNEXT_P1_SOURCES.md).

## Final local verification

Main independently ran the frozen backend suite: **103 passed**, with one existing
Starlette/httpx deprecation warning. `uv lock --check` and Python compilation also
passed. Ruff is absent from the frozen environment: lint is **NOT RUN**.
No dependency was added solely for lint.

After adding direct LIVE reconnect, route notification, inbox-bound, handoff and
review-driven spatial-action regressions, Main independently reran the final
suite at `2026-10-06T11:03:00Z`
using fresh captures generated through the production-mode frontend at
`http://127.0.0.1:3011`: **19 files / 148 tests passed / 0 skipped**.
Fixture variables were `P0_API_FIXTURE`, `CONTRACT_FIXTURE`
and `LIVE_API_FIXTURE`. TypeScript and the optimized Next `16.3.8` build passed;
the final build prepared 23 static assets (build ID `ZozN1hpVmY7D9O-NMB0C8`).
Host npm `11.16.0` has an existing
`minipass-flush` startup failure; installation used the existing scoped loader
shim without changing global npm or the lockfile.

At `2026-10-06T11:02:32Z`, Main's final production-mode HTTP checks passed:

- Replay: all 11 events, immutable plan versions 1–4, final `ONLINE_VERIFIED`.
- Live: three actual official records, source FRESH, 512 bounded designations,
  one current deterministic plan and no movement authorization for the Tokyo
  profile. The newest actual publication was `2026-10-06T19:57:00+09:00`, scoped
  to `JP-14 / JP-19 / JP-22 / JP-13`; its timestamp and scope were preserved.
  The two older official reports remained individually STALE.
- Actual Ekispert route endpoint: `CANDIDATE` with supplied station geometry.
- The frontend Zod LIVE contract also accepted the captured `live-route.json`
  response in the final full suite; an earlier separate targeted run also passed
  all 3 contract tests.
- Live session accessed through Replay: 404.
- Proxy boundaries: disallowed path 404, foreign Origin 403, oversized body 413,
  unknown Live session and route session 404.
- Eight HTML routes and all 23 precache static assets delivered; service worker
  and MapLibre worker delivered; `tokyo-central-v1` map-pack SHA-256 verified.

Captures and hashes remain in ignored local evidence:
`.work/p0-api-fixtures-manifest.json`, `.work/p1/http-local-final/manifest.json`,
`.work/p1/web-assets.json` and `.work/p1/proxy-boundary.json`.
API/asset delivery does not establish browser service-worker execution.

Independent review found that route/destination projection expiry could close
the map while a HIGH evacuation action remained in the common action projection,
which desktop overview and plan views consume. The common projection now marks
HIGH evacuation actions invalid whenever the complete pre-power spatial gate
fails, and reselects a valid LOW fallback. Tests cover route expiry/conflict,
destination expiry and wrong route claims; HIGH text is absent from active Plan
inputs and the Consumer renderer. Valid authorization survives power-only map
suppression. Review also found a cross-area destination filter mismatch: spatial
proofs now use the exact destination/origin/route claim scopes rather than forcing
all proof into the current profile area. A catalog-valid `JP-27` target positive
and wrong-destination-scope negative pass. The independent reviewer rechecked
only these fixes and their tests; this was source review, not GUI acceptance.

Spatial reconnect intentionally requires new current, scoped official proofs
within the reconnect window. Retrieval of an unchanged JMA report alone cannot
restore HIGH movement or renew publication TTL. Source-specific attestations for
unchanged movement/directive/destination/road publications are not implemented;
the conservative restriction is documented in `OFFLINE_CONTINUITY.md`.

An overlapping build while the local server was running caused `EBUSY` and
incomplete `.next` output, producing HTTP 500. Main verified and stopped only
the task's port-3011 Node process; the frontend owner rebuilt once, then Main
restarted the production-mode server. All final HTTP checks above passed after
that recovery. No application-source change was needed for this build conflict.

## Actual provider/model evidence

Actual Ekispert MCP discovery advertised six tools using the existing
backend-only Secret Manager version 2, kept in process memory without printing
the key. Actual route search normalized three supplied station coordinates and
five waypoint labels as `TRANSIT_STATION_SEQUENCE`. This schematic candidate is
neither walking-road geometry nor safety evidence; no missing geometry is invented.

At `2026-10-06T02:03:17Z`, the actual JMA Hokkaido report published
`2026-10-06T10:50:00+09:00` was CURRENT and scoped exactly to `JP-01`. The Tokyo
acceptance profile correctly had no current plan or movement permission.
At `02:17:03Z`, and again at `10:20:46Z` and `10:44:40Z`, its publication TTL
was correctly STALE without being renewed by retrieval time. Earlier backend
captures are in `.work/p1/http-backend*/manifest.json`; the earlier production-mode
STALE capture is `.work/p1/http-local/manifest.json`.

One bounded actual Gemini/ADK call on SYNTHETIC_REPLAY passed. A separate process,
limited to one call, consumed the actual fresh JMA report and an explicitly
self-reported `JP-01` profile through `LiveStore.start_async`: LIVE,
non-synthetic evidence, one plan, `GEMINI_CANDIDATE_APPLIED / SUCCESS`, and
movement authorization false. No official publication time or area was changed.
Summaries are `.work/p1/actual-model-probe.json` and
`.work/p1/actual-live-model-probe.json`; no fallback occurred.
These are local model/provider observations, not production acceptance.

## GUI blocker and pending acceptance

The mandated Luna Lightweight agent's resumed documentation probe briefly bound
In-app Browser `id=2`, then lost it. The final direct application-open attempt,
after resetting CUA, was:

```javascript
await cua.createBrowserTab("iab", "http://127.0.0.1:3011/dashboard", {visible:true});
```

It returned exactly **`Browser is not available: iab`**. Follow-up inventory was
`{apps:[], browsers:[]}`. No application tab opened: **0 GUI acceptance actions,
0 screenshots**. There was no CLI/Playwright or alternate-model substitution.
The user's instruction to finish other verification first did not waive GUI.

When the provider is restored, resume with the same GUI owner and verify:

1. Desktop preparedness/status/history/sources/handoff and Judge separation.
2. Mobile MONITOR/SHELTER text-first layout, fixed navigation, details sheet,
   critical takeover, consent controls and candidate route warning/rendering.
3. Map mount/unmount under view, freshness and power transitions; accessible
   keyboard focus, contrast and overflow at desktop/mobile sizes.
4. Previously cached reload during genuine loss of connectivity and staged
   reconciliation after restoration; cached age and high-risk denial remain visible.

Then complete the P1 release gates, immutable zero-traffic Cloud Run preview,
actual cloud/provider/model and GUI/offline acceptance before traffic promotion.

## Production baseline and rollback

Read-only inspection at `2026-10-06T10:23:05Z` confirmed
`h72-vnext-8d1836e` still receives 100% traffic, with the existing dedicated
runtime identity and maximum one instance. Its image digest is
`sha256:9d7e22b877aff64502903cfe90b233c8365a8df065e8e3b75fee5bcda6eb3005`.
This is the existing P0 rollback baseline, not P1 acceptance.
No P1 cloud build, merge, push, deployment or traffic promotion has occurred.
