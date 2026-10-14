"""Build-only regional outlines and label anchors, never measured station points.
Dependencies and reviewed codebook are shared with build_jma_forecast_lines.py.
"""
import argparse
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl
import shapefile
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform
from build_jma_forecast_lines import ROOT, HASHES, digest, encode

SOURCE = "20240520_AreaForecastLocalE_GIS.zip"
SHA = "92f3c9a51fc0681970672e3e77cb81d9d7885822e55b6ca6aefcb4ea6d20705f"
PREFIX = "/hazards/jma-intensity-regions-v1/"


def rounded(value):
    if isinstance(value, (list, tuple)):
        return [rounded(x) for x in value]
    return round(value, 6) if isinstance(value, float) else value


def build(source_dir, retrieved_at, reviewed_at=None):
    retrieved = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    if retrieved.tzinfo is None:
        raise ValueError("retrieval timestamp needs timezone")
    reviewed = datetime.fromisoformat(reviewed_at.replace("Z", "+00:00")) if reviewed_at else datetime.now(timezone.utc)
    if reviewed.tzinfo is None or reviewed < retrieved:
        raise ValueError("local review cannot precede source receipt")
    body = (source_dir / SOURCE).read_bytes()
    book = (source_dir / "codebook.zip").read_bytes()
    if digest(body) != SHA or digest(book) != HASHES["codebook.zip"]:
        raise ValueError("reviewed source hash mismatch")
    with zipfile.ZipFile(io.BytesIO(book)) as archive:
        workbook_bytes = archive.read(next(n for n in archive.namelist() if n.endswith("xlsx") and "地震" in n))
    workbook = openpyxl.load_workbook(io.BytesIO(workbook_bytes), read_only=True, data_only=True)
    codes = {}
    for row in workbook["24"].iter_rows(values_only=True):
        if isinstance(row[0], (int, float)):
            code = str(int(row[0])).zfill(3)
            if len(code) != 3 or code in codes and codes[code] != row[1]:
                raise ValueError("unexpected regional code identity")
            codes[code] = row[1]
    if len(codes) != 188:
        raise ValueError("unexpected regional codebook count")
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        files = {ext: io.BytesIO(archive.read(next(n for n in archive.namelist() if n.endswith(ext)))) for ext in (".shp", ".shx", ".dbf")}
    reader = shapefile.Reader(shp=files[".shp"], shx=files[".shx"], dbf=files[".dbf"], encoding="utf-8")
    if reader.shapeType != 5 or len(reader) != 194:
        raise ValueError("unexpected Polygon source schema")
    to_metric = Transformer.from_crs("EPSG:6668", "EPSG:3857", always_xy=True).transform
    to_wgs = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform
    features, excluded, seen = [], [], set()
    for item in reader.iterShapeRecords():
        record = item.record.as_dict()
        code, name = str(record["code"]).strip(), record["name"]
        if not code:
            excluded.append({"code": None, "name": name, "reason": "UNASSIGNED_OFFICIAL_GEOMETRY"})
            continue
        if code in seen or codes.get(code) != name:
            raise ValueError("regional GIS/codebook identity mismatch")
        seen.add(code)
        original = shape(item.shape.__geo_interface__)
        if not original.is_valid:
            excluded.append({"code": code, "name": name, "reason": "INVALID_OFFICIAL_TOPOLOGY"})
            continue
        projected = transform(to_metric, original).simplify(100, preserve_topology=True)
        output = transform(to_wgs, projected)
        data = mapping(output)
        if data["type"] not in {"Polygon", "MultiPolygon"}:
            raise ValueError("regional polygon processing changed geometry type")
        data["coordinates"] = rounded(data["coordinates"])
        final = shape(data)
        if not final.is_valid or final.is_empty:
            excluded.append({"code": code, "name": name, "reason": "DISPLAY_PROCESSING_INVALID"})
            continue
        largest = max(final.geoms, key=lambda g: g.area) if final.geom_type == "MultiPolygon" else final
        point = largest.representative_point()
        features.append({"type": "Feature", "geometry": data,
            "properties": {"code": code, "name": name, "anchor": [round(point.x, 6), round(point.y, 6)]}})
    if seen != set(codes):
        raise ValueError("incomplete official regional source/code relationship")
    directory = ROOT / "apps/web/public" / PREFIX.lstrip("/")
    directory.mkdir(parents=True, exist_ok=True)
    # Each independently hashed part is bounded; no national pre-cache install.
    chunks, current = [], []
    for feature in features:
        if current and len(encode({"type": "FeatureCollection", "features": current + [feature]})) > 8000000:
            chunks.append(current); current = []
        current.append(feature)
    if current:
        chunks.append(current)
    assets = []
    for i, values in enumerate(chunks):
        raw = encode({"type": "FeatureCollection", "features": values})
        if len(raw) > 16000000:
            raise ValueError("single regional geometry exceeds client asset capacity")
        filename = f"regions-{i}.geojson"
        (directory / filename).write_bytes(raw)
        assets.append({"path": PREFIX + filename, "bytes": len(raw), "sha256": digest(raw)})
    if len(assets) > 4 or sum(a["bytes"] for a in assets) > 32000000 or not features:
        raise ValueError("regional pack exceeds client capacity")
    manifest = {"schema_version": 1, "geometry_version": "20240520", "code_table_version": "20261007",
        "reviewed_at": reviewed.isoformat(), "review_due_at": (reviewed + timedelta(days=90)).isoformat(),
        "source_crs": "EPSG:6668", "output_crs": "EPSG:4326", "codes": codes, "assets": assets,
        "excluded_geometry": excluded, "included_count": len(features), "source_count": 194,
        "effective_intervals": "UNKNOWN", "positional_accuracy": "UNKNOWN", "coverage": "PARTIAL_REFERENCE_REGIONS",
        "sources": [
            {"url": "https://www.data.jma.go.jp/developer/gis/" + SOURCE, "sha256": SHA, "version": "20240520", "published_at": "2024-05-20", "retrieved_at": retrieved.isoformat()},
            {"url": "https://xml.kishou.go.jp/jmaxml_20261007_Code.zip", "sha256": HASHES["codebook.zip"], "version": "20261007", "published_at": "2026-10-07", "retrieved_at": retrieved.isoformat()},
        ], "workbook_sha256": digest(workbook_bytes),
        "processing": "JGD2011 to Web Mercator; topology-preserving simplify 100 metres; WGS84 rounded to 6 decimals. Invalid source/display polygons excluded, never repaired silently. Anchors are representative points for REGION_MAXIMUM labels, not measurement stations. Processing tolerance is not positional accuracy.",
        "attribution": "気象庁の地震情報／細分区域GISを72Hが加工。国土地理院承認番号：平30情使第401号、令2情使第125号、令3情使第90号・第123号・第648号、令4情使第437号、令5情使第71号、令6情使第382号、令7情使第395号。",
        "license_url": "https://www.jma.go.jp/jma/kishou/info/coment.html"}
    raw = encode(manifest)
    (directory / "manifest.json").write_bytes(raw)
    (ROOT / "apps/web/lib/jma-intensity-regions-pin.json").write_bytes(encode({"path": PREFIX + "manifest.json", "sha256": digest(raw)}))
    print(json.dumps({"included": len(features), "excluded": len(excluded), "assets": len(assets), "bytes": sum(a["bytes"] for a in assets)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--reviewed-at", help="Explicit UTC/offset review clock for exact manifest reproduction")
    args = parser.parse_args()
    build(args.source_dir, args.retrieved_at, args.reviewed_at)
