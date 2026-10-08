# vNext — configurable map/profile, last known location, generic severity

P1.1 amendment (2026-10-08): the user approved device-local N03 GPS-to-area
resolution and same-session area updates. The earlier no-area-selection,
single-shot-only and 60-second/offline classification below are historical P0
rules, superseded by [VNEXT_P1_1_LOCATION_CONTRACT.md](VNEXT_P1_1_LOCATION_CONTRACT.md).
Coordinates remain device-local; resolved IDs/time/source may reach the backend.
The full registry is national; the 512-entry bound below applies to the session
snapshot projection. GPS never grants source authority or movement permission.

Authorized by the user on 2026-10-05 JST. This extends the locally validated P0
branch without deploying or activating live feeds. Status: COMPLETE for local
implementation and required validation. The follow-up's 69 backend / 77 frontend
tests, typecheck/build, independent review and browser checks are recorded in
`VNEXT_VALIDATION.md`; earlier P0 results identify their own historical build.

## Configuration and ownership

```text
Server-owned scenario registry
  -> area catalog + profile seed + registered source area authority
  -> validated replay/profile input
  -> typed evidence / deterministic Safety Core / immutable plans
  -> snapshot
     -> generic area/severity read projection
     -> profile coordinates + installed map-pack catalog -> reference map

Explicit browser location request
  -> validated position + captured time + accuracy
  -> local one-point cache only after storage consent
  -> LIVE_LOCATION while fresh in the current foreground session
  -> LAST_KNOWN_LOCATION on restore, offline or aging
```

Coordinates and display labels never grant an area ID, official source authority
or permission for high-risk movement. Browser location is not uploaded or silently
substituted into the server profile. Profile reference points and device positions
are visibly separate. No reverse-geocoding service or automatic route is added.

## Generic area / severity contract

- `AreaDefinition { id, label, parent_id }` is a bounded server-owned catalog.
  The catalog has at most 512 entries; area IDs remain at most 96 characters and
  declared paths/assessment lists at most 64 entries. Derived claim/dependency
  keys use the separate 160-character claim-key contract, rather than the entity
  ID limit. Route identity uses the existing stable hash.
- `Location { label, lat, lng, area_ids, observed_at }` retains paired optional
  coordinates. `area_ids` declares the complete specific-to-root ancestry path;
  it is checked against the catalog, rather than derived from a place name.
- `Evidence.affected_area_ids` is explicit. `disaster_assessments` contains
  `{ area_id, event_type, level: L0..L4 | null, status }` records.
- Source registration separately controls authorized areas and claim types.
  Selecting a profile cannot change a source's authorization.
- Same area/hazard scope resolves by freshness and recency. Same-time
  contradictory assessments become CONFLICT. UNKNOWN supersedes older state in
  its own scope. Across applicable scopes, the highest still-current known
  severity is retained; a parent resolution cannot erase a child critical event.
- Non-official, stale, future, conflicting or location-inapplicable assessments
  cannot start a critical check. Severity still cannot authorize evacuation.
- Reconciliation and medium-risk continuity actions require profile-relevant
  evidence. GPS coordinates and accommodation-only evidence do not establish
  current-area relevance.

Existing Tokyo legacy claim keys are normalized only by their registered replay
source adapter. Generic consumers read typed assessments and canonical area IDs.
Legacy offline snapshots can still parse, but missing catalog/area IDs make
severity/reconciliation UNKNOWN and degrade dependent actions. Their immutable
plan history remains readable; city aliases are not guessed.

## Profile / scenario boundary

`GET /api/replay/scenarios` returns bounded registered `{ key, name }` metadata.
`POST /api/replay/start` selects an exact registered `scenario_key` and optionally
accepts a validated profile seed. Arbitrary file paths and unknown scenario keys
are not accepted. The UI lists server metadata instead of embedding city names.
Tokyo remains one configured replay. A second-region replay exercises the same
contracts and Safety Core; it is also explicitly synthetic.

Changing profile/scenario starts a new session rather than rewriting published
plans in the old session. Reset uses the session's configured seed. User-provided
locations must satisfy the configured area catalog; valid input is not proof of
physical presence or safety.

## Map pack boundary

`public/maps/catalog.json` lists at most four installed, licensed map manifests.
Each manifest has a generic ID, valid bounds, app-owned asset path, capture time,
byte count, feature count and SHA-256. The map selects a pack containing profile
coordinates (or explicitly requested device coordinates when no profile point
exists), derives its viewport from the bounds, and derives reference pins from
the profile. It has no embedded Tokyo center, Shibuya/Asakusa coordinates or city
fallback. Missing coordinates or an unsupported region remain explicit.

The SW validates catalog paths and precaches installed pack assets. Runtime does
not download new regions or call public map APIs. Only the existing real central
Tokyo pack is installed; a second-region profile does not fabricate a new map.
To add coverage, install a bounded licensed pack and catalog metadata, with
integrity and offline checks. Geographic availability is never route safety.

## Last known device location

- Browser permission follows an explicit one-shot request, including in SURVIVAL;
  no continuous GPS, background watcher or automatic location request is added.
- Separate storage consent defaults off. Only the latest point is retained under
  a versioned strict schema: latitude, longitude, accuracy, capture time, source.
- Restoring a recent saved point still shows LAST_KNOWN_LOCATION. Offline and
  positions aged 60 seconds are also last known. The capture time is never
  refreshed merely by loading or reconnecting.
- Older or equal-timestamp browser fixes cannot replace the saved point; denied
  or outdated responses preserve its capture time and degrade to last known.
- Invalid coordinates, negative accuracy, future timestamps, unsupported source,
  oversized/corrupt records and storage failures fail closed.
- Positions older than seven days are not used and are cleared while execution
  is available or on next open. Closed-browser erasure is not guaranteed.
- Denied/failed new requests preserve an existing last known point and its time.
  Opt-out/forget synchronously removes storage, clears the point and cancels late
  callbacks. A blocked browser-storage deletion is explicitly reported.
- The shared location hook survives map removal in power modes and restores
  consented data after route changes/reload; no position history is stored.

## Validation

Required: existing backend/frontend suites plus alternate-region pipeline,
source/area authorization, malformed hierarchy, legacy snapshot degradation,
typed severity conflicts/freshness, location cache consent/age/deletion, typecheck,
build, secret scan and browser map/profile/LKL/offline/power acceptance.

Browser geolocation QA uses an explicit mock position, not actual GPS. No live
official feed, nationwide map, real-device GPS accuracy or background guarantee
is an acceptance claim. Final results are recorded in `VNEXT_VALIDATION.md`.
