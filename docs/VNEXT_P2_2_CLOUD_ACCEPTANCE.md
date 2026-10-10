# P2.2 Cloud Preview acceptance — Nationwide sea/land map

2026-10-10 JST — **PREVIEW PASS / PRODUCTION HOLD**.

## Immutable deployment
- Branch: `codex/p2-2-japan-map-land-sea`
- Source: `6a6831ebc6fddf703497641f71f73888510d3bb6`
- Cloud Build: `b09f747f-993f-47ca-ad69-a62b363d6650` SUCCESS
- Container: `sha256:43f28b984d53a730988081a4096139636aad9b620bd62cb159da6b097649746c`
- Google Cloud Run: `h72`, project `h-japan`, region `asia-northeast1`
- Preview revision: `h72-japan-6a6831e`, tag `japan-6a6831e`, **0% production traffic**
- Preview: https://japan-6a6831e---h72-vux6j7xjka-an.a.run.app/disaster-test
- Production before/after: `h72-more-0434633`, **100%**; no production promotion.

## Cloud service and tiles

- `GET /api/reference-tiles/6/56/25`: **HTTP 200**, `image/png`, **83,492 bytes**.
- `GET /maps/japan-land-50m.geojson`: **HTTP 200**, **284,073 bytes**.
- `GET /disaster-test`: **HTTP 200**.
- Real Android network trace recorded **30 GSI national reference tiles returned 200 / 0 errors**.
- Source attribution `国土地理院` and `Natural Earth` visible above the collapsed bottom panel; distinct Japanese sea/land legend visible.

## Physical Android ASUS_AI2201_A Chrome (411px)

- Enters historical 311 accelerated drill and navigates to /simulation.
- No premature Mock Live start during 600× prelude; first event triggered after approximately **6143 ms**, and actual Cloud Gemini/ADK generated the synthetic NOW plan.
- All-Japan map rendered Japanese coastlines and detailed road/place-name references. Sea and land colors visually distinct, with GSI source overlay and Natural Earth fallback.
- Archived offshore JMA epicenter marker and nation-overview control visible in full map. Japan extent comprises `[120,19]-[156,48]` and allows navigation across Japan/nearby ocean, distinct from hazard polygons.
- Simulated GPS at 35.6895°N,139.6917°E (±18m) yielded **389.1 km** surface distance from 311 archived epicenter, with hazard safety still **UNDETERMINED**.
- Home/Plan/Timeline/Full Map/More flows pass; risk sheet expand/collapse and exit pass. Viewport 411px equals document scroll width 411px (no horizontal overflow).
- Direct screenshot of Cloud full map visually inspected, including corrected no-wrap national button and readable map data attribution.
- No real device GPS used, no emergency call, movement authorization, or verified evacuation route displayed.

## Regression
- Frontend: **275 PASS, 3 pre-existing SKIP**.
- Backend: **150 PASS** (one Starlette deprecation warning).
- TypeScript, Next optimized production build, asset integrity, secret-pattern scan and `git diff --check`: **PASS**.
- GSI tile route rejects out-of-range/malformed requests; no arbitrary upstream URLs, no user GPS sent to GSI.
- Source assets derived from public-domain Natural Earth 1:50m land and GSI national standard tiles; coarse coastline is not a coastline-distance risk score.

## Release limits
No push, merge or production promotion. Real-time official earthquake intensity, municipal tsunami-inundation polygons, terrain height, opening status of designated shelters and independently verified evacuation routes are **not** provided by this reference map. The sea/land colors alone must never be interpreted as safety classifications.
