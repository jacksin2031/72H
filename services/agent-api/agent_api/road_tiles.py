"""Nationwide road-reference tiles: fixed grid, fixed Overpass query, ROAD_REFERENCE_ONLY output.

A tile is a road-graph snapshot for reference lines only. It never establishes route safety,
passability, accessibility or movement authority. Callers send a tile id, never a coordinate.
"""
from __future__ import annotations
import hashlib, json, math, re
from datetime import datetime

TILE_LAT_DEG = 0.02
TILE_LNG_DEG = 0.025
BUFFER_DEG = 0.002
LAT_RANGE = (20.0, 46.0)
LNG_RANGE = (122.0, 154.0)
MAX_NODES, MAX_WAYS, MAX_EDGES, MAX_BYTES = 20_000, 8_000, 40_000, 1_500_000
MAX_SEGMENT_M = 1_000
ENDPOINT = "https://overpass-api.de/api/interpreter"
_ID = re.compile(r"r(0|[1-9][0-9]{0,3})c(0|[1-9][0-9]{0,3})")
BASIC = {"footway", "path", "pedestrian", "steps", "living_street", "residential", "unclassified", "tertiary", "service"}


class TileTooDense(Exception):
    pass


def parse_tile_id(tile_id: str) -> tuple[int, int]:
    match = _ID.fullmatch(tile_id) if isinstance(tile_id, str) else None
    if not match:
        raise ValueError("Invalid tile id")
    row, col = int(match[1]), int(match[2])
    s, w, n, e = tile_bounds(row, col)
    if s < LAT_RANGE[0] or n > LAT_RANGE[1] or w < LNG_RANGE[0] or e > LNG_RANGE[1]:
        raise ValueError("Tile outside Japan range")
    return row, col


def tile_bounds(row: int, col: int) -> tuple[float, float, float, float]:
    s, w = round(row * TILE_LAT_DEG, 6), round(col * TILE_LNG_DEG, 6)
    return s, w, round(s + TILE_LAT_DEG, 6), round(w + TILE_LNG_DEG, 6)


def _box(b): return f"({b[0]:g},{b[1]:g},{b[2]:g},{b[3]:g})"


def overpass_query(bounds) -> str:
    box = _box(bounds)
    return ("[out:json][timeout:45];(\n"
            f'way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|unclassified|tertiary|service)$"]{box};\n'
            f'way["highway"~"^(secondary|primary)$"]["sidewalk"~"^(yes|both|left|right)$"]{box};\n'
            f'way["highway"~"^(secondary|primary)$"]["foot"~"^(yes|designated|permissive)$"]{box};\n'
            ");out body;>;out body qt;")


def _eligible(tags: dict) -> bool:
    hw = tags.get("highway", "")
    walk = tags.get("sidewalk") in {"yes", "both", "left", "right"} or tags.get("foot") in {"yes", "designated", "permissive"}
    if hw not in BASIC and not (hw in {"primary", "secondary"} and walk):
        return False
    for key, ok in (("access", {"yes", "permissive"}), ("foot", {"yes", "designated", "permissive"}), ("access:foot", {"yes", "designated", "permissive"})):
        if key in tags and tags[key] not in ok:
            return False
    if "access:conditional" in tags or "foot:conditional" in tags or tags.get("motorroad") == "yes":
        return False
    if tags.get("service") in {"driveway", "parking_aisle", "drive-through"}:
        return False
    if tags.get("oneway:foot") and tags["oneway:foot"] not in {"no", "yes", "true", "false", "1", "0", "-1"}:
        return False
    return True


ELIGIBILITY_KEYS = {"highway", "access", "foot", "access:foot", "sidewalk", "service", "motorroad",
                    "oneway:foot", "access:conditional", "foot:conditional"}
MAX_TAGS, MAX_KEY_LEN, MAX_VALUE_LEN = 200, 100, 1000
_INT_KEY = re.compile(r"[0-9]+")


def _clean_tags(tags: dict) -> dict | None:
    """Apply the browser tag limits deterministically. None means an eligibility tag breaks them."""
    kept: dict = {}
    for key, value in tags.items():
        if not isinstance(key, str) or not isinstance(value, str):
            if key in ELIGIBILITY_KEYS:
                return None
            continue
        if len(key) > MAX_KEY_LEN or len(value) > MAX_VALUE_LEN:
            if key in ELIGIBILITY_KEYS:
                return None
            continue
        if _INT_KEY.fullmatch(key):  # JS objects reorder integer-like keys, breaking the hash
            continue
        kept[key] = value
    if len(kept) > MAX_TAGS:
        keep = {k for k in kept if k in ELIGIBILITY_KEYS}
        for k in kept:
            if len(keep) >= MAX_TAGS:
                break
            keep.add(k)
        kept = {k: v for k, v in kept.items() if k in keep}
    return kept


def _num(x):
    """Whole-number floats become ints so JSON.stringify(JSON.parse(x)) reproduces the same bytes."""
    return int(x) if isinstance(x, float) and x.is_integer() else x


def _haversine(a, b) -> float:
    r = math.pi / 180
    h = math.sin((b[0] - a[0]) * r / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin((b[1] - a[1]) * r / 2) ** 2
    return 2 * 6_371_008.8 * math.asin(min(1.0, math.sqrt(h)))


def build_tile_graph(tile_id: str, overpass: dict, raw_bytes: bytes, retrieved_at: datetime) -> dict:
    row, col = parse_tile_id(tile_id)
    s, w, n, e = tile_bounds(row, col)
    bounds = [round(s - BUFFER_DEG, 6), round(w - BUFFER_DEG, 6), round(n + BUFFER_DEG, 6), round(e + BUFFER_DEG, 6)]
    inside = lambda lat, lng: bounds[0] <= lat <= bounds[2] and bounds[1] <= lng <= bounds[3]
    elements = overpass.get("elements") or []
    coords = {el["id"]: (_num(el["lat"]), _num(el["lon"]), _clean_tags(el.get("tags") or {}) or {}) for el in elements
              if el.get("type") == "node" and isinstance(el.get("lat"), (int, float)) and inside(el["lat"], el["lon"])}
    if len(coords) > MAX_NODES * 3:
        raise TileTooDense(tile_id)
    ways, node_index, nodes, edges, seen = [], {}, [], [], set()
    for el in elements:
        if el.get("type") != "way":
            continue
        tags = _clean_tags(el.get("tags") or {})
        if tags is None or not _eligible(tags):
            continue
        foot = tags.get("oneway:foot")
        code = 1 if foot in {"yes", "true", "1"} else 2 if foot == "-1" else None
        way_index = len(ways)
        added = False
        refs = el.get("nodes") or []
        for a, b in zip(refs, refs[1:]):
            if a not in coords or b not in coords or a == b:
                continue
            d = _haversine(coords[a][:2], coords[b][:2])
            if not (0 < d <= MAX_SEGMENT_M):
                continue
            for ref in (a, b):
                if ref not in node_index:
                    node_index[ref] = len(nodes)
                    lat, lng, ntags = coords[ref]
                    nodes.append([ref, lat, lng, ntags] if ntags else [ref, lat, lng])
            key = (node_index[a], node_index[b], way_index, code)
            if key in seen:
                continue
            seen.add(key)
            edges.append([node_index[a], node_index[b], way_index] + ([code] if code else []))
            added = True
        if added:
            ways.append([el["id"], tags])
        if len(nodes) > MAX_NODES or len(ways) > MAX_WAYS or len(edges) > MAX_EDGES:
            raise TileTooDense(tile_id)
    query = overpass_query((s, w, n, e))
    body = {
        "schema_version": 2, "pack_id": f"osm-tile-{tile_id}-v1", "role": "ROAD_REFERENCE_ONLY",
        "movement_authorized": False, "built_at": retrieved_at.isoformat(), "bounds": [_num(v) for v in bounds],
        "capacity": [MAX_NODES, MAX_EDGES], "counts": [len(nodes), len(ways), len(edges)],
        "source": {"name": "OpenStreetMap contributors", "endpoint": ENDPOINT,
                   "copyright_url": "https://www.openstreetmap.org/copyright", "license": "ODbL-1.0",
                   "license_url": "https://opendatacommons.org/licenses/odbl/1-0/",
                   "osm_base_timestamp": (overpass.get("osm3s") or {}).get("timestamp_osm_base"),
                   "retrieved_at": retrieved_at.isoformat(),
                   "raw_sha256": hashlib.sha256(raw_bytes).hexdigest(),
                   "query_sha256": hashlib.sha256(query.encode()).hexdigest()},
        "nodes": nodes, "ways": ways, "edges": edges,
    }
    canonical = _canonical(body)
    if len(canonical) > MAX_BYTES:
        raise TileTooDense(tile_id)
    body["content_sha256"] = hashlib.sha256(canonical).hexdigest()
    return body


def _canonical(body: dict) -> bytes:
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode()


def content_hash_matches(graph: dict) -> bool:
    """True when graph["content_sha256"] matches the canonical form of the graph without that key."""
    if not isinstance(graph, dict) or not isinstance(graph.get("content_sha256"), str):
        return False
    body = {k: v for k, v in graph.items() if k != "content_sha256"}
    return hashlib.sha256(_canonical(body)).hexdigest() == graph["content_sha256"]
