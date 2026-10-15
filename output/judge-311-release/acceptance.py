"""Bounded unauthenticated release probes. No external credentials are used."""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen

base, label = sys.argv[1:3]
out = Path(__file__).parent

def request(path, body=None):
    headers = {"Content-Type": "application/json", "Origin": base}
    data = None if body is None else json.dumps(body).encode()
    with urlopen(Request(base + path, data=data, headers=headers), timeout=60) as response:
        return response.status, response.read()

def post(path, body={}):
    status, raw = request(path, body)
    assert status in (200, 201), (path, status)
    return json.loads(raw)

result = {"base": base, "source": "4503c5eba19f1b0b90893c8fe1ae81ba2404e185", "routes": {}}
assets = set()
for path in ("/", "/judge", "/demo", "/disaster-test", "/more", "/api/health", "/api/version"):
    status, body = request(path)
    assert status == 200, (path, status)
    result["routes"][path] = status
    assets.update(re.findall(rb'(?:src|href)="(/_next/static/[^"?]+)', body))
for asset in assets:
    assert request(asset.decode())[0] == 200
result["static_assets"] = len(assets)
for path in ("/sw.js", "/precache-manifest.json"):
    status, body = request(path)
    assert status == 200
    result[path] = {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}

replay = post("/api/replay/start", {"language": "ja", "scenario_key": "tokyo-earthquake-v1"})
records = [replay]
for _ in range(11):
    replay = post(f'/api/replay/{replay["replay"]["id"]}/next')
    records.append(replay)
result["replay"] = {"step": replay["replay"]["current_event_index"],
    "plans": [p["version"] for p in replay.get("plans", [])],
    "network_states": [r["situation"]["network_state"] for r in records]}
assert result["replay"]["step"] == 11, result["replay"]
assert any(s.startswith("OFFLINE") for s in result["replay"]["network_states"])
assert result["replay"]["network_states"][-1] == "ONLINE_VERIFIED"
assert len(result["replay"]["plans"]) >= 2
live = post("/api/live/start", {"language": "ja", "profile": {
    "current_location": {"label": "Release test selected area", "area_ids": ["JP-MUNI-13113", "JP-13", "JP"]},
    "accommodation_location": {"label": "Not set", "area_ids": []}}})
result["live"] = {"network_state": live["situation"]["network_state"],
    "plans": len(live.get("plans", [])), "movement_authorized": [m.get("movement_authorized") for m in live.get("mobility", [])]}
assert not any(result["live"]["movement_authorized"])
(out / f"{label}-live.json").write_text(json.dumps(live, ensure_ascii=False, indent=2), encoding="utf-8")
(out / f"{label}-replay.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
(out / f"{label}-acceptance.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
