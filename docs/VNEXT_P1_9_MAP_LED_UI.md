# P1.9 — Map-led, minimal-frame disaster simulation UI

Date: 2026-10-10 (JST)
Branch: codex/p1-9-map-led-flat-ui
Release gate: Preview only, production HOLD.

## Visual redesign

- Dark forest-black full-screen shell, turquoise countdown, mint success, orange/red danger indicators.
- Before the earthquake: bold simulated time and event countdown, a horizontal progress meter, compact map beneath the hero and a single bottom next-event dock.
- After the earthquake: red event headline, prominent actual Mock Live NOW action and plain-text NEXT/AVOID rows (without surrounding cards).
- Plan: flat NOW/NEXT/AVOID vertical list; individual reasons available on demand.
- Timeline: light neutral background, small event status indicators, expandable historical source links and embedded map preview.
- Map: full-screen MapLibre road reference, pan/zoom, an explicit limitations sheet; cannot call external navigation or select a fabricated shelter/route.
- 4-tab navigation stays in the simulator; More/gear exits safely and clears in-memory exercise credentials.

## Geospatial contract

The only included validated map package is tokyo-central-v1, consisting of OpenStreetMap major roads and NOT live or historical hazard extent, temporary shelter, safe route, location pin, epicenter or GPS. The separate MapLibre component fetches /maps/catalog.json, strictly parses the catalog, integrity-verifies the downloaded reference pack by SHA-256, then renders road geometry. If either check fails it displays a safe "map unavailable" state with no fallback to unverified raster tiles.

Tokyo roads are deliberately labeled as reference only and geographically unrelated to historical cases such as 311 Tohoku. It is inappropriate to draw routes, shelters, inundation polygons, or a fabricated current position from this data. Such capabilities require supported hazard-specific deterministic rules and validated geospatial data; not part of this UI release.

Mock Live's original synthetic request path, the 600x acceleration before the event, reset to 1x, backend AI/Safety Core, key handling and real Live separation are unchanged. Historical tsunami and blackout entries are timeline context only.

## Acceptance evidence

- Physical ASUS_AI2201_A Android Chrome, viewport 411 CSS px. Setup -> simulated home -> 600x countdown without Mock Live call -> actual first Mock Live request at ~6.1 seconds -> real Gemini/ADK and NOW/NEXT/AVOID -> timeline -> full map -> end simulation. No horizontal overflow.
- Verified reference roads fully rendered on simulated home, event timeline and full-screen map after a flex-container sizing correction using absolute-fill and ResizeObserver.
- Verified no verified shelters/routes were presented. Full-screen map supplies road-only reference plus explanatory warnings.
- Unit regression: failing map catalog does not invoke GPS, tile fallback, route navigation or phone APIs. A paused synthetic prelude cannot trigger Mock Live.
- Full frontend/backend test suites, production Next build, secret scan and source status verified separately.
