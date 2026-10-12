"""Build reviewed JMA coastal lines. Build-only: pyshp 3.0.3, pyproj 3.7.2,
shapely 2.2.0 and openpyxl. No raw source ZIP is shipped to browsers.

Run with --source-dir containing shapefile.zip and codebook.zip and an explicit
--retrieved-at. Sources are pinned, no guessed polygon or station crosswalk.
"""
import argparse
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import openpyxl
import shapefile
from pyproj import Transformer
from shapely.geometry import MultiLineString
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
HASHES = {
    "shapefile.zip": "735e2ed36befa8d9511f01e6a0e503e01e7824b5125a71326f3f623d808a7eb9",
    "codebook.zip": "e3f1f0462c432c3d6dde475e8563e1d96b1859bd0986b593aa134fa45ee580f8",
}
PREFIX = "/hazards/jma-forecast-lines-v1/"


def digest(body):
    return hashlib.sha256(body).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def build(source_dir, retrieved_at, reviewed_at=None):
    retrieved = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    if retrieved.tzinfo is None:
        raise ValueError("retrieval time must include timezone")
    reviewed = datetime.fromisoformat(reviewed_at.replace("Z", "+00:00")) if reviewed_at else datetime.now(timezone.utc)
    if reviewed.tzinfo is None or reviewed < retrieved:
        raise ValueError("local review cannot precede source receipt")
    bodies = {name: (source_dir / name).read_bytes() for name in HASHES}
    if any(digest(bodies[name]) != sha for name, sha in HASHES.items()):
        raise ValueError("official source snapshot hash differs from reviewed version")
    with zipfile.ZipFile(io.BytesIO(bodies["codebook.zip"])) as archive:
        member = next(n for n in archive.namelist() if n.endswith("xlsx") and "地震" in n)
        workbook_bytes = archive.read(member)
    workbook = openpyxl.load_workbook(io.BytesIO(workbook_bytes), read_only=True, data_only=True)
    codes = {}
    for row in workbook["31"].iter_rows(values_only=True):
        if len(row) < 4 or not isinstance(row[0], (int, float)):
            continue
        code, name, _, note = row[:4]
        code, note = str(int(code)), str(note or "")
        members = re.search(r"構成する津波予報区([0-9,]+)", note)
        codes[code] = {"name": name, "members": members.group(1).split(",") if members else [code], "note": note}
    if len(codes) != 98:
        raise ValueError("unexpected reviewed AreaTsunami code count")
    with zipfile.ZipFile(io.BytesIO(bodies["shapefile.zip"])) as archive:
        files = {ext: io.BytesIO(archive.read(next(n for n in archive.namelist() if n.endswith(ext)))) for ext in (".shp", ".shx", ".dbf")}
    reader = shapefile.Reader(shp=files[".shp"], shx=files[".shx"], dbf=files[".dbf"], encoding="utf-8")
    if reader.shapeType != 3 or len(reader) != 70:
        raise ValueError("unexpected reviewed coastal PolyLine schema")
    to_metric = Transformer.from_crs("EPSG:6668", "EPSG:3857", always_xy=True).transform
    to_wgs = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True).transform
    features, excluded, original_points, output_points = [], [], 0, 0
    for item in reader.iterShapeRecords():
        record = item.record.as_dict()
        code, name = str(record["code"]).strip(), record["name"]
        if code == "0":
            excluded.append({"code": code, "name": name, "reason": "UNASSIGNED_OFFICIAL_GEOMETRY"})
            continue
        if code not in codes or codes[code]["name"] != name or codes[code]["members"] != [code]:
            raise ValueError("geometry/codebook identity mismatch")
        shape = item.shape
        offsets = list(shape.parts) + [len(shape.points)]
        lines = [shape.points[offsets[i]:offsets[i + 1]] for i in range(len(offsets) - 1)]
        original_points += len(shape.points)
        # Preserve independent line parts. 100m is a processing tolerance in
        # Web Mercator, not a positional-accuracy or survey-coverage guarantee.
        metric = transform(to_metric, MultiLineString(lines))
        simplified = metric.simplify(100, preserve_topology=True)
        output = transform(to_wgs, simplified)
        if output.geom_type != "MultiLineString" or output.is_empty:
            raise ValueError("line processing changed geometry type")
        output_points += sum(len(line.coords) for line in output.geoms)
        coordinates = [[[round(x, 6), round(y, 6)] for x, y in line.coords] for line in output.geoms]
        features.append({"type": "Feature", "properties": {"code": code, "name": name}, "geometry": {"type": "MultiLineString", "coordinates": coordinates}})
    base_codes = {f["properties"]["code"] for f in features}
    if len(base_codes) != 66 or len(excluded) != 4 or any(not set(value["members"]) <= base_codes for value in codes.values()):
        raise ValueError("incomplete reviewed code/geometry relationship")
    geometry = encode({"type": "FeatureCollection", "features": features})
    if len(geometry) > 16000000:
        raise ValueError(f"line pack exceeds client capacity: {len(geometry)} bytes, {output_points} points")
    manifest = {
        "schema_version": 1, "geometry_version": "20240520", "code_table_version": "20261007",
        "reviewed_at": reviewed.isoformat(), "review_due_at": (reviewed + timedelta(days=90)).isoformat(),
        "source_crs": "EPSG:6668", "output_crs": "EPSG:4326", "geometry_type": "MultiLineString",
        "geometry": {"path": PREFIX + "coastal-lines.geojson", "bytes": len(geometry), "sha256": digest(geometry)},
        "codes": codes, "excluded_geometry": excluded,
        "sources": [
            {"url": "https://www.data.jma.go.jp/developer/gis/20240520_AreaTsunami_GIS.zip", "sha256": HASHES["shapefile.zip"], "version": "20240520", "published_at": "2024-05-20", "retrieved_at": retrieved.isoformat()},
            {"url": "https://xml.kishou.go.jp/jmaxml_20261007_Code.zip", "sha256": HASHES["codebook.zip"], "version": "20261007", "published_at": "2026-10-07", "retrieved_at": retrieved.isoformat()},
        ],
        "workbook_sha256": digest(workbook_bytes),
        "processing": {"method": "JGD2011 to Web Mercator; topology-preserving simplify 100 metres; to WGS84 rounded to 6 decimal places for display. Line parts retained; no polygons inferred. Processing tolerance is not source positional accuracy.", "original_points": original_points, "output_points": output_points, "positional_accuracy": "UNKNOWN"},
        "coverage": "PARTIAL_REFERENCE_LINES", "station_coordinate_mapping": "UNAVAILABLE",
        "effective_intervals": "UNKNOWN", "license_url": "https://www.jma.go.jp/jma/kishou/info/coment.html",
        "attribution": "気象庁の津波予報区GISを72Hが加工。国土地理院承認番号：平30情使第401号、令2情使第125号、令3情使第90号・第123号・第648号、令4情使第437号、令5情使第71号、令6情使第382号、令7情使第395号。",
    }
    directory = ROOT / "apps/web/public" / PREFIX.lstrip("/")
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "coastal-lines.geojson").write_bytes(geometry)
    manifest_bytes = encode(manifest)
    (directory / "manifest.json").write_bytes(manifest_bytes)
    (ROOT / "apps/web/lib/jma-forecast-lines-pin.json").write_bytes(encode({"path": PREFIX + "manifest.json", "sha256": digest(manifest_bytes)}))
    print(json.dumps({"features": len(features), "bytes": len(geometry), "original_points": original_points, "output_points": output_points}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--retrieved-at", required=True)
    parser.add_argument("--reviewed-at", help="Explicit UTC/offset review clock for exact manifest reproduction")
    args = parser.parse_args()
    build(args.source_dir, args.retrieved_at, args.reviewed_at)
