"""Build hash-pinned, lazy prefecture packs from GSI's published national CSVs.

Static designation reference only. No opening, route or safe-location authority.
Retain the raw downloads outside public assets for reproducible offline rebuilds.
"""
import argparse
import collections
import csv
import hashlib
import io
import json
import math
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/"
SOURCE_PATHS = {
    "shelters": "csv/mergeFromCity_1.csv",
    "emergency": "csv/mergeFromCity_2.csv",
    "municipalities": "publicHistoryCSV/publicHistoryListData.csv",
    "prefectures": "publicHistoryCSV/prefectureListData.csv",
}
HAZARDS = ("洪水", "崖崩れ、土石流及び地滑り", "高潮", "地震", "津波", "大規模な火事", "内水氾濫", "火山現象")


def normalize_place(row, kind):
    identity = (row.get("共通ID") or "").strip()
    name = (row.get("施設・場所名") or "").strip()
    if not re.fullmatch(r"E\d{5}[A-Z0-9]{8}", identity) or not name or kind not in {"SHELTER", "EMERGENCY_SITE"}:
        raise ValueError("Missing/invalid designation identity or name")
    lat, lng = float(row["緯度"]), float(row["経度"])
    if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError(f"Invalid coordinates: {identity}")
    mask = "".join(
        "U" if kind == "SHELTER" or key not in row or row[key] is None
        else "D" if row[key].strip() == "1" else "N" if row[key].strip() == "" else "U"
        for key in HAZARDS
    )
    notes = (row.get("備考") or "").strip()
    for key in ("受入対象者", "その他市町村長が必要と認める事項"):
        if row.get(key, "").strip():
            notes += (" · " if notes else "") + key + ": " + row[key].strip()
    return [identity, name, (row.get("住所") or "").strip() or None, lat, lng,
            kind, mask, notes, identity[1:6]]


def encode(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def build(source_dir, output_dir, retrieved_at):
    # Each source has its own receipt time; never relabel a retained old download.
    receipts = json.loads((source_dir / "receipts.json").read_text()) if (source_dir / "receipts.json").exists() else {}
    if not receipts and not retrieved_at:
        raise ValueError("Retained sources require --retrieved-at or download receipts")
    raw = {key: (source_dir / Path(path).name).read_bytes() for key, path in SOURCE_PATHS.items()}
    if receipts and any(receipts.get(key, {}).get("sha256") != digest(payload) for key, payload in raw.items()):
        raise ValueError("Retained source bytes do not match their download receipts")
    histories = list(csv.reader(io.StringIO(raw["municipalities"].decode("utf-8-sig"))))
    history = {row[0]: row for row in histories if len(row) >= 4 and re.fullmatch(r"\d{5}", row[0])}
    pref_rows = list(csv.reader(io.StringIO(raw["prefectures"].decode("utf-8-sig"))))
    prefectures = {row[0][:2]: row[1] for row in pref_rows if len(row) >= 2 and re.fullmatch(r"\d{2}000", row[0])}
    if set(prefectures) != {f"{i:02}" for i in range(1, 48)}:
        raise ValueError("The official prefecture catalog must contain all 47 prefectures")
    grouped = {key: [] for key in prefectures}
    counts = collections.Counter()
    municipality_counts = collections.Counter()
    identities = set()
    source_counts = {}
    for key, kind in (("shelters", "SHELTER"), ("emergency", "EMERGENCY_SITE")):
        rows = list(csv.DictReader(io.StringIO(raw[key].decode("utf-8-sig"))))
        source_counts[key] = len(rows)
        for row in rows:
            place = normalize_place(row, kind)
            identity = (kind, place[0])
            if identity in identities:
                raise ValueError(f"Duplicate typed common ID: {identity}")
            identities.add(identity)
            pref = place[8][:2]
            if pref not in grouped or place[8] not in history:
                raise ValueError(f"Unknown official municipality: {place[8]}")
            grouped[pref].append(place)
            counts[kind] += 1
            municipality_counts[place[8]] += 1
    output_dir.mkdir(parents=True, exist_ok=True)
    descriptors = []
    for code, name in sorted(prefectures.items()):
        places = sorted(grouped[code], key=lambda place: (place[8], place[5], place[0]))
        payload = encode(places)
        sha = digest(payload)
        path = f"/shelters/japan-v1/{code}-{sha}.json"
        if len(payload) > 8_000_000 or len(places) > 30000:
            raise ValueError(f"Prefecture exceeds bounded runtime pack size: {code}")
        (output_dir / Path(path).name).write_bytes(payload)
        descriptors.append({"code": code, "name": name, "path": path, "sha256": sha,
                            "bytes": len(payload), "count": len(places),
                            "bbox": [min(p[4] for p in places), min(p[3] for p in places), max(p[4] for p in places), max(p[3] for p in places)],
                            "municipalities": [{"code": cid, "name": entry[1], "updated_at": entry[3] or None,
                                                "count": municipality_counts[cid],
                                                "publication_status": "PUBLISHED" if entry[2] and entry[3] and (len(entry) < 5 or entry[4] not in {"1", "9"}) else "NOT_PUBLISHED"}
                                               for cid, entry in sorted(history.items()) if cid.startswith(code)]})
    sources = [{"id": key, "url": BASE + path, "raw_sha256": digest(raw[key]),
                "bytes": len(raw[key]), "retrieved_at": receipts.get(key, {}).get("retrieved_at", retrieved_at),
                "count": source_counts.get(key)} for key, path in SOURCE_PATHS.items()]
    for source in sources:
        datetime.fromisoformat(source["retrieved_at"].replace("Z", "+00:00"))
    manifest = {"schema_version": 1, "dataset_id": "gsi-japan-designated-places-v1", "coverage": "PUBLISHED_RECORDS_ONLY",
                "source_page": "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html",
                "license_url": "https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html",
                "notice_url": "https://www.gsi.go.jp/bousaichiri/hinanbasho-help.html",
                "open_status": "UNKNOWN", "route_authorized": False, "safe_location_verified": False,
                "total_count": sum(counts.values()), "shelter_count": counts["SHELTER"],
                "emergency_count": counts["EMERGENCY_SITE"], "sources": sources, "prefectures": descriptors}
    payload = encode(manifest)
    if len(payload) > 512000:
        raise ValueError("Oversized national manifest")
    path = f"/shelters/japan-v1/manifest-{digest(payload)}.json"
    (output_dir / Path(path).name).write_bytes(payload)
    pin = {"path": path, "sha256": digest(payload)}
    (ROOT / "apps/web/lib/japan-shelter-pin.json").write_bytes(encode(pin))
    return {**counts, "total": manifest["total_count"], "prefectures": len(descriptors),
            "municipalities": len(history), "asset_bytes": sum(d["bytes"] for d in descriptors), "pin": pin}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--retrieved-at", help="Actual receipt time for externally retained input files")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "apps/web/public/shelters/japan-v1")
    args = parser.parse_args()
    if args.download:
        args.source_dir.mkdir(parents=True, exist_ok=True)
        receipts = {}
        for key, path in SOURCE_PATHS.items():
            with urllib.request.urlopen(BASE + path, timeout=60) as response:
                payload = response.read(50_000_001)
            if len(payload) > 50_000_000:
                raise ValueError("Oversized official source")
            (args.source_dir / Path(path).name).write_bytes(payload)
            receipts[key] = {"retrieved_at": datetime.now(timezone.utc).isoformat(), "sha256": digest(payload)}
        (args.source_dir / "receipts.json").write_bytes(encode(receipts))
    print(json.dumps(build(args.source_dir, args.output_dir, args.retrieved_at), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
