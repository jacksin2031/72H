"""Verify the complete pinned national area artifact without downloading or changing it."""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    assets = ROOT / "apps/web/public/areas"
    manifest = json.loads((assets / "manifest.json").read_bytes())
    catalog_bytes = (assets / "catalog.json").read_bytes()
    assert len(catalog_bytes) == manifest["catalog_bytes"]
    assert hashlib.sha256(catalog_bytes).hexdigest() == manifest["catalog_sha256"]
    assert catalog_bytes == (ROOT / "packages/contracts/seventytwoh_contracts/data/japan-areas.json").read_bytes()
    catalog = json.loads(catalog_bytes)
    assert len(catalog) == manifest["area_count"]
    assert len({a["id"] for a in catalog}) == len(catalog)
    assert len([a for a in catalog if len(a["id"]) == 5 and a["id"].startswith("JP-")]) == 47
    features = set()
    paths = set()
    total = 0
    for descriptors in manifest["cells"].values():
        for descriptor in descriptors:
            path = assets / Path(descriptor["asset"]).name
            assert path.parent == assets and path.suffix == ".gz"
            if path in paths:
                continue
            paths.add(path)
            blob = path.read_bytes()
            assert len(blob) == descriptor["bytes"]
            assert hashlib.sha256(blob).hexdigest() == descriptor["sha256"]
            decoded = gzip.decompress(blob)
            assert len(decoded) == descriptor["decoded_bytes"] <= 8_000_000
            records = json.loads(decoded)
            assert len(records) == descriptor["features"]
            features.update(item["id"] for item in records)
            total += len(blob)
    assert len(features) == manifest["feature_count"]
    assert set(assets.glob("*.json.gz")) == paths, "Orphan national shard"
    print(json.dumps({"status": "PASS", "dataset": manifest["dataset"], "areas": len(catalog),
                      "features": len(features), "shards": len(paths), "compressed_bytes": total,
                      "manifest_sha256": hashlib.sha256((assets / 'manifest.json').read_bytes()).hexdigest()}, indent=2))


if __name__ == "__main__":
    main()
