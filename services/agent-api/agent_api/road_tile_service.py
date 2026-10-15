"""Road tile service: Overpass fetch (serialized, throttled), file cache, per-session rate limit.

Output is ROAD_REFERENCE_ONLY data. Upstream failures are never retried and never cached.
"""
from __future__ import annotations
import asyncio, json, os, tempfile, time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable, Callable

import httpx

from .road_tiles import ENDPOINT, TileTooDense, build_tile_graph, content_hash_matches, overpass_query, parse_tile_id, tile_bounds

USER_AGENT = "72H-road-reference/1.0 (+https://github.com/jacksin2031/72H)"
CACHE_TTL = timedelta(days=30)
MIN_INTERVAL_S = 2.0
UPSTREAM_TIMEOUT_S = 50

__all__ = ["RoadTileService", "TileUnavailable", "TileRateLimited", "TileTooDense"]


class TileUnavailable(Exception):
    pass


class TileRateLimited(Exception):
    pass


async def _default_fetch(query: str) -> tuple[int, bytes]:
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT_S) as client:
        response = await client.post(ENDPOINT, data={"data": query}, headers={"User-Agent": USER_AGENT})
        return response.status_code, response.content


def _default_cache_dir() -> Path:
    return Path(os.environ.get("ROAD_TILE_CACHE_DIR", tempfile.gettempdir())) / "72h-road-tiles"


class RoadTileService:
    def __init__(
        self,
        fetch: Callable[[str], Awaitable[tuple[int, bytes]]] | None = None,
        cache_dir: Path | None = None,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        per_session_per_minute: int = 30,
        min_interval_s: float = MIN_INTERVAL_S,
    ) -> None:
        self._fetch = fetch or _default_fetch
        self._cache_dir = cache_dir if cache_dir is not None else _default_cache_dir()
        self._clock = clock
        self._now = now
        self._limit = per_session_per_minute
        self._min_interval = min_interval_s
        self._hits: dict[str, deque[float]] = {}
        self._last_request: float | None = None
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None

    def _upstream_lock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock, self._lock_loop = asyncio.Lock(), loop
        return self._lock

    def _check_rate(self, session_key: str) -> None:
        t = self._clock()
        hits = self._hits.setdefault(session_key, deque())
        while hits and t - hits[0] >= 60:
            hits.popleft()
        if len(hits) >= self._limit:
            raise TileRateLimited(session_key)
        hits.append(t)
        if len(self._hits) > 1024:  # bound memory: drop sessions with no recent activity
            for key in [k for k, v in self._hits.items() if not v or t - v[-1] >= 60]:
                del self._hits[key]

    def _read_cache(self, tile_id: str) -> dict | None:
        try:
            graph = json.loads((self._cache_dir / f"{tile_id}.json").read_bytes())
            if graph["pack_id"] != f"osm-tile-{tile_id}-v1" or not content_hash_matches(graph):
                return None
            age = self._now() - datetime.fromisoformat(graph["source"]["retrieved_at"])
        except (OSError, ValueError, KeyError, TypeError):
            return None
        return graph if timedelta(0) <= age < CACHE_TTL else None

    def _write_cache(self, tile_id: str, graph: dict) -> None:
        try:
            self._cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = self._cache_dir / f".{tile_id}.{os.getpid()}.tmp"
            tmp.write_text(json.dumps(graph, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, self._cache_dir / f"{tile_id}.json")
        except OSError:
            pass  # cache is best-effort; the response is still valid

    async def get(self, tile_id: str, session_key: str) -> dict:
        row, col = parse_tile_id(tile_id)  # ValueError on invalid ids, before any rate or network work
        self._check_rate(session_key)
        cached = self._read_cache(tile_id)
        if cached is not None:
            return cached
        async with self._upstream_lock():
            cached = self._read_cache(tile_id)  # another request may have filled it while we queued
            if cached is not None:
                return cached
            if self._last_request is not None:
                wait = self._min_interval - (self._clock() - self._last_request)
                if wait > 0:
                    await asyncio.sleep(wait)
            try:
                status, raw = await self._fetch(overpass_query(tile_bounds(row, col)))
            except Exception as exc:  # network errors, timeouts: no retry
                raise TileUnavailable("upstream request failed") from exc
            finally:
                self._last_request = self._clock()
        if status != 200:
            raise TileUnavailable(f"upstream status {status}")
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise TileUnavailable("upstream returned malformed JSON") from exc
        if not isinstance(data, dict) or not isinstance(data.get("osm3s"), dict) or "remark" in data:
            raise TileUnavailable("upstream payload invalid or incomplete")
        try:
            graph = build_tile_graph(tile_id, data, raw, self._now())
        except TileTooDense:
            raise
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise TileUnavailable("upstream payload could not be parsed") from exc
        self._write_cache(tile_id, graph)
        return graph
