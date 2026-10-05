"""Refresh ignored integration fixtures through the running local frontend proxy."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / ".work"
MAX_RESPONSE_BYTES = 2_000_000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3005")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        parser.error("base-url must be a local HTTP frontend origin")

    def request(path: str, body: dict | None = None) -> dict:
        req = Request(
            base + "/api/replay" + path,
            data=None if body is None else json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="GET" if body is None else "POST",
        )
        with urlopen(req, timeout=20) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
        if len(payload) > MAX_RESPONSE_BYTES:
            raise RuntimeError("Replay response exceeded fixture size limit")
        return json.loads(payload)

    states = [request("/start", {"language": "ja", "scenario_key": "tokyo-earthquake-v1"})]
    initial = states[0]
    if initial["replay"]["planning_mode"] != "DETERMINISTIC_REPLAY_ONLY":
        raise RuntimeError("Start response is not a deterministic replay snapshot; capture stopped")
    if not initial.get("area_catalog") or not initial["profile"]["current_location"].get("area_ids"):
        raise RuntimeError("Running backend returned the legacy area/profile schema")
    count = len(initial["scenario_events"])
    if not 1 <= count <= 64:
        raise RuntimeError("Invalid replay timeline length")
    session = initial["replay"]["id"]
    for _ in range(count):
        state = request(f"/{session}/next", {})
        if state["replay"]["id"] != session or state["replay"]["planning_mode"] != "DETERMINISTIC_REPLAY_ONLY":
            raise RuntimeError("Replay session/planning mode changed during capture")
        states.append(state)
    final = states[-1]
    if final["replay"]["status"] != "COMPLETED" or final["situation"]["network_state"] != "ONLINE_VERIFIED":
        raise RuntimeError("Replay did not finish in the expected verified state")
    if not any(item.get("disaster_assessments") for item in final["evidence"]):
        raise RuntimeError("Running backend returned no typed disaster assessments")

    files = {
        "p0-api-states.json": json.dumps(states, ensure_ascii=False).encode("utf-8"),
        "p0-api-final.json": json.dumps(final, ensure_ascii=False).encode("utf-8"),
    }
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "frontend_origin": base,
        "session_id": session,
        "scenario_key": final["replay"]["scenario_key"],
        "planning_mode": final["replay"]["planning_mode"],
        "event_count": count,
        "plan_versions": [plan["version"] for plan in final["plans"]],
        "files": {name: {"bytes": len(data), "sha256": sha256(data).hexdigest()} for name, data in files.items()},
    }
    files["p0-api-fixtures-manifest.json"] = json.dumps(manifest, indent=2).encode("utf-8")
    OUT.mkdir(exist_ok=True)
    for name, data in files.items():
        (OUT / (name + ".tmp")).write_bytes(data)
    for name in files:
        (OUT / (name + ".tmp")).replace(OUT / name)
    print(f"PASS: refreshed p0-api-states.json and p0-api-final.json through {base}; {count} events / {len(final['plans'])} plans / ONLINE_VERIFIED; manifest records capture time and hashes")


if __name__ == "__main__":
    main()
