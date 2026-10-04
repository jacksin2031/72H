"""Export reviewable tracked/unignored source, with hashes and no dependencies."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "cloud-shell"


def main():
    subprocess.run([sys.executable, str(ROOT / "scripts/check_secrets.py")], cwd=ROOT, check=True)
    candidates = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode("utf-8").split("\0")
    files = {}
    for relative in sorted(set(candidates)):
        if not relative:
            continue
        target = (ROOT / relative).resolve()
        if not target.is_relative_to(ROOT) or target.is_symlink():
            raise ValueError("Bundle path escapes workspace")
        if target.is_file():
            files[relative] = target.read_bytes()
    hashes = {name: sha256(value).hexdigest() for name, value in files.items()}
    source_hash = sha256(json.dumps(hashes, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    manifest = {
        "kind": "WORKING_TREE_SOURCE_SNAPSHOT", "source_sha256": source_hash,
        "base_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "file_count": len(files), "file_sha256": hashes,
        "note": "Snapshot hash identifies exported content; base commit alone does not identify uncommitted implementation.",
    }
    files["bundle-manifest.json"] = json.dumps(manifest, indent=2).encode()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive = OUTPUT / "72h-cloud-shell-source.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
        for name, content in files.items():
            info = ZipInfo("72h/" + name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, content)
    (OUTPUT / "bundle-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Bundle: {archive}\nFiles: {manifest['file_count']}\nBytes: {archive.stat().st_size}\nSource SHA256: {source_hash}\nZIP SHA256: {sha256(archive.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
