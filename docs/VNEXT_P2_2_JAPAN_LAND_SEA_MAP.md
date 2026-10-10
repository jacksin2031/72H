# P2.2 — All Japan reference map, with distinct land and sea

Date: 2026-10-10 JST. Branch: `codex/p2-2-japan-map-land-sea`. Production: **HOLD**.

## User experience

- The simulation reference map can pan and zoom across **Japan** rather than only central Tokyo, including Hokkaido, Honshu, Shikoku, Kyushu, Okinawa, remote Japanese islands and historical offshore epicenters.
- National map limits form a **viewing box** `[120°E,19°N]–[156°E,48°N]`, not a surveyed legal maritime boundary or evacuation hazard extent. Zoom from 3 to 17.
- The sea and land are consistently distinguished, even without detailed tiles: **sea `#133F56`**, **land `#315944`**, coast `#8BD0BD`. Visible bilingual sea/land legend.
- Online, nationwide Japan's detailed geographic background, place names, topography and roads use **Geospatial Information Authority of Japan (GSI) Standard Map** tiles. The GSI source is linked directly.
- Buttons for zoom, nationwide overview and historical epicenter; explicit one-time GPS permission can focus the user's position. Mobile pan and pinch zoom remain enabled only on the full map; compact previews are noninteractive.
- The existing collapsed dark risk sheet stays as before and tsunami/hazard determination stays **UNKNOWN**. Sea/land/coast data cannot be repurposed as inferred inundation or safe-route advice.

## Data and privacy

- GSI nationwide XYZ standard tiles documented at https://maps.gsi.go.jp/development/ichiran.html and https://maps.gsi.go.jp/help/use.html. Tiles are fetched through a bounded same-origin endpoint `/api/reference-tiles/[z]/[x]/[y]`, with fixed GSI HTTPS domain, validated integers / zoom levels / Japan geographic extent, content type and PNG magic; browser locations and secret headers are never forwarded. Public caching headers apply only to geographic tile images.
- Underlying land polygons are public-domain **Natural Earth 1:50m land geometry**, restricted to polygons meeting the Japan view box (71 features / 284073 bytes). The asset is pinned and verified by SHA-256 `32a1f99f53084df8d5aaae431d5edfbb41925248954a3836b071ec0861b29b42` in client code, and the service worker precaches it for offline map silhouettes. Exact coastline positions at individual street/building scale must be read from GSI, not the generalized Natural Earth outline.
- GSI detailed tiles are intentionally **not** SW-pre-cached, because national raster caching can be large and stale and API responses are excluded from the existing offline-cache policy. Full national detail needs a network connection; if detailed tiles fail, verified country-scale land/sea outlines remain available to a client with the cached shell/land asset.

## Safety restrictions unchanged

No estimated epicentral shaking, coastline distance-based tsunami safety clearance, certified shelters, official inundation polygons, authoritative evacuation paths, real GPS upload or movement authorization is added. Historic JMA epicenter markers are map points for reference only. The user must follow live authorities in real emergencies.

## Verification

- 50m land asset: parsed and SHA-256 pinned; Tokyo/Hokkaido land and 311 Sanriku offshore sea geometry assertions.
- Tile fetch: only Japan-bound z=3–17 coordinates, no open proxy, invalid URLs rejected, bad content type and malformed PNG rejected.
- Android Chrome 411 CSS px: home → plan → events → full nationwide map; 30/30 tested GSI tile responses were HTTP 200, sea/land legend visible, archived offshore JMA epicenter marker and overview button present; verified synthetic GPS and actual Gemini ADK NOW, no horizontal overflow.
- Full frontend/backend regression, production build, secret scan and independent cloud preview sign-off tracked separately.
