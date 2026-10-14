"""Build the sourced Ishinomaki tsunami and evacuation-place reference pack.

Build-only dependencies (install outside the project/runtime):
    shapely >= 2.0
    pyproj >= 3.6
    ijson >= 3.2

By default, official source snapshots are downloaded to a fresh system-temp
directory. To reproduce from retained snapshots, pass --source-dir and
--source-retrieved-at. The source ZIP/CSV files are never copied into the web
pack. The only generated project files are under apps/web/public/hazards/.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import ijson
    from pyproj import CRS, Transformer
    from shapely import make_valid
    from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, box, shape
    from shapely.ops import transform, unary_union
except ImportError as error:  # pragma: no cover - build environment guidance
    raise SystemExit(
        "Install build-only packages with the workspace Python: "
        "pip install shapely pyproj ijson"
    ) from error


ROOT = Path(__file__).resolve().parents[1]
AREA_DIR = ROOT / "apps/web/public/areas"
DEFAULT_OUTPUT = ROOT / "apps/web/public/hazards/miyagi-ishinomaki-v1"
PACK_URL_PREFIX = "/hazards/miyagi-ishinomaki-v1"
AREA_ID = "JP-MUNI-04202"
AREA_LABEL = "石巻市"
PREFECTURE_LABEL = "宮城県"

MLIT_LIST_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A40-v2_1.html"
A40_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/A40/A40-22/A40-22_04_GML.zip"
A40_MEMBER = "A40-22_04_GML/A40-22_04.geojson"
MIYAGI_ORIGINAL_CATALOG_URL = "https://miyagi.dataeye.jp/datasets/74"
MIYAGI_ORIGINAL_URL = "https://miyagi.dataeye.jp/resource_download/145"
MIYAGI_SOURCE_PAGE_URL = (
    "https://www.pref.miyagi.jp/soshiki/kasen/"
    "miyagi-tsunami-shinsuisoutei-published1.html"
)
MIYAGI_SOURCE_MEETING_URL = (
    "https://www.pref.miyagi.jp/soshiki/kasen/miyagi-tsunami-shinsuisoutei.html"
)
MIYAGI_TERMS_URL = "https://miyagi.dataeye.jp/pages/terms"
MLIT_A40_SPEC_URL = "https://nlftp.mlit.go.jp/ksj/gml/product_spec/KS-PS-A40-v2_1.pdf"
GSI_LIST_URL = "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html"
GSI_GENERAL_TERMS_URL = "https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html"
GSI_CAUTION_URL = "https://www.gsi.go.jp/bousaichiri/hinanbasho-help.html"
GSI_EMERGENCY_URL = (
    "https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/04202_2.csv"
)
GSI_SHELTER_URL = (
    "https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/04202_1.csv"
)

A40_SOURCE_ID = "mlit-a40-miyagi-2022"
MIYAGI_ORIGINAL_SOURCE_ID = "miyagi-tsunami-depth-original-2022"
GSI_EMERGENCY_SOURCE_ID = "gsi-ishinomaki-emergency-sites"
GSI_SHELTER_SOURCE_ID = "gsi-ishinomaki-shelters"

# This is a bounded shard-discovery window, not a hazard coverage boundary.
# The source municipality features are checked by canonical area ID and unioned.
N03_SEARCH_BOUNDS = (140.5, 37.5, 142.25, 39.25)
MAX_ASSET_BYTES = 4 * 1024 * 1024
JST = timezone(timedelta(hours=9))
HAZARD_KEYS = {
    "flood": "洪水",
    "landslide": "崖崩れ、土石流及び地滑り",
    "storm_surge": "高潮",
    "earthquake": "地震",
    "tsunami": "津波",
    "large_fire": "大規模な火事",
    "inland_flood": "内水氾濫",
    "volcano": "火山現象",
}


def encoded(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: str, label: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone offset")
    return parsed


def jst_iso(value: datetime) -> str:
    return value.astimezone(JST).isoformat(timespec="seconds")


def download(url: str, destination: Path) -> str:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "72H-official-hazard-pack-builder/1.0",
            "Accept": "*/*",
        },
    )
    temporary = destination.with_suffix(destination.suffix + ".download")
    try:
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as out:
            shutil.copyfileobj(response, out, length=1024 * 1024)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return utc_now()


def input_sources(source_dir: Path | None, source_retrieved_at: str | None):
    files = {
        "a40": "A40-22_04_GML.zip",
        "miyagi_original": "miyagi-tsunami-depth-original.zip",
        "gsi_emergency": "04202_2.csv",
        "gsi_shelter": "04202_1.csv",
    }
    urls = {
        "a40": A40_URL,
        "miyagi_original": MIYAGI_ORIGINAL_URL,
        "gsi_emergency": GSI_EMERGENCY_URL,
        "gsi_shelter": GSI_SHELTER_URL,
    }
    if source_dir is None:
        source_dir = Path(tempfile.mkdtemp(prefix="72h-official-hazard-sources-"))
        retrieved: dict[str, str] = {}
        for key, filename in files.items():
            retrieved[key] = download(urls[key], source_dir / filename)
    else:
        source_dir = source_dir.resolve()
        missing = [filename for filename in files.values() if not (source_dir / filename).is_file()]
        if missing:
            raise FileNotFoundError(
                f"Retained source directory is missing: {', '.join(missing)}"
            )
        if not source_retrieved_at:
            raise ValueError(
                "--source-retrieved-at is required when using retained source files"
            )
        parse_iso(source_retrieved_at, "--source-retrieved-at")
        retrieved = {key: source_retrieved_at for key in files}
    return (
        {key: source_dir / filename for key, filename in files.items()},
        retrieved,
        source_dir,
    )


def signed_area(ring: list[list[float]]) -> float:
    return math.fsum(
        ring[index][0] * ring[index + 1][1]
        - ring[index + 1][0] * ring[index][1]
        for index in range(len(ring) - 1)
    ) / 2


def polygon_from_esri_rings(rings: list[list[list[float]]]) -> Polygon | MultiPolygon:
    shells: list[dict[str, Any]] = []
    holes: list[list[list[float]]] = []
    for ring in rings:
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("N03 boundary ring is not closed or has fewer than four positions")
        area = signed_area(ring)
        if area == 0:
            raise ValueError("N03 boundary ring has zero signed area")
        if area < 0:
            shells.append({"ring": ring, "polygon": Polygon(ring), "holes": []})
        else:
            holes.append(ring)
    if not shells:
        raise ValueError("N03 boundary feature contains no exterior ring")
    for hole in holes:
        hole_polygon = Polygon(hole)
        representative = hole_polygon.representative_point()
        containers = [shell for shell in shells if shell["polygon"].covers(representative)]
        if not containers:
            raise ValueError("N03 interior ring has no containing exterior ring")
        min(containers, key=lambda shell: shell["polygon"].area)["holes"].append(hole)
    polygons = [Polygon(shell["ring"], shell["holes"]) for shell in shells]
    if len(polygons) == 1:
        return polygons[0]
    return MultiPolygon(polygons)


def polygon_parts(geometry: object) -> list[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, (MultiPolygon, GeometryCollection)):
        return [part for child in geometry.geoms for part in polygon_parts(child)]
    return []


def load_ishinomaki_boundary() -> tuple[object, dict[str, Any]]:
    catalog_path = AREA_DIR / "catalog.json"
    manifest_path = AREA_DIR / "manifest.json"
    catalog_bytes = catalog_path.read_bytes()
    manifest_bytes = manifest_path.read_bytes()
    catalog = json.loads(catalog_bytes)
    manifest = json.loads(manifest_bytes)
    if manifest.get("dataset") != "N03-20260101":
        raise ValueError("The pinned N03 boundary pack must be N03-20260101")
    if manifest.get("catalog_bytes") != len(catalog_bytes):
        raise ValueError("N03 catalog byte count mismatch")
    if manifest.get("catalog_sha256") != sha256_bytes(catalog_bytes):
        raise ValueError("N03 catalog SHA-256 mismatch")
    if manifest.get("archive_sha256") != "1f714fca019e22e6f84012dba420384fc7b49c6ad8bd0a867ab1cfb593a78477":
        raise ValueError("N03 source archive digest does not match the installed pack")
    matched = [
        row
        for row in catalog
        if isinstance(row, dict)
        and row.get("id") == AREA_ID
        and row.get("label") == AREA_LABEL
    ]
    if len(matched) != 1:
        raise ValueError("N03 catalog does not resolve exactly one Ishinomaki municipality")
    grid = manifest.get("grid_degrees")
    if not isinstance(grid, (int, float)) or not math.isfinite(grid) or grid <= 0:
        raise ValueError("Invalid N03 grid size")
    west, south, east, north = N03_SEARCH_BOUNDS
    cells = [
        f"{x}-{y}"
        for x in range(math.floor(west / grid), math.floor(east / grid) + 1)
        for y in range(math.floor(south / grid), math.floor(north / grid) + 1)
    ]
    descriptors: dict[str, dict[str, Any]] = {}
    for cell in cells:
        for descriptor in manifest.get("cells", {}).get(cell, []):
            asset = descriptor.get("asset")
            if (
                not isinstance(asset, str)
                or not asset.startswith("/areas/n03-2026-")
                or not asset.endswith(".json.gz")
            ):
                raise ValueError(f"Unexpected N03 shard path: {asset!r}")
            previous = descriptors.get(asset)
            if previous is not None and previous != descriptor:
                raise ValueError(f"Inconsistent N03 descriptor for {asset}")
            descriptors[asset] = descriptor

    found: dict[int, dict[str, Any]] = {}
    uncertain_feature_ids: list[int] = []
    for asset, descriptor in sorted(descriptors.items()):
        path = AREA_DIR / Path(asset).name
        payload = path.read_bytes()
        if len(payload) != descriptor.get("bytes") or sha256_bytes(payload) != descriptor.get("sha256"):
            raise ValueError(f"N03 boundary shard integrity failure: {asset}")
        decoded = gzip.decompress(payload)
        if len(decoded) != descriptor.get("decoded_bytes"):
            raise ValueError(f"N03 boundary shard byte count mismatch: {asset}")
        rows = json.loads(decoded)
        if len(rows) != descriptor.get("features"):
            raise ValueError(f"N03 boundary shard feature count mismatch: {asset}")
        for row in rows:
            if row.get("area_id") != AREA_ID:
                continue
            feature_id = row.get("id")
            if not isinstance(feature_id, int):
                raise ValueError("N03 municipality feature has no integer feature ID")
            previous = found.get(feature_id)
            if previous is not None and previous != row:
                raise ValueError(f"Inconsistent duplicate N03 feature ID: {feature_id}")
            found[feature_id] = row
            if row.get("uncertain_scope") is not None:
                uncertain_feature_ids.append(feature_id)
    if not found:
        raise ValueError("No N03 Ishinomaki municipality boundary features were found")

    boundary_features = []
    repairs = 0
    for feature_id, row in sorted(found.items()):
        geometry = polygon_from_esri_rings(row["rings"])
        if not geometry.is_valid:
            geometry = make_valid(geometry)
            repairs += 1
        parts = polygon_parts(geometry)
        if not parts:
            raise ValueError(f"N03 feature {feature_id} has no polygonal area")
        boundary_features.extend(parts)
    boundary = unary_union(boundary_features)
    if not boundary.is_valid:
        boundary = make_valid(boundary)
        repairs += 1
    if not polygon_parts(boundary):
        raise ValueError("N03 Ishinomaki boundary union is not polygonal")
    min_x, min_y, max_x, max_y = boundary.bounds
    padding = grid * 1.5
    if (
        min_x <= west + padding
        or min_y <= south + padding
        or max_x >= east - padding
        or max_y >= north - padding
    ):
        raise ValueError(
            "N03 search window may clip municipality source features; expand its bounds"
        )
    metadata = {
        "dataset": manifest["dataset"],
        "source_url": manifest["source_url"],
        "archive_url": manifest["archive_url"],
        "archive_sha256": manifest["archive_sha256"],
        "license": manifest.get("license"),
        "catalog_sha256": manifest["catalog_sha256"],
        "manifest_sha256": sha256_bytes(manifest_bytes),
        "shards": [
            {
                "path": asset,
                "sha256": descriptor["sha256"],
                "bytes": descriptor["bytes"],
            }
            for asset, descriptor in sorted(descriptors.items())
        ],
        "area_feature_ids": sorted(found),
        "area_feature_count": len(found),
        "uncertain_feature_ids": sorted(set(uncertain_feature_ids)),
        "geometry_type": boundary.geom_type,
        "bbox": [min_x, min_y, max_x, max_y],
        "invalid_geometry_repairs": repairs,
        "search_bounds": list(N03_SEARCH_BOUNDS),
    }
    return boundary, metadata


def source_crs_from_archive(archive: zipfile.ZipFile) -> str:
    if A40_MEMBER not in archive.namelist():
        raise ValueError(f"Pinned A40 archive is missing {A40_MEMBER}")
    with archive.open(A40_MEMBER) as stream:
        for prefix, event, value in ijson.parse(stream):
            if prefix == "crs.properties.name" and event == "string":
                if not isinstance(value, str):
                    break
                return value
            if prefix.startswith("features.item"):
                break
    raise ValueError("A40 GeoJSON has no declared CRS name")


def make_a40_geojson(
    archive_path: Path,
    boundary: object,
    source_sha256: str,
    source_retrieved_at: str,
    output_dir: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    from shapely.geometry import mapping

    output_dir.mkdir(parents=True, exist_ok=True)
    assets: list[dict[str, Any]] = []
    buffer: list[dict[str, Any]] = []
    buffer_size = 0
    source_count = 0
    selected_count = 0
    candidate_count = 0
    skipped_zero_area = 0
    invalid_source_count = 0
    repaired_source_feature_ids: list[str] = []
    hole_count = 0
    multipolygon_count = 0
    depth_counts: Counter[str] = Counter()
    source_crs_name = ""
    transformer = None

    def flush() -> None:
        nonlocal buffer, buffer_size
        if not buffer:
            return
        index = len(assets) + 1
        filename = f"inundation-{index:03d}.geojson"
        payload = encoded({"type": "FeatureCollection", "features": buffer})
        if len(payload) > MAX_ASSET_BYTES:
            raise ValueError(f"Generated inundation shard exceeds {MAX_ASSET_BYTES} bytes")
        path = output_dir / filename
        path.write_bytes(payload)
        assets.append(
            {
                "path": f"{PACK_URL_PREFIX}/{filename}",
                "sha256": sha256_bytes(payload),
                "bytes": len(payload),
                "kind": "inundation",
            }
        )
        buffer = []
        buffer_size = 0

    with zipfile.ZipFile(archive_path) as archive:
        source_crs_name = source_crs_from_archive(archive)
        source_crs = CRS.from_user_input(source_crs_name)
        if source_crs.to_epsg() != 6668:
            raise ValueError(f"Expected official A40 source CRS EPSG:6668, got {source_crs_name}")
        transformer = Transformer.from_crs(source_crs, CRS.from_epsg(4326), always_xy=True)
        inverse_transformer = Transformer.from_crs(
            CRS.from_epsg(4326), source_crs, always_xy=True
        )
        source_boundary = transform(inverse_transformer.transform, boundary)
        source_west, source_south, source_east, source_north = source_boundary.bounds
        # A small prefilter margin keeps datum-conversion edge cases in the
        # candidate set; exact reprojection/intersection below determines output.
        prefilter = box(
            source_west - 0.01,
            source_south - 0.01,
            source_east + 0.01,
            source_north + 0.01,
        )
        with archive.open(A40_MEMBER) as stream:
            for source_count, item in enumerate(
                ijson.items(stream, "features.item", use_float=True), start=1
            ):
                if source_count % 5000 == 0:
                    print(
                        f"A40 scan: source_features={source_count}, "
                        f"pilot_candidates={candidate_count}, selected={selected_count}",
                        file=sys.stderr,
                        flush=True,
                    )
                properties = item.get("properties") or {}
                geometry_value = item.get("geometry")
                if properties.get("A40_002") != "04" or properties.get("A40_001") != PREFECTURE_LABEL:
                    continue
                depth_label = properties.get("A40_003")
                if not isinstance(depth_label, str) or not depth_label.strip():
                    raise ValueError(f"A40 feature {source_count} has no depth class")
                geometry = shape(geometry_value)
                if geometry.geom_type not in ("Polygon", "MultiPolygon"):
                    raise ValueError(f"A40 feature {source_count} is not polygonal")
                if not geometry.envelope.intersects(prefilter):
                    continue
                candidate_count += 1
                transformed = transform(transformer.transform, geometry)
                if not geometry.is_valid:
                    invalid_source_count += 1
                    repaired_source_feature_ids.append(f"A40-22-04-{source_count:07d}")
                    transformed = make_valid(transformed)
                    if not polygon_parts(transformed):
                        raise ValueError(
                            f"A40 feature {source_count} repair produced no polygonal area"
                        )
                if not transformed.is_valid:
                    transformed = make_valid(transformed)
                    if not transformed.is_valid:
                        raise ValueError(
                            f"A40 feature {source_count} remains invalid after repair"
                        )
                if not transformed.intersects(boundary):
                    continue
                clipped = transformed.intersection(boundary)
                parts = polygon_parts(clipped)
                if not parts or math.fsum(part.area for part in parts) <= 0:
                    skipped_zero_area += 1
                    continue
                clipped_geometry = parts[0] if len(parts) == 1 else MultiPolygon(parts)
                if not clipped_geometry.is_valid:
                    clipped_geometry = make_valid(clipped_geometry)
                    parts = polygon_parts(clipped_geometry)
                    if not parts:
                        raise ValueError(
                            f"Clipped A40 feature {source_count} repair produced no polygonal area"
                        )
                    clipped_geometry = parts[0] if len(parts) == 1 else MultiPolygon(parts)
                    if not clipped_geometry.is_valid:
                        raise ValueError(f"Clipped A40 feature {source_count} remains invalid")
                selected_count += 1
                depth_counts[depth_label] += 1
                if clipped_geometry.geom_type == "MultiPolygon":
                    multipolygon_count += 1
                hole_count += sum(len(polygon.interiors) for polygon in polygon_parts(clipped_geometry))
                feature = {
                    "type": "Feature",
                    "properties": {
                        "id": f"A40-22-04-{source_count:07d}",
                        "depth_label": depth_label.strip(),
                        "source_id": A40_SOURCE_ID,
                    },
                    "geometry": mapping(clipped_geometry),
                }
                feature_bytes = encoded(feature)
                if len(feature_bytes) + 32 > MAX_ASSET_BYTES:
                    raise ValueError(f"A40 feature {source_count} alone exceeds shard size limit")
                if buffer and buffer_size + len(feature_bytes) + 1 > MAX_ASSET_BYTES - 512:
                    flush()
                buffer.append(feature)
                buffer_size += len(feature_bytes) + 1
    flush()
    if not assets:
        raise ValueError("No Miyagi A40 inundation polygons intersect Ishinomaki")
    return assets, {
        "source_id": A40_SOURCE_ID,
        "source_sha256": source_sha256,
        "retrieved_at": source_retrieved_at,
        "source_crs": source_crs_name,
        "target_crs": "EPSG:4326",
        "coordinate_transform": "pyproj Transformer.from_crs(EPSG:6668, EPSG:4326, always_xy=True)",
        "source_feature_count": source_count,
        "intersecting_feature_count": selected_count,
        "zero_area_intersections_skipped": skipped_zero_area,
        "invalid_source_geometry_count": invalid_source_count,
        "repaired_source_feature_ids": repaired_source_feature_ids,
        "polygon_hole_count_after_clip": hole_count,
        "multipolygon_feature_count_after_clip": multipolygon_count,
        "depth_label_counts": dict(sorted(depth_counts.items())),
        "geometry_operation": (
            "Each official source polygon was transformed from EPSG:6668 to EPSG:4326 "
            "and intersected with the pinned Ishinomaki N03 municipality boundary. "
            "No simplification, coordinate rounding, or depth relabeling was applied. "
            "Invalid A40 source polygons intersecting the pilot were topologically "
            "repaired with Shapely make_valid; the feature IDs are listed above. "
            "A 0.01-degree source-CRS envelope prefilter only removes polygons that "
            "cannot intersect the municipality; exact clipping uses the full geometry."
        ),
    }


def classify_hazard(row: dict[str, str | None], japanese_column: str) -> tuple[str, str, str | None]:
    if japanese_column not in row:
        return "UNKNOWN", "MISSING_COLUMN", None
    raw = row[japanese_column]
    value = "" if raw is None else raw.strip()
    if value == "1":
        return "DESIGNATED", "EXPLICIT_ONE", raw
    if value == "":
        return "NOT_DESIGNATED", "EXPLICIT_BLANK", raw
    return "UNKNOWN", "INVALID_VALUE", raw


def decode_csv(path: Path) -> list[dict[str, str | None]]:
    payload = path.read_bytes()
    errors: list[UnicodeDecodeError] = []
    for encoding in ("utf-8-sig", "cp932"):
        try:
            text = payload.decode(encoding)
            break
        except UnicodeDecodeError as error:
            errors.append(error)
    else:
        raise errors[-1]
    rows = list(csv.DictReader(text.splitlines()))
    if not rows:
        raise ValueError(f"CSV has no records: {path.name}")
    return rows


def build_places(
    emergency_csv: Path,
    shelter_csv: Path,
    output_dir: Path,
    source_hashes: dict[str, str],
    source_retrieved_at: dict[str, str],
    boundary: object,
) -> tuple[dict[str, Any], dict[str, Any]]:
    places: list[dict[str, Any]] = []
    category_state_counts: dict[str, Counter[str]] = {
        key: Counter() for key in HAZARD_KEYS
    }
    role_counts: Counter[str] = Counter()
    invalid_coordinates = 0
    outside_boundary_locations = 0
    seen_ids: set[tuple[str, str]] = set()

    for path, kind, source_id, source_key, has_hazard_columns in (
        (emergency_csv, "EMERGENCY_SITE", GSI_EMERGENCY_SOURCE_ID, "gsi_emergency", True),
        (shelter_csv, "SHELTER", GSI_SHELTER_SOURCE_ID, "gsi_shelter", False),
    ):
        rows = decode_csv(path)
        for row_number, row in enumerate(rows, start=2):
            common_id = (row.get("共通ID") or "").strip()
            name = (row.get("施設・場所名") or "").strip()
            address = (row.get("住所") or "").strip()
            if not common_id or not name:
                raise ValueError(f"{path.name}:{row_number} lacks ID or name")
            duplicate_key = (kind, common_id)
            if duplicate_key in seen_ids:
                raise ValueError(f"Duplicate GSI common ID in {kind}: {common_id}")
            seen_ids.add(duplicate_key)
            try:
                lat = float((row.get("緯度") or "").strip())
                lng = float((row.get("経度") or "").strip())
            except ValueError as error:
                invalid_coordinates += 1
                raise ValueError(f"{path.name}:{row_number} has invalid coordinates") from error
            if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
                invalid_coordinates += 1
                raise ValueError(f"{path.name}:{row_number} has out-of-range coordinates")
            if not boundary.covers(Point(lng, lat)):
                outside_boundary_locations += 1

            hazards: dict[str, str] = {}
            source_states: dict[str, str] = {}
            raw_values: dict[str, str | None] = {}
            for key, japanese_column in HAZARD_KEYS.items():
                if has_hazard_columns:
                    status, source_state, raw_value = classify_hazard(row, japanese_column)
                else:
                    # The GSI ordinary shelter CSV contains no hazard applicability fields.
                    status, source_state, raw_value = "UNKNOWN", "MISSING_COLUMN", None
                hazards[key] = status
                source_states[key] = source_state
                raw_values[key] = raw_value
                category_state_counts[key][source_state] += 1

            places.append(
                {
                    "id": f"{kind.lower()}:{common_id}",
                    "common_id": common_id,
                    "name": name,
                    "address": address or None,
                    "lat": lat,
                    "lng": lng,
                    "kind": kind,
                    "hazards": hazards,
                    "hazard_source_states": source_states,
                    "hazard_raw_values": raw_values,
                    "notes": (row.get("備考") or "").strip(),
                    "source_id": source_id,
                    "open_status": "UNKNOWN",
                }
            )
            role_counts[kind] += 1

    places.sort(key=lambda record: (record["kind"], record["id"]))
    payload = encoded(places)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "places.json").write_bytes(payload)
    asset = {
        "path": f"{PACK_URL_PREFIX}/places.json",
        "sha256": sha256_bytes(payload),
        "bytes": len(payload),
        "kind": "places",
    }
    metadata = {
        "record_count": len(places),
        "kind_counts": dict(sorted(role_counts.items())),
        "hazard_source_state_counts": {
            key: dict(sorted(counts.items()))
            for key, counts in sorted(category_state_counts.items())
        },
        "invalid_coordinate_count": invalid_coordinates,
        "locations_outside_n03_boundary_count": outside_boundary_locations,
        "open_status_policy": "UNKNOWN for every record; GSI designation data does not report current opening.",
        "route_authorized": False,
        "source_sha256": {
            GSI_EMERGENCY_SOURCE_ID: source_hashes["gsi_emergency"],
            GSI_SHELTER_SOURCE_ID: source_hashes["gsi_shelter"],
        },
        "source_retrieved_at": {
            GSI_EMERGENCY_SOURCE_ID: source_retrieved_at["gsi_emergency"],
            GSI_SHELTER_SOURCE_ID: source_retrieved_at["gsi_shelter"],
        },
        "category_policy": (
            "Emergency-site CSV value 1 maps to DESIGNATED and a published blank maps to "
            "NOT_DESIGNATED. Missing columns and other nonblank values map to UNKNOWN and "
            "retain their distinct source state/raw value. Ordinary shelter CSV has no "
            "eight hazard applicability columns, so all eight remain UNKNOWN."
        ),
    }
    return asset, metadata


def build_sources(
    source_hashes: dict[str, str],
    source_retrieved_at: dict[str, str],
) -> list[dict[str, Any]]:
    sources = [
        {
            "id": A40_SOURCE_ID,
            "title": "国土数値情報 津波浸水想定データ 宮城県（A40-22_04）",
            "url": A40_URL,
            "basis_date": "2022-04-01",
            "published_at": None,
            "retrieved_at": source_retrieved_at["a40"],
            "raw_sha256": source_hashes["a40"],
            "license_url": MIYAGI_TERMS_URL,
            "notes": (
                f"MLIT A40 listing: {MLIT_LIST_URL}; product spec: {MLIT_A40_SPEC_URL}. "
                "The A40 v2.1 quality section reports horizontal positional standard "
                "deviation 25 m based on a 2% sample; this is not a maximum-error "
                "guarantee. As checked 2026-10-11, Miyagi's "
                "latest listed A40 file is Reiwa 4 (2022). The MLIT page gives the "
                "2022-04-01 basis date and requires Miyagi portal terms. "
                "Source properties A40_003 are retained as published."
            ),
        },
        {
            "id": MIYAGI_ORIGINAL_SOURCE_ID,
            "title": "宮城県津波浸水想定 原典の最大浸水深データ（参照用）",
            "url": MIYAGI_ORIGINAL_URL,
            "basis_date": "2022-05-10",
            "published_at": None,
            "retrieved_at": source_retrieved_at["miyagi_original"],
            "raw_sha256": source_hashes["miyagi_original"],
            "license_url": MIYAGI_TERMS_URL,
            "notes": (
                f"Catalog: {MIYAGI_ORIGINAL_CATALOG_URL}; prefecture source page: "
                f"{MIYAGI_SOURCE_PAGE_URL}; review/meeting page: {MIYAGI_SOURCE_MEETING_URL}. "
                "The catalog metadata lists dataset registration/publication 2022-09-09 "
                "and last update 2022-09-22; the prefecture page itself is dated "
                "2022-10-03; the official tsunami assumption was announced 2022-05-10. "
                "These are distinct dates; no direct ZIP resource publication/update date "
                "was found, so published_at is null and basis_date is 2022-05-10. The "
                "original ZIP contains depth sample points, not polygons; it is provenance "
                "only and is not used as output geometry. The A40 ZIP is the polygon source."
            ),
        },
        {
            "id": GSI_EMERGENCY_SOURCE_ID,
            "title": "GSI 石巻市 指定緊急避難場所 CSV",
            "url": GSI_EMERGENCY_URL,
            "basis_date": None,
            "published_at": None,
            "retrieved_at": source_retrieved_at["gsi_emergency"],
            "raw_sha256": source_hashes["gsi_emergency"],
            "license_url": GSI_GENERAL_TERMS_URL,
            "notes": (
                f"Dataset/update definitions: {GSI_LIST_URL}; data-specific caution: "
                f"{GSI_CAUTION_URL}. The CSV distribution page's Ishinomaki metadata "
                "lists first public date 2017-02-22 and database update 2026-06-12; the current CSV "
                "publication date and municipality designation dates are unknown, and "
                "the database update is not a designation date. Some municipality records may be "
                "withheld. GSI PDL 1.0 content terms require source attribution and "
                "disclosure of editing; preserve the "
                "data-specific cautions and terms."
            ),
        },
        {
            "id": GSI_SHELTER_SOURCE_ID,
            "title": "GSI 石巻市 指定避難所 CSV",
            "url": GSI_SHELTER_URL,
            "basis_date": None,
            "published_at": None,
            "retrieved_at": source_retrieved_at["gsi_shelter"],
            "raw_sha256": source_hashes["gsi_shelter"],
            "license_url": GSI_GENERAL_TERMS_URL,
            "notes": (
                f"Dataset/update definitions: {GSI_LIST_URL}; data-specific caution: "
                f"{GSI_CAUTION_URL}. The CSV distribution page's Ishinomaki metadata "
                "lists first public date 2017-02-22 and database update 2026-06-12; the current CSV "
                "publication date and municipality designation dates are unknown, and "
                "the database update is not a designation date. The ordinary shelter "
                "CSV has no hazard applicability fields, so all eight are UNKNOWN. "
                "GSI PDL 1.0 terms require source attribution and disclosure of editing; "
                "some records "
                "may be withheld."
            ),
        },
    ]
    # The pinned N03 package is a local geometry input used only to select the pilot
    # municipality and clip A40 polygons. Its archive and shard digests are retained
    # separately so source retrieval time is not falsely presented as current.
    return sources


def write_pack(
    output_dir: Path,
    source_files: dict[str, Path],
    source_retrieved_at: dict[str, str],
    reviewed_at_value: str | None,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    # Remove only previous builder-owned outputs. This prevents stale extra shards
    # or an old coverage file from surviving a smaller rebuild.
    for stale in output_dir.glob("inundation-*.geojson"):
        stale.unlink()
    for stale_name in ("places.json", "manifest.json", "coverage.geojson"):
        (output_dir / stale_name).unlink(missing_ok=True)
    source_hashes = {key: sha256_file(path) for key, path in source_files.items()}
    for key, path in source_files.items():
        if key in ("a40", "miyagi_original"):
            with zipfile.ZipFile(path) as archive:
                if archive.testzip() is not None:
                    raise ValueError(f"Source archive integrity check failed: {path.name}")

    boundary, n03_metadata = load_ishinomaki_boundary()
    if n03_metadata["uncertain_feature_ids"]:
        raise ValueError("Ishinomaki N03 boundary includes uncertain-scope features")
    inundation_assets, inundation_metadata = make_a40_geojson(
        source_files["a40"],
        boundary,
        source_hashes["a40"],
        source_retrieved_at["a40"],
        output_dir,
    )
    places_asset, places_metadata = build_places(
        source_files["gsi_emergency"],
        source_files["gsi_shelter"],
        output_dir,
        source_hashes,
        source_retrieved_at,
        boundary,
    )
    assets = [*inundation_assets, places_asset]

    reviewed_at = (
        parse_iso(reviewed_at_value, "--reviewed-at")
        if reviewed_at_value
        else datetime.now(JST)
    )
    review_due_at = reviewed_at + timedelta(days=90)
    min_x, min_y, max_x, max_y = boundary.bounds
    manifest = {
        "schema_version": 1,
        "dataset_id": "miyagi-ishinomaki-tsunami-places-v1",
        "region_name": "宮城県石巻市",
        "area_id": AREA_ID,
        "reviewed_at": jst_iso(reviewed_at),
        "review_due_at": jst_iso(review_due_at),
        "coverage_status": "PARTIAL",
        "scenario": {
            "source_id": "miyagi-tsunami-depth-original-2022",
            "announced_on": "2022-05-10", "source_crs": "EPSG:6668", "output_crs": "EPSG:4326",
            "terrain_basis": "Post-2011 ground changes and recovery projects as of 2019-12",
            "conditions": ["MAXIMUM_CLASS_ADVERSE", "LARGER_OR_OUTSIDE_POSSIBLE", "LATER_WAVE_MAXIMUM", "RIVER_LAKE_CHANGES_NOT_SHOWN"],
        },
        "positional_accuracy_m": 25,
        "positional_accuracy_kind": "STANDARD_DEVIATION",
        "coverage_note": (
            "No independent complete inundation-study coverage geometry was supplied "
            "with this pack. A40 polygons indicate modeled inundation areas only; "
            "outside every polygon remains UNKNOWN and must not be described as "
            "surveyed, zero-inundation, or safe."
        ),
        "bbox": [min_x, min_y, max_x, max_y],
        "route_authorized": False,
        "safe_location_verified": False,
        "sources": build_sources(source_hashes, source_retrieved_at),
        "assets": assets,
        "metadata": {
            "coordinate_reference_system": "EPSG:4326",
            "review_policy": (
                "review_due_at is a local 90-day review checkpoint. It is not an "
                "official source publication, freshness, or opening-status date."
            ),
            "boundary_source": {
                **n03_metadata,
                "role": (
                    "Pinned N03 municipality boundary used only for Ishinomaki clipping "
                    "and package bounds; it is not evidence of tsunami coverage."
                ),
            },
            "inundation": inundation_metadata,
            "places": places_metadata,
            "opening_status": "UNKNOWN for all places.",
            "movement_authorization": {
                "safe_location_verified": False,
                "route_authorized": False,
            },
        },
    }
    manifest_bytes = encoded(manifest)
    (output_dir / "manifest.json").write_bytes(manifest_bytes)
    verification = verify_pack(output_dir, manifest)
    return {
        "status": "PASS",
        "dataset_id": manifest["dataset_id"],
        "output_dir": str(output_dir),
        "source_sha256": source_hashes,
        "source_retrieved_at": source_retrieved_at,
        "manifest_sha256": sha256_bytes(manifest_bytes),
        "manifest_bytes": len(manifest_bytes),
        "coverage_status": manifest["coverage_status"],
        "route_authorized": manifest["route_authorized"],
        "bbox": manifest["bbox"],
        "n03_boundary_feature_count": n03_metadata["area_feature_count"],
        "inundation_asset_count": len(inundation_assets),
        "inundation_feature_count": inundation_metadata["intersecting_feature_count"],
        "inundation_depth_label_counts": inundation_metadata["depth_label_counts"],
        "inundation_crs": "EPSG:4326",
        "places": places_metadata,
        "verified_assets": verification,
        "uncertainties": [
            "Outside A40 inundation polygons is UNKNOWN because no independent coverage geometry is available.",
            "GSI data can omit facilities and its database update date is not the local designation date.",
            "Current opening, capacity, facility conditions, and route passability were not verified.",
        ],
    }


def verify_pack(output_dir: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    from shapely.geometry import shape

    asset_results = []
    seen_ids: set[str] = set()
    seen_place_ids: set[str] = set()
    total_features = 0
    total_holes = 0
    multipolygon_features = 0
    for asset in manifest["assets"]:
        if not asset["path"].startswith(PACK_URL_PREFIX + "/"):
            raise ValueError(f"Unexpected asset path: {asset['path']}")
        path = output_dir / asset["path"].rsplit("/", 1)[-1]
        payload = path.read_bytes()
        if len(payload) != asset["bytes"] or sha256_bytes(payload) != asset["sha256"]:
            raise ValueError(f"Asset integrity mismatch: {asset['path']}")
        if len(payload) > MAX_ASSET_BYTES:
            raise ValueError(f"Asset exceeds 4 MiB pack shard limit: {asset['path']}")
        if asset["kind"] == "inundation":
            collection = json.loads(payload)
            if collection.get("type") != "FeatureCollection":
                raise ValueError(f"Invalid GeoJSON collection: {asset['path']}")
            for feature in collection.get("features", []):
                props = feature.get("properties") or {}
                if set(props) != {"id", "depth_label", "source_id"}:
                    raise ValueError(f"Unexpected inundation properties in {asset['path']}")
                if not all(isinstance(props.get(k), str) and props[k] for k in props):
                    raise ValueError(f"Missing inundation property in {asset['path']}")
                if props["id"] in seen_ids:
                    raise ValueError(f"Duplicate inundation feature ID: {props['id']}")
                seen_ids.add(props["id"])
                geometry = shape(feature.get("geometry"))
                if geometry.geom_type not in ("Polygon", "MultiPolygon") or not geometry.is_valid:
                    raise ValueError(f"Invalid/non-polygon output geometry: {props['id']}")
                min_x, min_y, max_x, max_y = geometry.bounds
                if min_x < 130 or max_x > 150 or min_y < 30 or max_y > 50:
                    raise ValueError(f"GeoJSON coordinates are not EPSG:4326: {props['id']}")
                total_holes += sum(len(polygon.interiors) for polygon in polygon_parts(geometry))
                multipolygon_features += int(geometry.geom_type == "MultiPolygon")
                total_features += 1
        elif asset["kind"] == "places":
            records = json.loads(payload)
            if not isinstance(records, list):
                raise ValueError("places.json must contain a JSON array")
            source_ids = {source["id"] for source in manifest["sources"]}
            for record in records:
                if set(record["hazards"]) != set(HAZARD_KEYS):
                    raise ValueError(f"Place {record.get('id')} lacks one or more hazard classes")
                if record.get("id") in seen_place_ids or not record.get("common_id"):
                    raise ValueError(f"Place {record.get('id')} has a duplicate ID or no source common ID")
                seen_place_ids.add(record["id"])
                if any(
                    value not in {"DESIGNATED", "NOT_DESIGNATED", "UNKNOWN"}
                    for value in record["hazards"].values()
                ):
                    raise ValueError(f"Place {record.get('id')} has an invalid hazard status")
                if set(record.get("hazard_source_states", {})) != set(HAZARD_KEYS):
                    raise ValueError(f"Place {record.get('id')} lacks hazard source states")
                if set(record.get("hazard_raw_values", {})) != set(HAZARD_KEYS):
                    raise ValueError(f"Place {record.get('id')} lacks hazard raw values")
                for key in HAZARD_KEYS:
                    state = record["hazard_source_states"][key]
                    raw = record["hazard_raw_values"][key]
                    status = record["hazards"][key]
                    if state in {"EXPLICIT_ONE", "EXPLICIT_BLANK"}:
                        expected_status = "DESIGNATED" if state == "EXPLICIT_ONE" else "NOT_DESIGNATED"
                        expected_value = "1" if state == "EXPLICIT_ONE" else ""
                        if (
                            status != expected_status
                            or not isinstance(raw, str)
                            or raw.strip() != expected_value
                        ):
                            raise ValueError(f"Place {record.get('id')} has inconsistent source status")
                    elif state == "INVALID_VALUE":
                        if status != "UNKNOWN" or not isinstance(raw, str) or raw.strip() in ("", "1"):
                            raise ValueError(f"Place {record.get('id')} has inconsistent invalid source status")
                    elif state == "MISSING_COLUMN" and (status, raw) != ("UNKNOWN", None):
                        raise ValueError(f"Place {record.get('id')} has inconsistent source status")
                    elif state not in {"MISSING_COLUMN", "INVALID_VALUE"}:
                        raise ValueError(f"Place {record.get('id')} has unknown source state")
                if record.get("open_status") != "UNKNOWN":
                    raise ValueError(f"Place {record.get('id')} has a non-UNKNOWN open status")
                if record.get("source_id") not in source_ids:
                    raise ValueError(f"Place {record.get('id')} references an unknown source")
                if record.get("kind") not in {"EMERGENCY_SITE", "SHELTER"}:
                    raise ValueError(f"Place {record.get('id')} has an invalid kind")
                if record.get("id") != f"{record['kind'].lower()}:{record['common_id']}":
                    raise ValueError(f"Place {record.get('id')} does not preserve its typed source ID")
                if record.get("address") is not None and not isinstance(record.get("address"), str):
                    raise ValueError(f"Place {record.get('id')} has an invalid address")
                if not isinstance(record.get("notes"), str):
                    raise ValueError(f"Place {record.get('id')} has invalid notes")
                if not record.get("id") or not math.isfinite(record.get("lat", math.nan)) or not math.isfinite(record.get("lng", math.nan)):
                    raise ValueError(f"Place {record.get('id')} has invalid coordinates or ID")
            if records:
                if any(record.get("open_status") != "UNKNOWN" for record in records):
                    raise ValueError("An opening state was inferred from designation data")
        asset_results.append(
            {
                "path": asset["path"],
                "sha256": asset["sha256"],
                "bytes": len(payload),
                "kind": asset["kind"],
            }
        )
    if total_features == 0 or not manifest["assets"]:
        raise ValueError("Pack has no inundation assets/features")
    if manifest.get("coverage_status") != "PARTIAL":
        raise ValueError("Pack must remain PARTIAL without independent coverage data")
    if (
        manifest.get("positional_accuracy_m") != 25
        or manifest.get("positional_accuracy_kind") != "STANDARD_DEVIATION"
    ):
        raise ValueError("A40 source precision must be identified as a 25 m standard deviation")
    if manifest.get("route_authorized") is not False:
        raise ValueError("Static pack must not authorize routes")
    if manifest.get("safe_location_verified") is not False:
        raise ValueError("Static pack must not verify a safe location")
    if (output_dir / "coverage.geojson").exists():
        raise ValueError("coverage.geojson must not exist without independent coverage evidence")
    return {
        "asset_count": len(asset_results),
        "inundation_feature_count": total_features,
        "polygon_hole_count": total_holes,
        "multipolygon_feature_count": multipolygon_features,
        "assets": asset_results,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="Directory containing the four raw source files for an offline reproducible build.",
    )
    parser.add_argument(
        "--source-retrieved-at",
        help="Required ISO-8601 time for retained local source files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output pack directory (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--reviewed-at",
        help="Local review time in ISO-8601 form; defaults to the current JST time.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source_files, retrieved_at, source_dir = input_sources(
        args.source_dir,
        args.source_retrieved_at,
    )
    if args.reviewed_at:
        parse_iso(args.reviewed_at, "--reviewed-at")
    result = write_pack(
        args.output_dir.resolve(),
        source_files,
        retrieved_at,
        args.reviewed_at,
    )
    result["source_dir"] = str(source_dir)
    result["manifest_path"] = str(args.output_dir.resolve() / "manifest.json")
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
