"""Build the bounded central-Tokyo land and coastline pack from the pinned N03 assets.

Build-only dependency: shapely (2.x), installed outside the runtime packages.
The official source archive is already pinned by ``public/areas/manifest.json``;
this script verifies and consumes only the indexed cells intersecting the map
extent. It does not download external data or edit the existing road pack.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
from pathlib import Path

from shapely import make_valid, normalize
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Polygon, box, mapping
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parents[1]
AREAS = ROOT / "apps/web/public/areas"
MAPS = ROOT / "apps/web/public/maps"
BOUNDS = (139.68, 35.64, 139.82, 35.74)
ASSET_PATH = "/maps/tokyo-central-geography.geojson"
OFFICIAL_SOURCE = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
ATTRIBUTION = "国土交通省 国土数値情報（行政区域）2026年版を加工"
MAX_SOURCE_SHARD_BYTES = 8_000_000


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def digest_file(path: Path) -> str:
    return sha256(path.read_bytes())


def signed_area(ring: list[list[float]]) -> float:
    return math.fsum(
        ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
        for index in range(len(ring) - 1)
    ) / 2


def polygon_from_esri_rings(rings: list[list[list[float]]]):
    """Group ESRI clockwise shells and counter-clockwise holes without losing vertices."""
    shells: list[dict[str, object]] = []
    holes: list[list[list[float]]] = []
    for ring in rings:
        if len(ring) < 4 or ring[0] != ring[-1]:
            raise ValueError("N03 polygon ring is not closed or has fewer than four positions")
        area = signed_area(ring)
        if area == 0:
            raise ValueError("N03 polygon ring has zero signed area")
        if area < 0:
            shells.append({"ring": ring, "polygon": Polygon(ring), "holes": []})
        else:
            holes.append(ring)
    if not shells:
        raise ValueError("N03 feature contains no clockwise exterior ring")

    for hole in holes:
        hole_polygon = Polygon(hole)
        representative = hole_polygon.representative_point()
        containers = [shell for shell in shells if shell["polygon"].covers(representative)]
        if not containers:
            raise ValueError("N03 interior ring has no containing exterior ring")
        min(containers, key=lambda shell: shell["polygon"].area)["holes"].append(hole)

    polygons = [Polygon(shell["ring"], shell["holes"]) for shell in shells]
    return unary_union(polygons)


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if geometry.geom_type == "GeometryCollection":
        return [part for child in geometry.geoms for part in polygon_parts(child)]
    return []


def line_parts(geometry):
    if geometry.geom_type == "LineString":
        return [geometry] if geometry.length > 0 else []
    if geometry.geom_type in ("MultiLineString", "GeometryCollection"):
        return [part for child in geometry.geoms for part in line_parts(child)]
    return []


def geometry_from_feature(feature: dict[str, object]):
    geometry = polygon_from_esri_rings(feature["rings"])
    repaired = not geometry.is_valid
    if repaired:
        geometry = make_valid(geometry)
    polygons = polygon_parts(geometry)
    if not polygons:
        raise ValueError(f"N03 feature {feature['id']} has no polygonal geometry")
    return unary_union(polygons), repaired


def source_cells(area_manifest: dict[str, object]) -> list[str]:
    grid = area_manifest["grid_degrees"]
    if not isinstance(grid, (int, float)) or not math.isfinite(grid) or grid <= 0:
        raise ValueError("Invalid N03 manifest grid size")
    west, south, east, north = BOUNDS
    return [
        f"{x}-{y}"
        for x in range(math.floor(west / grid), math.floor(east / grid) + 1)
        for y in range(math.floor(south / grid), math.floor(north / grid) + 1)
    ]


def load_source_features(area_manifest: dict[str, object], area_manifest_bytes: bytes, catalog_bytes: bytes):
    if area_manifest.get("dataset") != "N03-20260101" or area_manifest.get("source_url") != OFFICIAL_SOURCE:
        raise ValueError("Pinned official N03 dataset identity does not match the expected 2026 source")
    if area_manifest.get("license") != "CC BY 4.0":
        raise ValueError("Pinned N03 license is not CC BY 4.0")
    if area_manifest.get("catalog_bytes") != len(catalog_bytes):
        raise ValueError("N03 catalog byte count mismatch")
    if area_manifest.get("catalog_sha256") != sha256(catalog_bytes):
        raise ValueError("N03 catalog SHA-256 mismatch")

    catalog = json.loads(catalog_bytes)
    catalog_ids = {area["id"] for area in catalog if isinstance(area, dict) and isinstance(area.get("id"), str)}
    found: dict[int, dict[str, object]] = {}
    shard_descriptors: dict[str, dict[str, object]] = {}
    for cell in source_cells(area_manifest):
        for descriptor in area_manifest["cells"].get(cell, []):
            asset = descriptor.get("asset")
            if not isinstance(asset, str) or not asset.startswith("/areas/n03-2026-") or not asset.endswith(".json.gz"):
                raise ValueError(f"Unexpected N03 shard asset path: {asset!r}")
            source_path = AREAS / Path(asset).name
            payload = source_path.read_bytes()
            if len(payload) != descriptor.get("bytes") or sha256(payload) != descriptor.get("sha256"):
                raise ValueError(f"N03 source shard integrity mismatch: {asset}")
            decoded = gzip.decompress(payload)
            if len(decoded) != descriptor.get("decoded_bytes") or len(decoded) > MAX_SOURCE_SHARD_BYTES:
                raise ValueError(f"N03 decoded shard size mismatch: {asset}")
            records = json.loads(decoded)
            if len(records) != descriptor.get("features"):
                raise ValueError(f"N03 source shard feature count mismatch: {asset}")
            shard_descriptors[asset] = {
                "asset": asset,
                "sha256": descriptor["sha256"],
                "bytes": descriptor["bytes"],
            }
            for feature in records:
                west, south, east, north = feature["bbox"]
                if east < BOUNDS[0] or west > BOUNDS[2] or north < BOUNDS[1] or south > BOUNDS[3]:
                    continue
                feature_id = feature["id"]
                previous = found.get(feature_id)
                if previous is not None and previous != feature:
                    raise ValueError(f"Inconsistent duplicate N03 feature ID: {feature_id}")
                found[feature_id] = feature

    if not found:
        raise ValueError("No official N03 municipality features intersect the map bounds")
    if any(feature.get("area_id") not in catalog_ids for feature in found.values()):
        raise ValueError("An intersecting N03 feature refers to an unknown catalog area")
    return found, sorted(shard_descriptors.values(), key=lambda item: item["asset"]), area_manifest_bytes


def build() -> dict[str, object]:
    area_manifest_path = AREAS / "manifest.json"
    catalog_path = AREAS / "catalog.json"
    area_manifest_bytes = area_manifest_path.read_bytes()
    catalog_bytes = catalog_path.read_bytes()
    area_manifest = json.loads(area_manifest_bytes)
    features, source_shards, _ = load_source_features(area_manifest, area_manifest_bytes, catalog_bytes)
    extent = box(*BOUNDS)

    contributors = []
    repairs = 0
    for feature in features.values():
        geometry, repaired = geometry_from_feature(feature)
        repairs += int(repaired)
        if geometry.intersects(extent) and geometry.intersection(extent).area > 0:
            contributors.append((feature, geometry))
    if not contributors:
        raise ValueError("No polygonal N03 land intersects the map extent")

    # Union complete municipality polygons first so shared administrative borders vanish.
    land_union = unary_union([geometry for _, geometry in contributors])
    land = land_union.intersection(extent)
    if not land.is_valid:
        land = make_valid(land)
    land_polygons = polygon_parts(land)
    if not land_polygons:
        raise ValueError("Clipped N03 union did not produce polygonal land")
    land = normalize(unary_union(land_polygons))

    # Use the pre-clip union boundary, then explicitly remove all map-rectangle edges.
    coastline = land_union.boundary.intersection(extent).difference(extent.boundary)
    coastline = normalize(linemerge(unary_union(line_parts(coastline))))
    coastline_lines = line_parts(coastline)
    if not coastline_lines:
        raise ValueError("No N03 coastline segments remain within the map extent")
    if sum(line.intersection(extent.boundary).length for line in coastline_lines) != 0:
        raise ValueError("Artificial map-rectangle edges remain in the coastline output")
    coastline = normalize(MultiLineString([list(line.coords) for line in coastline_lines]))

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"kind": "land"}, "geometry": mapping(land)},
            {"type": "Feature", "properties": {"kind": "coastline"}, "geometry": mapping(coastline)},
        ],
    }
    asset_bytes = encoded(geojson)
    contributing_features = [feature for feature, _ in contributors]
    source_feature_ids = sorted(feature["id"] for feature in contributing_features)
    source_area_ids = sorted({feature["area_id"] for feature in contributing_features})
    source_provisional_boundary_area_ids = sorted({
        feature["area_id"] for feature in contributing_features if feature.get("uncertain_scope")
    })
    manifest = {
        "id": "tokyo-central-geography-v1",
        "version": 1,
        "bounds": list(BOUNDS),
        "source": "国土交通省 国土数値情報（行政区域）2026年版",
        "source_url": OFFICIAL_SOURCE,
        "source_dataset": area_manifest["dataset"],
        "source_archive_sha256": area_manifest["archive_sha256"],
        "source_manifest": "/areas/manifest.json",
        "source_manifest_sha256": sha256(area_manifest_bytes),
        "source_catalog": "/areas/catalog.json",
        "source_catalog_sha256": sha256(catalog_bytes),
        "source_catalog_bytes": len(catalog_bytes),
        "source_shards": source_shards,
        "source_candidate_count": len(features),
        "source_feature_count": len(contributing_features),
        "source_feature_ids": source_feature_ids,
        "source_area_ids": source_area_ids,
        "source_provisional_boundary_area_ids": source_provisional_boundary_area_ids,
        "asset": ASSET_PATH,
        "bytes": len(asset_bytes),
        "sha256": sha256(asset_bytes),
        "feature_count": 2,
        "license": "CC BY 4.0",
        "license_url": LICENSE_URL,
        "attribution": ATTRIBUTION,
        "provenance": (
            "Verified indexed N03-20260101 municipality features intersecting the fixed extent; "
            "unioned at original coordinate precision to remove municipal seams, then clipped to bounds. "
            "Coastline uses the pre-clip union boundary intersected with the extent, with rectangle edges "
            "removed. No coastline is hand-drawn and no simplification or coordinate rounding is applied."
        ),
    }

    MAPS.mkdir(parents=True, exist_ok=True)
    (MAPS / Path(ASSET_PATH).name).write_bytes(asset_bytes)
    (MAPS / "geography-manifest.json").write_bytes(encoded(manifest))
    return {
        "status": "PASS",
        "bounds": list(BOUNDS),
        "source_cells": source_cells(area_manifest),
        "source_shards": source_shards,
        "source_candidate_count": len(features),
        "source_feature_count": len(contributing_features),
        "source_area_ids": source_area_ids,
        "source_provisional_boundary_area_ids": source_provisional_boundary_area_ids,
        "land_geometry_type": land.geom_type,
        "land_polygon_count": len(polygon_parts(land)),
        "coastline_geometry_type": coastline.geom_type,
        "coastline_component_count": len(line_parts(coastline)),
        "invalid_source_geometry_repairs": repairs,
        "asset_bytes": len(asset_bytes),
        "asset_sha256": sha256(asset_bytes),
        "manifest_sha256": digest_file(MAPS / "geography-manifest.json"),
    }


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False, indent=2, sort_keys=True))
