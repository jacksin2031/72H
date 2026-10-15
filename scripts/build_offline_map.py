"""This offline map-pack builder never runs at runtime; road-reference tiles are fetched by the API (see road_tiles.py)."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import re
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ENDPOINT = "https://overpass-api.de/api/interpreter"


def pack_options():
    parser = argparse.ArgumentParser(description="Explicit bounded OSM road-pack maintenance; never called by app runtime")
    parser.add_argument("--pack-id", default="tokyo-central-v1")
    parser.add_argument("--bounds", nargs=4, type=float, default=[139.68, 35.64, 139.82, 35.74], metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    parser.add_argument("--version", type=int, default=1)
    options = parser.parse_args()
    west, south, east, north = options.bounds
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", options.pack_id) or not 1 <= options.version <= 10000:
        parser.error("Invalid pack ID or version")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90 and east - west <= 1 and north - south <= 1):
        parser.error("Bounds must be valid and no larger than one degree per axis")
    return options


def main():
    options = pack_options()
    west, south, east, north = options.bounds
    query = f'[out:json][timeout:30];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]({south},{west},{north},{east});out geom;'
    asset_name = re.sub(r"-v[0-9]+$", "", options.pack_id) + ".geojson"
    request = Request(ENDPOINT, data=urlencode({"data": query}).encode(), headers={"User-Agent": "72H-offline-pack/1.0 (bounded one-time map extract)"})
    with urlopen(request, timeout=45) as response:
        raw = response.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError("Map response exceeds 8MB bound")
    data = json.loads(raw)
    if data.get("remark"):
        raise ValueError("Overpass did not complete the query")
    features = []
    for item in data.get("elements", []):
        coordinates = [[point["lon"], point["lat"]] for point in item.get("geometry", [])]
        if len(coordinates) < 2:
            continue
        if not all(type(n) in (int, float) and -180 <= point[0] <= 180 and -90 <= point[1] <= 90 for point in coordinates for n in point):
            raise ValueError("Invalid map coordinate")
        features.append({"type": "Feature", "id": item["id"], "properties": {"highway": item["tags"]["highway"]}, "geometry": {"type": "LineString", "coordinates": coordinates}})
    if not 1 <= len(features) <= 20000:
        raise ValueError("Unexpected road count")
    payload = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")).encode()
    if len(payload) > 8_000_000:
        raise ValueError("Map pack exceeds bound")
    root = Path(__file__).resolve().parents[1] / "apps/web/public/maps"
    root.mkdir(parents=True, exist_ok=True)
    manifest = {"id": options.pack_id, "version": options.version, "bounds": options.bounds, "captured_at": datetime.now(timezone.utc).isoformat(), "data_timestamp": data.get("osm3s", {}).get("timestamp_osm_base"), "source": "OpenStreetMap contributors", "source_url": "https://www.openstreetmap.org/copyright", "license": "ODbL-1.0", "license_url": "https://opendatacommons.org/licenses/odbl/1.0/", "endpoint": ENDPOINT, "query": query, "asset": "/maps/" + asset_name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "feature_count": len(features), "scope": "Pack-extent reference roads only; no hazard, shelters, route safety or live status."}
    catalog_path = root / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else {"version": 1, "packs": []}
    packs = [pack for pack in catalog["packs"] if pack["id"] != manifest["id"]]
    if len(packs) >= 4:
        raise ValueError("Installed pack catalog exceeds four-pack bound")
    if any(pack["asset"] == manifest["asset"] for pack in packs):
        raise ValueError("Map asset conflicts with another installed pack")
    (root / asset_name).write_bytes(payload)
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    catalog_path.write_text(json.dumps({"version": 1, "packs": [*packs, manifest]}, indent=2) + "\n", encoding="utf-8")
    print(f"Offline map: {len(features)} roads / {len(payload)} bytes / {manifest['sha256']}")


if __name__ == "__main__":
    main()
