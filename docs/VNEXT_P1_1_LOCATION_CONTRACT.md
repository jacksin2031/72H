# P1.1 device location and nationwide area contract

Approved 2026-10-08 JST. Local acceptance is recorded separately in
[VNEXT_P1_1_VALIDATION.md](VNEXT_P1_1_VALIDATION.md).

## Device projection and lifecycle

GPS / LAST_KNOWN / USER_SELECTED are distinct consumer projections. A fix aged
at most 120 seconds is CURRENT, at most 600 seconds AGING, then STALE. Restore
always identifies the original last-confirmed time, regardless of age. Network
state never changes that timestamp or official evidence verification.
Storage consent defaults off; one validated point may be retained for seven
days. Forget clears consent and retained point. No location history is added.

Permission follows an explicit user action. Denial does not retry automatically.
NORMAL/PREPARE uses one-shot fixes and, after prior explicit permission, can
refresh once when returning to the foreground with an aging fix. SURVIVAL
requires a manual update. Continuous watch is restricted to the actual mobile
Home authorized MAP_ASSISTED map, with cleanup on scene/map/gate/background or
permission changes. CONSERVE uses at most one fix per 30 seconds with an
eight-second timeout and stops on failure. EMERGENCY_POWER stops watching.
Late callbacks cannot overwrite newer fixes or resurrect forgotten state.

## Administrative assets

Source: [MLIT N03 2026 nationwide administrative boundaries](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html),
dated 2026-01-01; CC BY 4.0. Attribution: 国土交通省 国土数値情報（行政区域）2026年版を加工.
`public/areas/manifest.json` records original archive/PDF SHA-256, source URLs,
catalog hash, shard hashes and byte/feature counts. The conversion preserves
original double-precision polygon rings; no simplification or coordinate
rounding is applied. Build dependencies are pyshp==2.3.1 and pypdf==6.0.0.

Reproduction:

```powershell
python scripts/build_japan_areas.py --archive <N03-20260101_GML.zip> --undetermined <N03_Boundary_undetermined.pdf>
python scripts/validate_japan_areas.py
```

The catalog has 1,953 areas (Japan, 47 prefectures, 1,905 municipalities/wards).
The spatial index uses 0.25-degree cells. There are 125,130 original features and
1,120 content-addressed gzip shards, totaling 422,595,506 compressed bytes.
Large source geometry makes the complete national set substantial; it is never
downloaded as an onboarding prerequisite. A query is bounded to 48 shard
descriptors and 128 MiB decoded data, with at most 8,000,000 bytes per shard.
On-device shard cache is bounded to 32 MiB. Unsupported gzip/worker, fetch/hash
failure or exceeding bounds returns UNAVAILABLE and offers manual selection.

Every candidate intersecting the reported accuracy circle is considered.
Ambiguity returns common ancestry. Municipalities in the official provisional
boundary list are conservatively demoted in full to their prefecture, or Japan
for cross-prefecture provisional boundaries; this is broader than just the
uncertain line. Coast/hole uncertainty also demotes municipal precision.
The center outside all supported polygons returns OUTSIDE with an empty path,
including foreign coordinates. Missing shards never imply absence of a
candidate or default Japan membership. Exact code does not prove physical
presence, disaster intensity, an open destination or safe movement.

## Session boundary

Coordinates stay local. The location endpoint accepts only canonical IDs,
source and observation time; registry-derived labels/ancestors enter the
existing LiveSnapshot. Snapshots contain the session's required areas and
ancestors within 512 entries. The full national backend registry and device
catalog do not share this projection limit. Old replay aliases remain valid.
Updating a region preserves the session and immutable previous plans, expires
old route dependencies and re-evaluates existing evidence. During this work,
the consumer suppresses old movement UI. GPS cannot promote source trust,
restore ONLINE_VERIFIED or issue movement authorization.

`POST /api/live/{session_id}/location` validates a complete canonical ancestor
path, `GPS` / `USER_SELECTED` source and timezone-aware `observed_at`. Explicit
GPS must be CURRENT and cannot be future-dated, including initial session
creation. Same-region GPS timestamp refresh is throttled to 90 seconds and
does not renew route evidence or create a plan solely because of a new fix.
Pending or uncertain region updates stay gated until the backend confirms the
latest path, including response-loss and out-of-order callbacks.

`POST /api/live/{session_id}/profile` changes accommodation, party size,
self-reported safety and accessibility metadata in the existing session. It
does not change or renew the current location, require another GPS request or
reset plan history. Precise accommodation coordinates and current-location
updates are excluded from this settings contract. Region selection continues
to use the location endpoint.

Reconnection eligibility requires fresh official movement, destination-open,
destination-hazard and route-safety evidence published and received after the
reconnection marker, plus a newly checked route. Fetching an unrelated official
observation, rereading an old publication or updating GPS cannot restore this
eligibility. `NETWORK_RESTORED != VERIFICATION_RESTORED` and
`GPS_UPDATED != SAFETY_VERIFIED` remain deterministic gates.
