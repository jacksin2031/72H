# P2.0 — Hazard-aware geospatial groundwork and explicit risk uncertainty

2026-10-10 JST. Branch: codex/p2-0-hazard-aware-geospatial. Production gate: HOLD.

## Scope

Historical simulation map now shows archived Japan Meteorological Agency (JMA) epicenter metadata for all five curated disaster scenarios, with a separate major Kumamoto earthquake anchor which becomes current only after its second earthquake has actually played. Every coordinate is stored in decimal degrees with a source URL. This is historical fact only, not live JMA data.

The user may opt in once to browser GPS on the exercise's Map tab. Coordinates, accuracy and timestamp are held only in the mounted React component (not in production Live storage, localStorage, IndexedDB, URL, network/API payloads or Gemini context). A browser GPS observation older than two minutes or with >1000 m reported accuracy is unusable; it expires automatically and can be cleared. Every screenshot and developer test injects fake Tokyo coordinates through the browser geolocation override, never actual user GPS.

The deterministic pure exposure checker calculates great-circle surface distance (haversine) between valid GPS and known epicenter, with a coarse range derived from reported horizontal positioning accuracy. The exposed value is explicitly NOT a shaking intensity, building risk, personal safety or route clearance. Extensive rupture, local ground amplification, actual JMA station intensity and building state cannot be inferred from distance.

Historical tsunami warning status becomes visible only after the matching tsunami milestone has played. If the tsunami warning is played, the panel displays authoritative generic JMA behavior and a JMA information link, not an actual evacuation order. It NEVER asserts that a location is outside tsunami hazard solely from epicenter distance or lack of a warning. Ground elevation, official local inundation polygons and approved hazard-specific evacuation shelters are not yet connected, so every tsunami and safety-destination determination remains UNDETERMINED.

The underlying reference map is the pre-existing integrity-verified central-Tokyo OSM road pack. On-screen GPS and historic epicenter markers appear only if a coordinate lies inside that pack. The 311 Sanriku epicenter lies outside the Tokyo map; it is NOT plotted at a false Tokyo point. Full map shows a position/risk panel with JMA links, uncertainty, and geolocation controls. The UI never offers a safe route or destination based on mock signals.

**Not yet implemented**: real JMA earthquake epicenter streaming into the Live domain contracts, official tsunami forecast-area warnings with freshness and area-scoped provenance, official municipality inundation polygons and elevation/DEM datasets, certified shelter hazard eligibility and opening hours, independently verified traversable routes, or a full deterministic high-risk movement-authorizing Safety Core. The present work is a safer visualization and data-mapping foundation, NOT an operational evacuation/safety recommender.

## Source anchors

- 311: https://www.data.jma.go.jp/eqev/data/kyoshin/jishin/110311_tohokuchiho-taiheiyouoki/index.html
- 1995 Kobe: https://www.data.jma.go.jp/eqev/data/1995_01_17_hyogonanbu/gaiyo.html
- 2016 Kumamoto: https://ds.data.jma.go.jp/svd/eqev/data/2016_04_14_kumamoto/index.html
- 2018 Iburi: https://www.data.jma.go.jp/eqev/data/kyoshin/jishin/1809060307_hokkaido-iburi-tobu/index.html
- 2024 Noto: https://www.data.jma.go.jp/eqev/data/kyoshin/jishin/2401011610_noto/index.html
- JMA tsunami protective advice: https://www.jma.go.jp/jma/kishou/know/jishin/tsunami_bosai/index.html

## Verification

- Unit suite tests GPS opt-in / auto-expiry / privacy, historic epicenter timestamps, geodesic math, unknown-data fail-closed handling, and historical tsunami boundary.
- Real physical Android Chrome used explicit fake GPS latitude 35.6895 / longitude 139.6917 with 18m accuracy; 311 surface distance output 389.1 km; archived offshore epicenter marked outside map; no location sent to backend; no movement permission.
- All new work restricted to the simulation route, never the regular P1.2 Live Dashboard.
