# Map places and roads — local validation

Authorized by the 2026-10-11 request to add places and roads to the map.
Implemented on `codex/map-places-roads`, based on the time-driven wavefront
branch. The shared simulation/reference map uses the same new style.

## Behaviour and provenance

- Replaced the compressed standard raster overlay with independently styled
  [GSI vector tiles](https://maps.gsi.go.jp/development/vt.html), preserving the
  dark land/sea base, offline Natural Earth outlines and clear coastlines.
- [Official endpoint and zoom range](https://github.com/gsi-cyberjapan/gsimaps-vector-experiment):
  `experimental_bvmap`, vector zoom 4–16, overzoom up to the map's zoom 17.
- Layers use the source names and annotation categories in
  [GSI's sample style](https://github.com/gsi-cyberjapan/gsivectortile-mapbox-gl-js).
  Major roads and geographic names appear from zoom 6; railways/rivers from 8;
  station labels from 11; local roads from 12; facilities from 13; buildings from
  14. Availability also depends on the actual official tile content.
- Japanese geographic labels retain official names. Full `annoChar` names and
  whole-word/reading-bearing anchors prevent split character annotations from
  being displayed as isolated place names. Collision placement and text halos
  keep labels readable. No new raster colours or icon sprite dependency.
- Below zoom 6, approximate region anchors use the existing region picker views,
  with separate approximate anchors for Chugoku and Shikoku. These are region
  labels, not surveyed cities or boundaries.
- A same-origin fixed-host proxy accepts only Japan tile coordinates and the
  one official font with valid 256-codepoint ranges. Redirects are disabled;
  media type, binary envelope and streamed/decompressed size (1.5 MB) are checked.
  No incoming cookies, authorization headers or arbitrary URLs are forwarded.
- Device GPS protection now defaults on for all shared-map users, including
  the exercise views. All online vector layers and their source are removed
  before GPS centring. Clearing GPS resets Japan overview before restoring
  online detail. Native GPS permission was not requested during validation.
- At widths up to 520px the information card uses one column and wraps legends.
  This fixes the narrow title column introduced by the larger legend.
- The P/S propagation model, simulation clock, evidence/Safety Core, append-only
  plan history, hazard classifications and movement gates are unchanged.

## Validation

- Frontend: **325 passed, 3 existing fixture skips**, 48 test files passed.
  TypeScript, Next production build, repository secret gate and diff whitespace
  checks passed. Build: `I4CeZW3cu0J2zCVSdDfpP`.
- Tests cover strict vector/font allowlists, upstream header isolation and
  redirects, invalid binary/HTML, bounded chunked streams, offline responses,
  label collision settings and the GPS removal/reset ordering. Existing tests
  still verify time-driven waves, remount continuity and deterministic clocks.
- Actual local vector and glyph endpoints returned valid PBF/HTTP 200.
- Browser acceptance on `http://127.0.0.1:3012/map`: Japan overview, Tokyo
  district/station labels, detailed streets/facilities and Okinawa coast/names.
  320px Traditional Chinese and English cards fit without horizontal overflow
  or overlap with controls; viewport override and language were restored.
- Ignored local evidence in `output/playwright/`:
  `map-places-roads-detail-20261011.png`, `map-places-roads-320-20261011.png`,
  `map-places-roads-okinawa-20261011.png`, `map-places-roads-overview-20261011.png`,
  `map-places-roads-browser-20261011.json`.

## Boundaries

Roads/places are geographic references, not live opening/passability,
historical 2011 road conditions, verified safe destinations or safe routes.
The official vector service is experimental and may change or omit tiles;
partial loading is explicitly shown without substituting invented detail.
Detailed vectors/fonts need network (ordinary HTTP cache may retain visited
tiles); no nationwide offline street pack or Service Worker API cache was
added. Verified offline outlines and local region anchors remain available.
Real-device GPS/network acceptance, new live incident acceptance, Preview and
production deployment were **not performed** for this change.
