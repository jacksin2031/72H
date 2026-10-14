# Nationwide official evacuation-place reference

User-authorized on 2026-10-13 JST: add nationwide shelters before further UI simplification.
Status: **COMPLETE for local reference-data implementation and validation; not deployed.**
Branch: `codex/japan-shelters`; base commit: `3b67f9ccd0aa2ff960e371076ea7e4f15badfbef`.

## Data scope and provenance

The national CSVs are published by the Geospatial Information Authority of Japan (GSI):

- [Official definitions and cautions](https://www.gsi.go.jp/bousaichiri/hinanbasho.html)
- [Download catalog and column definitions](https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html)
- [Content reuse terms](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)

The 2026-10-13 22:02 JST download contains **199,273 typed designation records**:

| Role | Count |
| --- | ---: |
| Designated shelters (`SHELTER`) | 83,391 |
| Emergency evacuation sites (`EMERGENCY_SITE`) | 115,882 |
| Prefectures represented | 47 |
| Municipalities with records | 1,726 |
| Municipal entries in the publication catalog | 1,747 |

These are designation records, **not a count of distinct physical facilities**. A facility may have both roles.
All source rows are retained; none were dropped. Published common IDs containing a letter suffix are preserved.
GSI may omit facilities or lag municipal changes; national coverage means all published records in these CSVs,
not proof that every facility in Japan is listed. A municipality with zero supplied records is explicitly shown
as lacking data, never as having no evacuation places.

The manifest stores raw CSV hashes, individual receipt timestamps, original URLs, municipal database update
dates, counts, asset byte lengths and hashes. Database update dates are not designation dates or live opening times.
Raw CSVs and `receipts.json` remain outside Git in the caller's source directory.

Pinned manifest SHA-256: `4b439906ab045b391fe6ecfc79d067d4725ce346d597a416f9da858d54ea7d15`.
The 47 prefecture assets total 30,350,271 bytes; the largest is Hokkaido at 1,963,218 bytes.

## Behaviour

- Entry: **More → Japan evacuation places & reference map**, outside collapsed diagnostic tools.
  More's four primary settings destinations remain intact. The desktop preparedness view also links to `/map`.
- `/map` loads the national catalog first and only the prefecture selected by the user.
- Municipality, designation role, name/address and eight emergency hazard classifications are filterable.
- Lists show 12 records at a time; map points are clustered, and selecting a place focuses its public coordinates.
- Both role identities remain distinct, with reception restrictions and source notes available in details.
- Shelter CSVs do not provide hazard applicability: all eight classifications remain `UNKNOWN`.
  For emergency sites, `1` means designated, a published blank means not designated, and malformed or absent values remain unknown.
  Filtering for a hazard returns only explicitly designated emergency sites.
- Reference pack hashes, schemas, municipality identity/counts and typed common-ID uniqueness are validated before display.
  A missing/corrupt pack clears prior regional results and offers retry.
- Content-addressed public assets use a separate lazy Service Worker cache, bounded to 32 MiB and 64 entries.
  Downloaded regions survive shell upgrades; uncached regions are unavailable offline. No national precache is added.

## Safety and privacy boundaries

Every record has `open_status=UNKNOWN`. The national manifest has `route_authorized=false` and
`safe_location_verified=false`. This directory is not added to Live destination authorization or the Safety Core.
No source is promoted to current disaster evidence, and no plan or movement gate changes.
Nearest does not mean safest; no navigation link or safe-place ranking is introduced.

The existing Ishinomaki inundation pack remains the bounded pilot. Nationwide shelter designation does not
expand tsunami geometry or survey coverage. A Naha facility query remained `UNKNOWN` for inundation.
Precise GPS remains local; national catalog selection makes no GPS request. The existing GPS raster suppression remains tested.

## Rebuild

```powershell
python scripts/build_japan_shelters.py --source-dir "$env:TEMP/72h-national-shelter-sources" --download
```

To reproduce retained inputs, use the same command without `--download`. Existing receipt hashes are verified
before generation. Inputs retained without receipts require an explicitly supplied actual `--retrieved-at` time;
they must not be relabeled with the rebuild time. The importer emits the public assets and the frontend manifest pin.
`pnpm build` verifies all pinned national asset hashes and counts without downloading or refreshing sources.

## Local validation

- Frontend: **321 passed, 3 skipped** across 49 files. The skips are existing optional P0 API-fixture tests;
  no new national tests are skipped. Tests load and verify all 47 actual prefecture assets.
- Python: **8 passed** using the existing area-builder requirements (`pyshp==2.3.1`, `pypdf==6.0.0`) in an isolated uv environment.
  The first system-Python discovery lacked these dependencies; the isolated rerun passed.
- TypeScript, optimized Next.js build, source receipt reproduction, secret scan and `git diff --check`: PASS.
- Production build ID: `uQdNhUP6SXWY9l5c6ZV7F`.
- Browser: Hokkaido 13,151 records; Okinawa 2,219; Naha shelter filter 83; place selection focuses the map.
  No console warnings/errors were observed in the initial online selection run.
- Japanese/English/Traditional Chinese at 320 and 390 viewport widths: no horizontal overflow;
  client/scroll widths both 305 and 375 respectively, with 12 initial list rows. Desktop 1280×900 was visually inspected.
- Offline controlled acceptance: with browser offline emulation **and the local origin stopped**, cached Hokkaido
  reopened with 13,151 records; uncached Iwate showed verification failure and zero selectable records.
  Tab-only network emulation was insufficient to block the Service Worker's network, so it was not used as negative-case evidence.
- UI evidence: `output/japan-shelters/naha-reference.png` (public facility coordinates, not device GPS).

### Remaining environment and release gates

Windows local `scripts/start.mjs` encountered `EPERM` on a generated pnpm React symbolic link in the standalone output.
The optimized build was inspected using the regular local Next server at `127.0.0.1:3033`; this is a verification
workaround, not a fix to standalone packaging. The deployment Dockerfile uses Linux and `npm ci`, whose
container startup was **NOT RUN** for this change. No cloud deployment, merge or production traffic change occurred.
Physical-device GPS, full national hazard geometry, live facility opening and safe route authorization remain outside this delivery.
