# vNext production release — 2026-10-05 JST

Status: **COMPLETE — vNext P0 production release and acceptance**.
External submission steps and future live/native features remain pending.
This record supersedes historical MVP deployment claims for the current image.

## Source and release review

- Original locally accepted RC: `c525df378a4fc0119153573f36d9f208116d5bbb`.
- Final read-only review found one P1 release blocker: Docker ran npm postinstall
  before copying `scripts/prepare-map-worker.mjs` into the build image.
- Separate minimal fix commit: `8d1836ef6cc973cd98597e2f090329e4e6351535`.
  The original RC and its ignored source/evidence package remain unchanged.
- No other P0/P1 was found within the bounded review. This is not a comprehensive
  security audit or proof of live disaster-data correctness.
- `main` fast-forwarded from `772c264` to `8d1836e` and was pushed without force.
- Main's untracked original product-plan draft was preserved before merge at
  `F:\資料夾\下載\72H\.work\preserved-main\20261005-vnext-release\VNEXT_PRODUCT_PLAN.original.md`.
  SHA-256: `4c3c99454a13828621c01e749a5fe117a31aa53b0b6bf62750b013a77d9112ea`.

## Build identity and checks

Runtime source: `8d1836ef6cc973cd98597e2f090329e4e6351535`.
An immutable Git archive, not a dirty working directory, was submitted to Cloud Build.
Source ZIP SHA-256: `0fa8ec11db77c034df08eea38096ba79bb8ccbedd463da50f533a9fd9da7aec4`.

| Check | Result |
|---|---|
| Local RC | 69 backend / 77 frontend with refreshed API fixtures; TypeScript and browser acceptance PASS |
| Final read-only review | 69 backend; 73 frontend + 3 fixture-dependent skips; no additional P0/P1 |
| GitHub CI | [37310891416](https://github.com/jacksin2031/72H/actions/runs/37310891416) PASS: 69 backend, 73 frontend + 3 skips, secret scan, TypeScript, Node 24 production build |
| Fresh deployed replay → frontend contracts/projections | PASS: all 77 tests / 12 suites using preview Gemini replay states and final snapshot |
| Canonical production replay → frontend boundary | PASS: 8 contract/projection tests / 2 suites using the canonical Gemini capture |
| Cloud Build | `623824c3-128e-403e-8d12-cc883e699182` SUCCESS; Docker fix proved by actual image build |
| Runtime image digest | `sha256:9d7e22b877aff64502903cfe90b233c8365a8df065e8e3b75fee5bcda6eb3005` |
| Deployed web build ID | `kwavxW-VSKN8tUxQJoWo4`, observed in `/sw.js`; local `qsh1YmaIahspngAHgjxoR` is historical local evidence |

The CI fixture skips are explicit: ignored `.work` replay captures are not
available in a clean checkout. They are not counted as passing integration tests.

## Production acceptance

Public URL: https://h72-602701455122.asia-northeast1.run.app

| Check | Result |
|---|---|
| Zero-traffic preview revision | `h72-vnext-8d1836e`, public tag `vnext`, old revision retains 100% traffic during preview |
| Candidate HTTP/assets and actual Gemini/ADK replay | PASS: 11 events / 4 plans / 12 actions, 4 `GEMINI_CANDIDATE_APPLIED`, zero fallback, `COMPLETED` / `ONLINE_VERIFIED` |
| 100% production revision | `h72-vnext-8d1836e`, verified by Cloud Run service traffic state |
| Canonical-origin HTTP/assets and actual Gemini/ADK replay | PASS: 11 events / 4 plans / 12 actions, 4 `GEMINI_CANDIDATE_APPLIED`, zero fallback, `COMPLETED` / `ONLINE_VERIFIED`; same web build and reviewed map digest |
| Clean browser desktop/mobile, map, local persistence, offline/reconnect | PASS: fresh canonical context, same build cache, 11-event GUI replay / 4 plans / 4 Gemini candidates / zero fallback; Tokyo map/profile, 390×844 viewport, mocked LKL, cached nonempty plan and same-session reconciliation |

Preview browser acceptance passed with the new build: Japanese Home/Plan/More,
Tokyo reference roads/profile pins, Osaka unsupported, mock location opt-in,
reload as LAST_KNOWN_LOCATION, original capture-time preservation through offline
SURVIVAL and permission denial, Forget deletion, and 390×844 viewport. No console
errors/warnings were observed. Start automatically advances replay; preview was
paused at event 2. This preview GUI result is not a full GUI replay result.
The clean canonical-origin GUI session `2ca8289a-9001-414b-b59d-6430e38bfe79`
completed 11/11 with Plan v4 ACTIVE / ONLINE_VERIFIED. History preserves v1–v4;
the trace DOM contains exactly four `GEMINI_CANDIDATE_APPLIED` headings and no
fallback. Sources retain synthetic official evidence and reject unverified social
content as action evidence. Physical browser offline and cached reload preserved
nonempty Plan v2 with its original verification time; SURVIVAL retained that
minimal guidance. Physical online alone stayed RECONNECTING. Only the subsequent
official and transport replay refreshes restored ONLINE_VERIFIED at event 10.
The mobile mock location check verified consent, capture, reload as LAST KNOWN
with identical capture time, and Forget deletion. Browser finished online / AUTO /
Home with the stored point deleted. No actual GPS was acquired.

One expected offline RSC `ERR_INTERNET_DISCONNECTED` occurred; the cached page
rendered successfully. No runtime console errors/warnings were observed before
the intentional physical-offline test. Screenshots and DOM records are in ignored
`output/playwright/vnext-production/`, including `canonicalfinalhome.png`,
`canonicalfinalsources.png`, `canonicalfinalhistory.png`, `canonicalfinaltrace.png`,
`canonical-offline-survival-demo.png`, `canonical-mobile-home-final.png` and the
corresponding `canonical-*-dom.yml` records. Hashes are retained in the local
`.work/production-vnext-8d1836e/release-manifest.json`.

The canonical replay ends with **L1 / MONITOR**, not a required L4 assertion.
Its newer, same-area EARTHQUAKE assessment is `ACTIVE` with `level: null`.
`VNEXT_P0_CONTRACTS.md` defines this as L1 information, and
`apps/web/tests/vnext.test.ts` explicitly covers a newer ACTIVE update superseding
an older same-scope L4. This is an information-state projection; it does not
authorize evacuation, assert a safe route or cancel a previously started safety
check. Historical screenshot names containing L4 are not this release's final
severity acceptance criterion. Across distinct applicable area/hazard scopes,
a parent update still cannot erase a current child critical assessment.
Final independent snapshot projection review confirmed this result with no
model call and no P0/P1. A nonblocking UX follow-up is to label L1 as "ACTIVE,
severity not supplied" so it is not mistaken for a measured drop in hazard level.
No canonical Home L4 screenshot was captured in this release run; early-event
L4/critical-check projection is covered by the fresh deployed API fixture tests.

Deployment preserves runtime identity `h72-runtime@h-japan.iam.gserviceaccount.com`,
Secret Manager's fixed `h72-ekispert-api-key:2` reference, Gemini mode, max one
instance, CPU 1, memory 1 GiB, concurrency 8, timeout 60 seconds and existing public
invoker IAM. A tag on the existing public service is a **public zero-traffic
preview**, not a private staging service. Stable rollback revision: `h72-00005-vql`.

## Scope and remaining work

Synthetic Tokyo replay exercises the actual application pipeline. Osaka validates
generic area/profile handling; its map coverage is intentionally unsupported.
The shipped central Tokyo OSM pack is a geographic reference, not hazard or
safe-route evidence. Device geolocation cannot confer official area authority.
Last Known Location retains one local point only after consent; mocked browser
geolocation acceptance does not prove physical-device GPS.

Live JMA/Safety Tips/municipal shelter/JARTIC ingestion, hazard/shelter/route
overlays, Web Push/FCM, Rescue Beacon, native background protection and real-device
battery endurance remain unimplemented or NOT RUN. Ekispert connectivity was
verified for the previous production image; do not describe that historical
provider smoke as a fresh vNext connectivity test.

The clean scenario selector initially chooses Osaka. Choose **Tokyo Earthquake
Replay** for the installed central-Tokyo map and the full judge/demo golden path;
Osaka's unsupported map is intentional, not a fallback to Tokyo.

## Submission freeze decision

**Do not freeze the submission default branch yet.** The self-made approximately
three-minute YouTube video, dashboard GitHub App linkage, participant information,
architecture upload and final submission confirmation remain external pending
steps. Record the final `main` SHA and freeze only when the actual submission is
ready. The deployed runtime source above remains an immutable release identity.
After submission, preserve the submitted default branch and deployment through
2026-12-01 under the [official event requirements](https://zenn.dev/hackathons/google-cloud-japan-ai-hackathon-vol5).
