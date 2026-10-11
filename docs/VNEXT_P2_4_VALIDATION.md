# P2.4 local validation — official tsunami and designation references

Date: 2026-10-11 JST. Branch: `codex/p2-4-official-tsunami-shelters`.
Baseline: `767c676`. Status: PARTIAL for the overall P2.4 phase; the bounded
Ishinomaki reference integration is implemented and locally validated.

## Delivery boundary

All-Japan geography remains available. Official inundation and designation data
are a bounded Ishinomaki pilot, not nationwide safety coverage. The pack has no
independent complete inundation-study coverage geometry and remains PARTIAL.
Outside polygons is UNKNOWN; source A40 positional accuracy is a 25 m standard
deviation, not a maximum-error bound. Nominal intersections therefore remain
uncertain and preserve raw depth labels.
The A40 listing uses a maximum-offset label while the linked v2.1 product
specification describes a sampled standard deviation. The more specific
specification is retained as STANDARD_DEVIATION, never a guaranteed error bound.

Every query keeps `safe_location_verified=false` and `route_authorized=false`.
Emergency-site designation, shelter identity, current opening and route status
remain separate. No opening, capacity, vertical-evacuation condition or road
passability is inferred from these data.

## Current official-source probe

The actual JMA VTSE41 adapter read the official `eqvol.xml` feed successfully
(HTTP 200, 17,613 bytes). At the probe there was no VTSE41 bulletin. The local
read-only endpoint returned `LIVE_REFERENCE`, `status=UNKNOWN`,
`source_status=UNKNOWN`, null publication, zero forecast areas and
`safety_authority=NONE`. This is source availability evidence, not evidence of
an actual live tsunami warning or its absence. Update/correction/cancel semantics
are tested separately with fixtures; live incident acceptance is NOT RUN.

## Validation ledger

| Check | Result / evidence |
| --- | --- |
| Official pack builder | PASS; complete `verify_pack` readback using Shapely/PyProj/ijson in the bundled Python runtime |
| Manifest pin | SHA-256 `2c56bb3e82ca10b40266743dddc0fc1c56e34db3d48dd66701268f7b91da9bf9`, 58,152 bytes |
| Actual assets | All 11 sizes/hashes match; 39,859,383 bytes, 10 inundation shards and one places asset |
| Geometry | 56,543 features, 2,025 MultiPolygon features, 5,806 holes; 931 invalid source geometries repaired and recorded in manifest; no simplification/rounding |
| Places | 395: 300 emergency sites, 95 ordinary shelters; 266 tsunami-designated emergency sites; all opening states UNKNOWN |
| Frontend | PASS, `node node_modules/vitest/vitest.mjs run`: 311 passed / 3 skipped, 46 passed files / 1 skipped file. The three pre-existing P0 fixture integration tests require `P0_API_FIXTURE`; not represented as passes |
| Backend | PASS, full `services/agent-api/tests`: 178 passed; compileall PASS |
| TypeScript / build | PASS, `tsc --noEmit` and `node scripts/build.mjs`; final Next build ID `4rWQq0XTNPCZ70cochEeG`, 13 static pages and 32 offline assets |
| Secrets / whitespace | PASS, `scripts/check_secrets.py` and `git diff --check` |
| Independent review | No remaining reproducible blocker; focused backend 4/4, actual pack/query/panel/offline 22/22 and final cache lifecycle 5/5 passed |
| Browser desktop | PASS, 1440×1000; actual amber inundation/places render, layer toggle, public place query, same-name emergency/shelter roles, all eight ordinary-shelter UNKNOWN classes, filter 395→266 and source dates |
| Browser mobile | PASS, 320×740 in zh-TW/ja/en: document scroll width 305 ≤ viewport 320, 44px query controls wrap without overlap |
| Browser coverage negative | Tokyo map selection returns UNKNOWN / NO_VERIFIED_SURVEY_COVERAGE; public Ishinomaki place returns BOUNDARY_UNCERTAIN and raw depth classes, never safety clearance |
| Browser offline reload | PASS after online warming and again after shell update/migration; HTTP cache disabled and network emulated offline: manifest + all 11 assets HTTP 200 with `fromServiceWorker=true`, local query works, dates unchanged, JMA unavailable |
| Browser console | No errors captured from the fresh production-build acceptance after 08:25 UTC; expected offline network failures recorded separately |

Local acceptance uses Next's `next start` fallback at
`http://127.0.0.1:3012/map` and the final API source at port 8011. The Windows
standalone entry failed with EPERM on its generated dependency junction; its
runtime and Cloud Run container are NOT VALIDATED by this fallback. The optimized
build and browser behavior are independently validated. Ruff was NOT RUN because
it is absent from the API venv.

Evidence artifacts (local, ignored by Git):
`output/playwright/p24/desktop.png`, `mobile-320.png`, `offline-320.png`,
`offline-network.json`, and `offline-after-upgrade.json`. CDP event capture was
complete (`truncated=false`, `hasMore=false`). The first offline capture could
retain ordinary HTTP-cached detail tiles; the final capture disabled HTTP cache
and recorded network failures while verified local vectors/queries remained
available. No Service Worker API caching is inferred from those tiles.

Real-device GPS, nationwide hazard coverage, live opening/passability and a new
cloud deployment are outside this local delivery. Earlier P2.3 Preview and
Production release records are not evidence for this new source revision.
GPS privacy is validated by source order and a MapLibre mock regression
(raster removal before centering; country reset before restoration), not by an
actual device permission or GPS/network session. Temporary offline/HTTP-cache
and viewport overrides were restored after browser acceptance.

## Independent review

Review identified missing positional-accuracy semantics, duplicate VTSE41 area
codes, contradictory total/area statuses, GPS-derived raster tile disclosure,
and reconnect/event-identity hazards. These were fixed and covered by regression
tests. A true JMA parser/adapter plus LiveStore fixture reproduced A issue →
A+B conflict → A cancellation with B active: the B claim stays ACTIVE and
reconnection remains pending until new evidence for the required event group.
Conflict clearing or a new fetch of an old publication cannot bypass that gate.

The final review found shell activation could delete previously downloaded
hazards. The fix uses a persistent public hazard cache and migrates before old
shell cleanup; a two-upgrade VM regression and actual browser upgrade/offline
reload passed. API, query, cross-origin and authenticated data are excluded.
Browser acceptance also exposed an outdated timer reference immediately after
point selection; assessment now uses the current evaluation time, with a
regression test before the next 15-second tick.

## Reproduction

The builder and manifest retain official source URLs, raw hashes, source dates,
CRS, terms, polygon repairs and pinned N03 clipping inputs. N03 municipal borders
select the pilot; they are not inundation-study coverage. Geometry is neither
simplified nor rounded, and the A40 source depth labels are retained. The Miyagi
original depth-point archive is provenance only, not converted into fake polygons.

The web build verifies every asset before pinning the root manifest. The browser
also checks root/asset hashes before making the pack queryable. Only public
static assets enter the Service Worker cache; API responses and GPS never do.
GPS mode removes raster requests before centering, and resets the country view
before restoring raster detail on clear.

Raw snapshots are retained outside the public pack at
`%LOCALAPPDATA%/Temp/72h-p24-official-tsunami-20261011`. Rebuild:

```text
python scripts/build_official_hazard_pack.py --source-dir <retained-source-dir> --source-retrieved-at 2026-10-11T07:34:06Z --reviewed-at 2026-10-11T16:44:00+09:00
cd apps/web
node scripts/prepare-hazard-pack.mjs
node scripts/build.mjs
```

The Miyagi original archive is a provenance reference (3,911,092 depth points).
Rendered geometry comes from MLIT A40-22_04_GML, clipped by the pinned N03
Ishinomaki border. All four source publication dates remain null where not
established; A40 basis date 2022-04-01, Miyagi assumption announcement
2022-05-10 and GSI database update 2026-06-12 are not substituted for publication
or designation dates. Complete risk-survey coverage, facility conditions,
current opening and verified routes remain unresolved dependencies.
