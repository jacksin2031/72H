"""Reproducible N03 2026 area assets. Build-only: pyshp==2.3.1, pypdf==6.0.0.

No geometry simplification or rounding. Raw archives stay outside Git.
Run with --archive <official zip> --undetermined <official PDF>.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
from zipfile import ZipFile

import shapefile
from pypdf import PdfReader

SOURCE = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html"
ARCHIVE_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2026/N03-20260101_GML.zip"
UNCERTAIN_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/N03_Boundary_undetermined.pdf"
GRID_DEGREES = 0.25
MAX_SHARD_BYTES = 8_000_000
ROOT = Path(__file__).resolve().parents[1]


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def feature_line(value, limit=MAX_SHARD_BYTES):
    line = encoded(value) + b"\n"
    # NDJSON has one newline; the emitted JSON array needs two brackets.
    if len(line) + 1 > limit:
        raise ValueError("Individual unsimplified feature exceeds shard bound")
    return line


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--undetermined", required=True, type=Path)
    args = parser.parse_args()
    output = ROOT / "apps/web/public/areas"
    output.mkdir(parents=True, exist_ok=True)
    spool = ROOT / ".work/p1-1/area-spool"
    spool.mkdir(parents=True, exist_ok=True)
    raw = ROOT / ".work/p1-1/raw"
    raw.mkdir(parents=True, exist_ok=True)
    with ZipFile(args.archive) as archive:
        for suffix in ("shp", "shx", "dbf", "prj"):
            archive.extract(f"N03-20260101.{suffix}", raw)
    uncertain = set()
    cross_prefecture = set()
    for page in PdfReader(args.undetermined).pages:
        for line in page.extract_text().splitlines():
            codes = re.findall(r"(?<!\d)\d{5}(?!\d)", line)
            uncertain.update(codes)
            if len({code[:2] for code in codes}) > 1:
                cross_prefecture.update(codes)
    reader = shapefile.Reader(str(raw / "N03-20260101"), encoding="utf-8")
    areas = {"JP": {"id": "JP", "label": "日本", "parent_id": None}}
    handles = {}
    features = 0
    for sr in reader.iterShapeRecords():
        pref, _, _, city, ward, code = sr.record
        if not re.fullmatch(r"\d{5}", code or ""):
            # Membership of unidentified land is deliberately not fabricated.
            continue
        pref_id = f"JP-{code[:2]}"
        municipality = f"JP-MUNI-{code}"
        areas[pref_id] = {"id": pref_id, "label": pref, "parent_id": "JP"}
        areas[municipality] = {"id": municipality, "label": city + ward, "parent_id": pref_id}
        points = sr.shape.points
        parts = list(sr.shape.parts) + [len(points)]
        rings = [[list(point) for point in points[parts[i]:parts[i + 1]]] for i in range(len(parts) - 1)]
        bbox = list(sr.shape.bbox)
        feature = {"id": features, "area_id": municipality, "prefecture_id": pref_id,
                   "bbox": bbox, "rings": rings,
                   "uncertain_scope": "JP" if code in cross_prefecture else pref_id if code in uncertain else None}
        line = feature_line(feature)
        for x in range(math.floor(bbox[0] / GRID_DEGREES), math.floor(bbox[2] / GRID_DEGREES) + 1):
            for y in range(math.floor(bbox[1] / GRID_DEGREES), math.floor(bbox[3] / GRID_DEGREES) + 1):
                cell = f"{x}-{y}"
                if cell not in handles:
                    handles[cell] = (spool / f"{cell}.ndjson").open("wb")
                handles[cell].write(line)
        features += 1
        if features % 25000 == 0:
            print(f"Processed {features} unsimplified features", flush=True)
    for handle in handles.values():
        handle.close()
    assert len([a for a in areas if re.fullmatch(r"JP-\d{2}", a)]) == 47
    catalog = sorted(areas.values(), key=lambda area: area["id"])
    catalog_bytes = encoded(catalog)
    (output / "catalog.json").write_bytes(catalog_bytes)
    registry = ROOT / "packages/contracts/seventytwoh_contracts/data"
    registry.mkdir(parents=True, exist_ok=True)
    (registry / "japan-areas.json").write_bytes(catalog_bytes)
    index = {}
    byte_total = 0
    for cell in sorted(handles):
        index[cell] = []
        batch = []
        size = 2
        def flush():
            nonlocal byte_total, batch, size
            if not batch:
                return
            payload = b"[" + b",".join(batch) + b"]"
            if len(payload) > MAX_SHARD_BYTES:
                raise ValueError("Decoded shard exceeds runtime bound")
            compressed = gzip.compress(payload, compresslevel=9, mtime=0)
            sha = hashlib.sha256(compressed).hexdigest()
            filename = f"n03-2026-{sha}.json.gz"
            (output / filename).write_bytes(compressed)
            index[cell].append({"asset": f"/areas/{filename}", "sha256": sha,
                                "bytes": len(compressed), "decoded_bytes": len(payload), "features": len(batch)})
            byte_total += len(compressed)
            batch, size = [], 2
        with (spool / f"{cell}.ndjson").open("rb") as handle:
            for line in handle:
                item = line.rstrip(b"\n")
                if batch and size + len(item) + 1 > MAX_SHARD_BYTES:
                    flush()
                batch.append(item)
                size += len(item) + 1
        flush()
    manifest = {"version": 1, "dataset": "N03-20260101", "source_url": SOURCE,
                "archive_url": ARCHIVE_URL, "archive_sha256": digest(args.archive),
                "undetermined_url": UNCERTAIN_URL, "undetermined_sha256": digest(args.undetermined),
                "license": "CC BY 4.0", "attribution": "国土交通省 国土数値情報（行政区域）2026年版を加工",
                "geometry_policy": "Original double precision rings, no simplification; provisional municipalities demoted in full.",
                "catalog_sha256": hashlib.sha256(catalog_bytes).hexdigest(),
                "catalog_bytes": len(catalog_bytes), "grid_degrees": GRID_DEGREES,
                "feature_count": features, "area_count": len(catalog), "cells": index}
    (output / "manifest.json").write_bytes(encoded(manifest))
    print(json.dumps({"features": features, "areas": len(catalog), "cells": len(index),
                      "compressed_bytes": byte_total, "uncertain_municipalities": len(uncertain)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
