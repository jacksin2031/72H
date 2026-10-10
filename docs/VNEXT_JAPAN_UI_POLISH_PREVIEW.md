# All Japan map and UI polish — 2026-10-11 JST

Scope: user-authorized nationwide map implementation, UI polish, zero-traffic
Cloud Run Preview deployment and acceptance. Production promotion is not authorized.
Branch: `codex/ui-map-polish`.

## Implementation

- Integrates the existing P2.2 application baseline `b80c808` with UI work
  `8ea1d66` and offline map fetch repair `d7f7f2f`. Backend behavior is identical
  to the existing P2.2 baseline; the new changes are presentation and map caching.
- `/map` is a public national reference map with no session, GPS request or
  movement authorization. It is linked from More's collapsed tools and Demo.
- National overview, pan/zoom and region selection cover Hokkaido, Honshu,
  Shikoku, Kyushu, Okinawa, Yaeyama, Ogasawara and Minamitorishima. Data/tile
  extent `[120,19]–[156,48]` is a viewing extent, not a legal national boundary.
  Camera bounds have padding so a portrait viewport can show the whole country.
- Dark ocean `#0b131e`, land `#29343f`, coast `#a3b6c7`. Low zoom uses verified
  Natural Earth outlines; zooming in fades in monochrome GSI standard tiles.
  Generalized coast lines stop at zoom 9; they are not surveyed street-scale coasts.
- Consolidated map information avoids fixed-position collisions among title,
  legend, status, caution and attribution. SVG navigation/control icons have a
  fixed 24px viewBox. Geographic marker anchors remain unchanged; overlapping
  markers/controls are suppressed instead of shifting their locations.
- Documented historical JMA epicenters can be selected explicitly. Three expanding
  rings illustrate the event; they do not estimate seismic arrival or intensity.
  Reduced-motion preferences disable ring animation. No live epicenter is invented.
- A downloaded shell and pinned national land asset remain usable offline.
  GSI detail tiles require a connection and are excluded from API/SW caching.
  Existing Tokyo road-pack detail remains limited to its declared pack bounds;
  national outlines do not imply nationwide offline roads or safe routes.

## Source integrity

National asset `/maps/japan-land-50m.geojson`: 284073 bytes, 71 features,
SHA-256 `32a1f99f53084df8d5aaae431d5edfbb41925248954a3836b071ec0861b29b42`.
Natural Earth public-domain attribution and GSI attribution remain visible.
The tile proxy validates zoom/coordinate/extent, fixed upstream, PNG type and magic.

## Local acceptance

- Frontend: 285 PASS, 3 existing SKIP, 43 passing test files / 1 skipped.
- Backend: 150 PASS; existing Starlette/httpx deprecation warning.
- TypeScript, optimized build, secret scan and whitespace check: PASS.
- Main In-app Browser at 390px: complete national overview, clear dark land/sea,
  region selector and historical epicenter jump. Marker coordinates stay at the
  documented point, nested rings animate, reduced motion disables them.
- Physical Android/iPhone GPS, screen reader and battery endurance: NOT RUN.

## Cloud acceptance

Pending immutable build, zero-traffic deployment and HTTP/browser acceptance.
The prior Tokyo-only UI Preview `h72-uimap-d7f7f2f` passed its own scoped acceptance;
its evidence is in `.work/ui-map-preview/final` and is not nationwide acceptance.
Production rollback/current revision remains `h72-more-0434633` at 100%.
Source synchronization must be verified separately from deployment.
