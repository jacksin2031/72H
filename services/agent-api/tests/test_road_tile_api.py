import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from agent_api.main import create_app
from agent_api.road_tile_service import RoadTileService

RAW = (Path(__file__).parent / "fixtures" / "overpass_tile_small.json").read_bytes()


def client(fetch, tmp_path, **kw):
    kw.setdefault("min_interval_s", 0)
    svc = RoadTileService(fetch=fetch, cache_dir=tmp_path, **kw)
    return TestClient(create_app(road_tiles=svc)), svc


def test_success_then_cache(tmp_path):
    calls = []
    async def fetch(q): calls.append(q); return 200, RAW
    c, _ = client(fetch, tmp_path)
    a = c.get("/api/roads/tile/r1920c5651"); b = c.get("/api/roads/tile/r1920c5651")
    assert a.status_code == b.status_code == 200 and len(calls) == 1
    body = a.json()
    assert body["role"] == "ROAD_REFERENCE_ONLY" and body["movement_authorized"] is False
    assert a.headers["cache-control"] == "public, max-age=86400"


def test_rejects_coordinates_and_bad_ids(tmp_path):
    async def fetch(q): raise AssertionError("must not call Overpass")
    c, _ = client(fetch, tmp_path)
    for path in ["r1920c5651x", "38.41,141.28", "r9999c1"]:
        assert c.get(f"/api/roads/tile/{path}").status_code in (400, 404)
    assert c.get("/api/roads/tile/r1920c5651?lat=38.4&lng=141.2").status_code == 400


@pytest.mark.parametrize("status", [429, 500, 504])
def test_upstream_failure_is_503_without_retry(tmp_path, status):
    calls = []
    async def fetch(q): calls.append(q); return status, b"busy"
    c, _ = client(fetch, tmp_path)
    r = c.get("/api/roads/tile/r1920c5651")
    assert r.status_code == 503 and r.json()["detail"] == "ROAD_DATA_TEMPORARILY_UNAVAILABLE" and len(calls) == 1


def test_network_exception_is_503(tmp_path):
    async def fetch(q): raise OSError("down")
    c, _ = client(fetch, tmp_path)
    assert c.get("/api/roads/tile/r1920c5651").status_code == 503


def test_malformed_upstream_is_503_and_not_cached(tmp_path):
    async def fetch(q): return 200, b"{not json"
    c, _ = client(fetch, tmp_path)
    assert c.get("/api/roads/tile/r1920c5651").status_code == 503
    assert not list(tmp_path.glob("*.json"))


def test_missing_osm3s_is_503(tmp_path):
    async def fetch(q): return 200, b'{"elements":[]}'
    c, _ = client(fetch, tmp_path)
    assert c.get("/api/roads/tile/r1920c5651").status_code == 503


def test_too_dense_is_413_and_not_cached(tmp_path, monkeypatch):
    from agent_api import road_tile_service as mod
    def boom(*a, **k): raise mod.TileTooDense("x")
    monkeypatch.setattr(mod, "build_tile_graph", boom)
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path)
    r = c.get("/api/roads/tile/r1920c5651")
    assert r.status_code == 413 and r.json()["detail"] == "ROAD_TILE_TOO_DENSE"
    assert not list(tmp_path.glob("*.json"))


def test_session_rate_limit(tmp_path):
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path, per_session_per_minute=2)
    h = {"X-Road-Session": "s1"}
    codes = [c.get(f"/api/roads/tile/r1920c{5651 + i}", headers=h).status_code for i in range(3)]
    assert codes == [200, 200, 429]
    assert c.get("/api/roads/tile/r1920c5651", headers={"X-Road-Session": "s2"}).status_code == 200


def test_cache_hits_count_toward_rate_limit(tmp_path):
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path, per_session_per_minute=2)
    codes = [c.get("/api/roads/tile/r1920c5651").status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_cache_expires_after_30_days(tmp_path):
    from datetime import datetime, timedelta, timezone
    calls = []; clock = {"now": datetime(2026, 10, 15, tzinfo=timezone.utc)}
    async def fetch(q): calls.append(q); return 200, RAW
    c, _ = client(fetch, tmp_path, now=lambda: clock["now"])
    c.get("/api/roads/tile/r1920c5651"); clock["now"] += timedelta(days=31); c.get("/api/roads/tile/r1920c5651")
    assert len(calls) == 2


def test_tampered_cache_is_refetched(tmp_path):
    calls = []
    async def fetch(q): calls.append(q); return 200, RAW
    c, _ = client(fetch, tmp_path)
    c.get("/api/roads/tile/r1920c5651")
    f = tmp_path / "r1920c5651.json"
    data = json.loads(f.read_text(encoding="utf-8")); data["movement_authorized"] = True
    f.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    r = c.get("/api/roads/tile/r1920c5651")
    assert len(calls) == 2 and r.json()["movement_authorized"] is False


def test_overpass_requests_are_spaced_at_least_2s(tmp_path):
    import asyncio
    sleeps = []
    async def fake_sleep(s): sleeps.append(s)
    async def fetch(q): return 200, RAW
    svc = RoadTileService(fetch=fetch, cache_dir=tmp_path, clock=lambda: 100.0)
    import agent_api.road_tile_service as mod
    orig = mod.asyncio.sleep; mod.asyncio.sleep = fake_sleep
    try:
        async def run():
            await svc.get("r1920c5651", "s"); await svc.get("r1920c5652", "s")
        asyncio.run(run())
    finally:
        mod.asyncio.sleep = orig
    assert sleeps == [2.0]
