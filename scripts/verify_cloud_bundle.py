"""Check exported source against the recorded manifest before cloud build."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "bundle-manifest.json").read_text(encoding="utf-8"))
hashes = manifest["file_sha256"]
expected = sha256(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
if expected != manifest["source_sha256"]:
    raise SystemExit("Source manifest hash is invalid")
for name, digest in hashes.items():
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file() or sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit(f"Source differs from reviewed export: {name}")
print(f"PASS: {len(hashes)} source files match {expected}")
