"""R21: every road-tile 413/429/503 logs the tile id and a short reason code, never coordinates or session keys."""
import asyncio
import logging
import re
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from agent_api.main import create_app
from agent_api.road_tile_service import RoadTileService

RAW = (Path(__file__).parent / "fixtures" / "overpass_tile_small.json").read_bytes()
TILE = "r1920c5651"
SESSION = "secret-session-key-123"
COORDINATE = re.compile(r"\d{2,3}\.\d+")


def client(fetch, tmp_path, **kw):
    kw.setdefault("min_interval_s", 0)
    svc = RoadTileService(fetch=fetch, cache_dir=tmp_path, **kw)
    return TestClient(create_app(road_tiles=svc)), svc


def road_records(caplog):
    return [r for r in caplog.records if r.name.startswith("agent_api") and "road tile" in r.getMessage()]


def assert_logged(caplog, status, reason, tile=TILE):
    records = road_records(caplog)
    assert len(records) == 1, [r.getMessage() for r in records]
    message = records[0].getMessage()
    assert records[0].levelno == logging.WARNING
    assert tile in message and f"status={status}" in message and f"reason={reason}" in message
    assert SESSION not in message
    assert not COORDINATE.search(message), message


def get(c, tile=TILE):
    return c.get(f"/api/roads/tile/{tile}", headers={"X-Road-Session": SESSION})


@pytest.mark.parametrize("status", [429, 500, 504])
def test_upstream_status_logs_reason(tmp_path, caplog, status):
    async def fetch(q): return status, b"busy"
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, f"UPSTREAM_STATUS_{status}")


def test_upstream_timeout_logs_reason(tmp_path, caplog):
    async def fetch(q): raise asyncio.TimeoutError
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, "UPSTREAM_TIMEOUT")


def test_httpx_timeout_logs_upstream_timeout(tmp_path, caplog):
    async def fetch(q): raise httpx.ReadTimeout("slow")
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, "UPSTREAM_TIMEOUT")


def test_network_error_logs_reason(tmp_path, caplog):
    async def fetch(q): raise OSError("down 38.41,141.28")
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, "UPSTREAM_ERROR")


@pytest.mark.parametrize("raw", [b"{not json", b'{"elements":[]}', b"[]"])
def test_malformed_logs_reason(tmp_path, caplog, raw):
    async def fetch(q): return 200, raw
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, "MALFORMED")


def test_unparseable_payload_logs_malformed(tmp_path, caplog, monkeypatch):
    from agent_api import road_tile_service as mod
    def boom(*a, **k): raise KeyError("lat")
    monkeypatch.setattr(mod, "build_tile_graph", boom)
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, "MALFORMED")


def test_remark_logs_reason(tmp_path, caplog):
    async def fetch(q): return 200, b'{"osm3s":{},"remark":"runtime error: timeout","elements":[]}'
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, "REMARK")


def test_too_dense_logs_reason(tmp_path, caplog, monkeypatch):
    from agent_api import road_tile_service as mod
    def boom(*a, **k): raise mod.TileTooDense("38.41 141.28 too many nodes")
    monkeypatch.setattr(mod, "build_tile_graph", boom)
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 413
    assert_logged(caplog, 413, "TOO_DENSE")


def test_session_rate_limit_logs_reason_without_session_key(tmp_path, caplog):
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path, per_session_per_minute=1)
    assert get(c).status_code == 200
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 429
    assert_logged(caplog, 429, "RATE_LIMIT_SESSION")


def test_global_rate_limit_logs_reason(tmp_path, caplog):
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path, global_per_minute=1)
    assert get(c).status_code == 200
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 429
    assert_logged(caplog, 429, "RATE_LIMIT_GLOBAL")


def test_lock_deadline_logs_reason(tmp_path, caplog, monkeypatch):
    import agent_api.road_tile_service as mod
    real = asyncio.wait_for
    async def fake_wait_for(aw, timeout):
        if timeout == mod.LOCK_WAIT_S:
            aw.close()
            raise asyncio.TimeoutError
        return await real(aw, timeout)
    monkeypatch.setattr(mod.asyncio, "wait_for", fake_wait_for)
    async def fetch(q): raise AssertionError("must not fetch")
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.WARNING):
        assert get(c).status_code == 503
    assert_logged(caplog, 503, "LOCK_DEADLINE")


def test_queue_full_logs_reason(tmp_path, caplog):
    from agent_api.road_tile_service import TileUnavailable
    async def run():
        gate = asyncio.Event()
        async def fetch(q): await gate.wait(); return 200, RAW
        svc = RoadTileService(fetch=fetch, cache_dir=tmp_path, min_interval_s=0, global_per_minute=1000)
        tasks = []
        for i in range(9):
            tasks.append(asyncio.create_task(svc.get(f"r1920c{5651 + i}", f"s{i}")))
            for _ in range(5): await asyncio.sleep(0)
        with pytest.raises(TileUnavailable) as raised:
            await svc.get("r1920c5700", "late")
        gate.set()
        await asyncio.gather(*tasks)
        return raised.value
    error = asyncio.run(run())
    assert error.reason == "QUEUE_FULL"
    # And through the endpoint: the reason is logged with the tile id only.
    async def blocked(q): raise AssertionError("unused")
    c, svc = client(blocked, tmp_path)
    svc._waiting = 8
    with caplog.at_level(logging.WARNING):
        assert get(c, "r1920c5700").status_code == 503
    assert_logged(caplog, 503, "QUEUE_FULL", tile="r1920c5700")


def test_success_and_bad_ids_log_nothing(tmp_path, caplog):
    async def fetch(q): return 200, RAW
    c, _ = client(fetch, tmp_path)
    with caplog.at_level(logging.DEBUG):
        assert get(c).status_code == 200
        assert c.get("/api/roads/tile/38.41,141.28").status_code == 400
    assert road_records(caplog) == []
