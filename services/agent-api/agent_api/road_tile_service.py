"""Road tile service: Overpass fetch (serialized, throttled), file cache, per-session rate limit.

Output is ROAD_REFERENCE_ONLY data. Upstream failures are never retried and never cached.
"""
from __future__ import annotations
import asyncio, json, os, tempfile, time
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Awaitable, Callable

import httpx

from .road_tiles import ENDPOINT, TileTooDense, build_tile_graph, content_hash_matches, overpass_query, parse_tile_id, tile_bounds

USER_AGENT = "72H-road-reference/1.0 (+https://github.com/jacksin2031/72H)"
CACHE_TTL = timedelta(days=30)
MIN_INTERVAL_S = 2.0
UPSTREAM_TIMEOUT_S = 12
LOCK_WAIT_S = 16.0
TOTAL_BUDGET_S = 30.0  # lock wait + spacing + fetch; must stay under the web proxy's 35 s abort
MAX_WAITERS = 8
MAX_SESSIONS = 2048
GLOBAL_PER_MINUTE = 120

__all__ = ["RoadTileService", "TileUnavailable", "TileRateLimited", "TileTooDense"]


class TileUnavailable(Exception):
    """503. ``reason`` is a short code safe to log: it never carries coordinates or session keys."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class TileRateLimited(Exception):
    """429. ``reason`` is RATE_LIMIT_SESSION or RATE_LIMIT_GLOBAL (never the session key)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


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
        global_per_minute: int = GLOBAL_PER_MINUTE,
        lock_wait_s: float = LOCK_WAIT_S,
        upstream_timeout_s: float = UPSTREAM_TIMEOUT_S,
    ) -> None:
        self._fetch = fetch or _default_fetch
        self._cache_dir = cache_dir if cache_dir is not None else _default_cache_dir()
        self._clock = clock
        self._now = now
        self._limit = per_session_per_minute
        self._min_interval = min_interval_s
        self._global_limit = global_per_minute
        self._lock_wait = lock_wait_s
        self._upstream_timeout = upstream_timeout_s
        self._waiting = 0
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._global_hits: deque[float] = deque()
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
        while self._global_hits and t - self._global_hits[0] >= 60:
            self._global_hits.popleft()
        if len(self._global_hits) >= self._global_limit:
            raise TileRateLimited("RATE_LIMIT_GLOBAL")
        hits = self._hits.pop(session_key, None)
        if hits is None:
            hits = deque()
        while hits and t - hits[0] >= 60:
            hits.popleft()
        self._hits[session_key] = hits  # most recently used goes last
        if len(self._hits) > MAX_SESSIONS:
            self._hits.popitem(last=False)
        if len(hits) >= self._limit:
            raise TileRateLimited("RATE_LIMIT_SESSION")
        hits.append(t)
        self._global_hits.append(t)

    def _read_cache(self, tile_id: str) -> dict | None:
        try:
            graph = json.loads((self._cache_dir / f"{tile_id}.json").read_bytes())
            if (graph["pack_id"] != f"osm-tile-{tile_id}-v1" or graph["role"] != "ROAD_REFERENCE_ONLY"
                    or graph["movement_authorized"] is not False or not content_hash_matches(graph)):
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
        if self._waiting >= MAX_WAITERS:
            raise TileUnavailable("QUEUE_FULL")
        started = self._clock()
        lock = self._upstream_lock()
        self._waiting += 1
        try:
            await asyncio.wait_for(lock.acquire(), self._lock_wait)
        except asyncio.TimeoutError as exc:
            raise TileUnavailable("LOCK_DEADLINE") from exc
        finally:
            self._waiting -= 1
        try:
            cached = self._read_cache(tile_id)  # another request may have filled it while we queued
            if cached is not None:
                return cached
            if self._last_request is not None:
                wait = self._min_interval - (self._clock() - self._last_request)
                if wait > 0:
                    await asyncio.sleep(wait)
            budget = min(self._upstream_timeout, TOTAL_BUDGET_S - (self._clock() - started))
            if budget <= 0:
                raise TileUnavailable("LOCK_DEADLINE")
            try:
                status, raw = await asyncio.wait_for(self._fetch(overpass_query(tile_bounds(row, col))), budget)
            except (asyncio.TimeoutError, httpx.TimeoutException) as exc:  # no retry
                raise TileUnavailable("UPSTREAM_TIMEOUT") from exc
            except Exception as exc:  # network errors: no retry
                raise TileUnavailable("UPSTREAM_ERROR") from exc
            finally:
                self._last_request = self._clock()
        finally:
            lock.release()
        if status != 200:
            raise TileUnavailable(f"UPSTREAM_STATUS_{int(status)}")
        try:
            data = json.loads(raw)
        except ValueError as exc:
            raise TileUnavailable("MALFORMED") from exc
        if not isinstance(data, dict) or not isinstance(data.get("osm3s"), dict):
            raise TileUnavailable("MALFORMED")
        if "remark" in data:
            raise TileUnavailable("REMARK")
        try:
            graph = build_tile_graph(tile_id, data, raw, self._now())
        except TileTooDense:
            raise
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise TileUnavailable("MALFORMED") from exc
        self._write_cache(tile_id, graph)
        return graph
