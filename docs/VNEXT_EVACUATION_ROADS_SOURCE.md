# Ishinomaki Central Road Candidate Snapshot

This document records the provenance and bounded scope of the local road-reference pack at `apps/web/public/roads/ishinomaki-central-v1/graph.json`.

## Source and licence

- Source: OpenStreetMap contributors, retrieved once from the public Overpass API at `https://overpass-api.de/api/interpreter`.
- OSM data timestamp: `2026-10-13T06:49:25Z`; retrieval: `2026-10-13T15:51:00+09:00`.
- Licence: Open Database Licence (ODbL-1.0). Attribution: **© OpenStreetMap contributors**; [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright), [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- The public Overpass API returns OSM elements in JSON and accepts a bounded south/west/north/east query with geometry output. This pack uses a fixed box; it does not send a device location. See the [Overpass QL reference](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL), [Overpass output formats](https://dev.overpass-api.de/output_formats.html), and [Overpass public-server guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

## Fixed extent and source query

Coordinates are WGS 84 in the order **south, west, north, east**:

```text
38.4205, 141.2855, 38.4475, 141.3195
```

This is approximately 3.00 km north/south by 2.97 km east/west around central Ishinomaki. The bounds are installed in code and are not inferred from a user's position.

The one-time source query was:

```overpass
[out:json][timeout:45];
(
  way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|unclassified|tertiary|service)$"](38.4205,141.2855,38.4475,141.3195);
  way["highway"~"^(secondary|primary)$"]["sidewalk"~"^(yes|both|left|right)$"](38.4205,141.2855,38.4475,141.3195);
  way["highway"~"^(secondary|primary)$"]["foot"~"^(yes|designated|permissive)$"](38.4205,141.2855,38.4475,141.3195);
);
out body;
>;
out body qt;
```

Query SHA-256: `a8a58a9f0da037aae36832149dcce47d8e68b260b0c70ea83b301b777af55111`.

## Filtering and graph construction

The source response contained 15,029 elements (3,532 ways and 11,497 nodes). The pinned candidate pack contains 2,629 ways, 9,187 graph nodes, and 10,318 non-zero edges (rebuilt `2026-10-13T16:13:38+09:00` after unsupported `oneway:foot` values were dropped). Ways are connected only through adjacent OSM way-node references; no straight-line links or last-metre connectors are synthesized. Road and node tags are retained as supplied, including unknown attributes. Edge lengths are calculated locally from the pinned coordinates.

The extraction admits footways, paths, pedestrian ways, steps, living streets, residential, unclassified, tertiary, and service roads. Primary and secondary roads are admitted only where sidewalk or foot tags explicitly meet the query. It drops private or disallowed foot access, conditional foot/access restrictions, motorroads, and driveway/parking-aisle/drive-through service roads. Unsupported `oneway:foot` values are dropped. Generic motor-vehicle `oneway` tags are retained as source attributes but are not treated as pedestrian direction restrictions. The [OSM access-tag guidance](https://wiki.openstreetmap.org/wiki/Key:access), [footway tag reference](https://wiki.openstreetmap.org/wiki/Key:footway), and [pedestrian tag reference](https://wiki.openstreetmap.org/wiki/Pedestrian) describe the source tagging conventions; tags are not ground truth about current conditions.

At the reviewed snapshot, the graph is below the fixed capacity (`max_nodes=9999`, `max_edges=19999`) and the serialized asset is below 1 MB. The loader pins exact byte length and SHA-256, caps the response size, validates the strict schema and graph references, and refuses a different declared extent or capacity.

## Pinned review metadata

- Pack: `ishinomaki-central-walk-v1`
- Built and reviewed: `2026-10-13T16:13:38+09:00`
- Review due: `2027-01-11T16:13:38+09:00` (90 days after review)
- Asset bytes: `730042`
- Asset SHA-256: `36f436b9ab96e06e7fbb86d8becf398a6bd4bb2a9ebff86f02d7b7e9f7ac5847`
- Original Overpass response SHA-256: `04b44a37f46e13b13330abad3a74d302eac785ce4a915b9de1c16bfcc80c1062`
- `reviewed_at` records review of the source query, filtering rules, bounds, schema, and pinned bytes. It is not a field survey, accessibility audit, safety review, or confirmation that a way remains open.

The optional named reference node is OSM node `461190495`, `石巻駅前` (`highway=traffic_signals`, 38.4333737, 141.3037166). It is a demonstration reference only and is never substituted for a user's locally supplied origin.

## Strict interpretation boundary

This asset is labelled `ROAD_REFERENCE_ONLY` and sets `movement_authorized=false`. A returned geometry is a road-graph candidate with origin/destination snap gaps, not an evacuation instruction, safe route, accessible route, open road, or current passability report. The graph contains no live closures, hazard effects, bridge/road damage, official movement directives, sidewalk verification, curb or stair assessment, wheelchair suitability, or destination-opening proof. A missing candidate means only that this bounded snapshot could not produce one under its constraints. Current safety and movement decisions remain undetermined by this data.
