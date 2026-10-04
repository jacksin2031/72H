"""Small repository secret gate. Prints locations only, never matched values."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"\b(?:ghp_|github_pat_)[0-9A-Za-z_]{30,}"),
    re.compile(r'"private_key"\s*:\s*"[^"\n]{12,}"'),
    re.compile(r"(?im)^\s*(?:NEXT_PUBLIC_)?(?:GEMINI_API_KEY|TRANSPORT_API_KEY|EKISPERT_API_ACCESS_KEY|API_SECRET|ACCESS_TOKEN)\s*=\s*[^\s#]{12,}\s*$"),
]


def main() -> int:
    paths = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode("utf-8").split("\0")
    findings = []
    for relative in paths:
        if not relative:
            continue
        path = ROOT / relative
        if path.name.startswith(".env") and path.name != ".env.example":
            findings.append(f"{relative}: forbidden environment file")
        if re.match(r"(?:service-account|credentials).*\.json$", path.name) or path.suffix in {".pem", ".key"}:
            findings.append(f"{relative}: forbidden credential file")
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(content.splitlines(), 1):
            if any(pattern.search(line) for pattern in PATTERNS):
                findings.append(f"{relative}:{line_number}: possible secret")
    if findings:
        print("\n".join(findings))
        return 1
    print("PASS: repository secret-pattern and credential-file checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
