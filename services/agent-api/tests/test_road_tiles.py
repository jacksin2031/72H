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

@pytest.mark.parametrize("bad", ["", "r1c", "x1c2", "r-1c5", "r999c5651", "r1920c99999", "r1920c5651;", "R1920C5651", "r\u0661\u0669\u0662\u0660c5651", "r01920c5651", "r1920c05651", "r1920c5651\n"])
def test_tile_id_rejects_malformed_or_outside_japan(bad):
    with pytest.raises(ValueError):
        parse_tile_id(bad)

def test_query_is_fixed_and_bounded():
    q = overpass_query(tile_bounds(1920, 5651))
    assert q.startswith("[out:json][timeout:12];") and "out body qt;" in q
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


def _zig(i, count=None):
    return {"type": "node", "id": 20_000_000 + i, "lat": 38.41 + i * 5e-7, "lon": 141.28 + (i % 2) * 0.0001}


def _base():
    raw = FIXTURE.read_bytes()
    return raw, json.loads(raw)


def test_integral_float_coordinates_are_emitted_as_ints():
    data = {"elements": [{"type": "node", "id": 1, "lat": 38.0, "lon": 141.0},
                         {"type": "node", "id": 2, "lat": 38.0, "lon": 141.0001},
                         {"type": "way", "id": 9, "nodes": [1, 2], "tags": {"highway": "footway"}}]}
    g = build_tile_graph("r1900c5640", data, b"{}", AT)  # tile spans 38.0-38.02, 141.0-141.025
    assert g["nodes"][0] == [1, 38, 141]
    compact = json.dumps(g, separators=(",", ":"), ensure_ascii=False)
    assert '"nodes":[[1,38,141],[2,38,141.0001]]' in compact


def test_tags_are_limited_like_the_browser_schema():
    raw, data = _base()
    way = next(e for e in data["elements"] if e["id"] == 201)
    way["tags"].update({"1": "x", "k" * 101: "v", "big": "v" * 1001})
    for i in range(250):
        way["tags"][f"zz{i:03d}"] = "v"
    g = build_tile_graph("r1920c5651", data, raw, AT)
    tags = g["ways"][0][1]
    assert "1" not in tags and "big" not in tags and not any(len(k) > 100 for k in tags)
    assert len(tags) == 200 and tags["highway"] == "footway"
    assert [k for k in tags][-1] == "zz197"  # first 200 kept in source order


def test_eligibility_key_breaking_limits_excludes_way():
    raw, data = _base()
    way = next(e for e in data["elements"] if e["id"] == 201)
    way["tags"]["access"] = "x" * 1001
    g = build_tile_graph("r1920c5651", data, raw, AT)
    assert g["ways"] == []


def test_empty_oneway_foot_is_accepted_without_direction():
    raw, data = _base()
    next(e for e in data["elements"] if e["id"] == 201)["tags"]["oneway:foot"] = ""
    g = build_tile_graph("r1920c5651", data, raw, AT)
    assert len(g["ways"]) == 1 and all(len(e) == 3 for e in g["edges"])


def test_early_node_guard_raises():
    raw, data = _base()
    data["elements"] += [{"type": "node", "id": 40_000_000 + i, "lat": 38.41, "lon": 141.28} for i in range(60_001)]
    with pytest.raises(TileTooDense):
        build_tile_graph("r1920c5651", data, raw, AT)


def test_way_cap_raises():
    raw, data = _base()
    data["elements"] = [_zig(i) for i in range(16_002)] + [
        {"type": "way", "id": 50_000 + k, "nodes": [20_000_000 + 2 * k, 20_000_000 + 2 * k + 1], "tags": {"highway": "footway"}}
        for k in range(8_001)]
    with pytest.raises(TileTooDense):
        build_tile_graph("r1920c5651", data, raw, AT)


def test_edge_cap_raises():
    raw, data = _base()
    refs = [20_000_000 + i for i in range(10_000)]
    data["elements"] = [_zig(i) for i in range(10_000)] + [
        {"type": "way", "id": 60_000 + k, "nodes": refs, "tags": {"highway": "footway"}} for k in range(5)]
    with pytest.raises(TileTooDense):
        build_tile_graph("r1920c5651", data, raw, AT)


def test_byte_cap_raises(monkeypatch):
    import agent_api.road_tiles as rt
    raw, data = _base()
    monkeypatch.setattr(rt, "MAX_BYTES", 100)
    with pytest.raises(TileTooDense):
        build_tile_graph("r1920c5651", data, raw, AT)
