# Central Tokyo road extract

© OpenStreetMap contributors. This database extract is made available under
the Open Data Commons Open Database License (ODbL) 1.0, including its share-alike
terms. This license applies to the road database, separately from application
source code.

- Source and attribution: https://www.openstreetmap.org/copyright
- Full license: https://opendatacommons.org/licenses/odbl/1.0/
- Data: `tokyo-central.geojson` (publicly downloadable in the application)
- Provenance, query, area, capture time, data timestamp, bytes and SHA-256:
  `manifest.json`

The database contains a bounded extract of major road geometry. No hazard,
current road availability, safe route, shelter eligibility or official disaster
status can be inferred from it. Maintainer refresh command:
`uv run --project services/agent-api python scripts/build_offline_map.py`.
