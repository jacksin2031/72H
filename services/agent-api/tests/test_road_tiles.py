import hashlib, json
from datetime import datetime, timezone
from pathlib import Path
import pytest
from agent_api.road_tiles import (TILE_LAT_DEG, TILE_LNG_DEG, TileTooDense, build_tile_graph,
                                  overpass_query, parse_tile_id, tile_bounds)

FIXTURE = Path(__file__).parent / "fixtures" / "overpass_tile_small.json"
AT = datetime(2026, 10, 15, tzinfo=timezone.utc)

def test_tile_id_round_trip_and_bounds():
    row, col = parse_tile_id("r1920c5651")
    assert (row, col) == (1920, 5651)
    s, w, n, e = tile_bounds(row, col)
    assert s == pytest.approx(1920 * TILE_LAT_DEG) and n == pytest.approx(s + TILE_LAT_DEG)
    assert w == pytest.approx(5651 * TILE_LNG_DEG) and e == pytest.approx(w + TILE_LNG_DEG)

@pytest.mark.parametrize("bad", ["", "r1c", "x1c2", "r-1c5", "r999c5651", "r1920c99999", "r1920c5651;", "R1920C5651"])
def test_tile_id_rejects_malformed_or_outside_japan(bad):
    with pytest.raises(ValueError):
        parse_tile_id(bad)

def test_query_is_fixed_and_bounded():
    q = overpass_query(tile_bounds(1920, 5651))
    assert q.startswith("[out:json][timeout:45];") and "out body qt;" in q
    assert "service" in q and "sidewalk" in q and "foot" in q
    assert q.count("(38.4,141.275,38.42,141.3)") == 3

def test_build_filters_and_labels_reference_only():
    raw = FIXTURE.read_bytes()
    g = build_tile_graph("r1920c5651", json.loads(raw), raw, AT)
    assert g["role"] == "ROAD_REFERENCE_ONLY" and g["movement_authorized"] is False
    assert g["schema_version"] == 2 and g["pack_id"] == "osm-tile-r1920c5651-v1"
    tags = [w[1] for w in g["ways"]]
    assert all(t.get("service") != "driveway" and t.get("access") != "private" for t in tags)
    assert g["counts"] == [len(g["nodes"]), len(g["ways"]), len(g["edges"])]
    assert g["source"]["raw_sha256"] == hashlib.sha256(raw).hexdigest()
    body = {k: v for k, v in g.items() if k != "content_sha256"}
    assert g["content_sha256"] == hashlib.sha256(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()

def test_nodes_outside_buffered_bounds_are_dropped_not_kept():
    raw = FIXTURE.read_bytes(); data = json.loads(raw)
    data["elements"].append({"type": "node", "id": 999999, "lat": 10.0, "lon": 10.0})
    g = build_tile_graph("r1920c5651", data, raw, AT)
    assert all(n[0] != 999999 for n in g["nodes"])

def test_too_dense_raises():
    raw = FIXTURE.read_bytes(); data = json.loads(raw)
    # Zig-zag so consecutive nodes are distinct points (zero-length segments are skipped).
    data["elements"] += [{"type": "node", "id": 10_000_000 + i, "lat": 38.41, "lon": 141.28 + (i % 2) * 0.0001} for i in range(20_001)]
    data["elements"].append({"type": "way", "id": 77, "nodes": [10_000_000 + i for i in range(20_001)], "tags": {"highway": "footway"}})
    with pytest.raises(TileTooDense):
        build_tile_graph("r1920c5651", data, raw, AT)


def test_committed_browser_fixture_matches_rebuild():
    """Task 6 cross-checks content_sha256 against this committed tile in the browser."""
    raw = FIXTURE.read_bytes()
    at = datetime(2026, 10, 15, tzinfo=timezone.utc)
    g = build_tile_graph("r1920c5651", json.loads(raw), raw, at)
    committed = Path(__file__).parents[3] / "apps" / "web" / "tests" / "fixtures" / "road-tile-r1920c5651.json"
    assert json.loads(committed.read_text(encoding="utf-8")) == g
    assert committed.read_text(encoding="utf-8") == json.dumps(g, ensure_ascii=False, indent=2) + "\n"
