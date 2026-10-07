"""Bounded Ekispert route candidate source and strict response normalizer."""

from __future__ import annotations

import asyncio
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from zoneinfo import ZoneInfo
from uuid import uuid4

from seventytwoh_contracts.models import (
    FreshnessStatus,
    GeoJsonLineString,
    LiveSourceStatus,
    RoutePresentation,
    RoutePresentationStatus,
)

from .mobility.ekispert_mcp import (
    EKISPERT_MCP_ENDPOINT,
    EkispertMcpError,
    EkispertMcpProvider,
)

EKISPERT_ROUTE_TOOL = "ekispert_api_search_routes"
EKISPERT_ROUTE_SOURCE_KEY = "ekispert-route-search"
EKISPERT_ROUTE_SOURCE_NAME = "Ekispert public transport route search"
ROUTE_CACHE_SECONDS = 60
ROUTE_MIN_INTERVAL_SECONDS = 2
ROUTE_TTL_SECONDS = 5 * 60
MAX_ROUTE_CACHE_ENTRIES = 256
ROUTE_MAX_TOTAL_CALLS = 100
ROUTE_MAX_CALLS_PER_SESSION = 6
MAX_NORMALIZED_COURSES = 20
MAX_ROUTE_POINTS = 512


@dataclass(frozen=True, slots=True)
class RouteFetchResult:
    status: LiveSourceStatus
    retrieved_at: datetime | None
    next_retry_at: datetime | None
    route: RoutePresentation | None
    detail: str


def build_ekispert_route_arguments(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
    *,
    today: datetime | None = None,
) -> dict[str, object]:
    """Build the fixed provider call; no caller-controlled tool or options."""
    for latitude, longitude, prefix in (
        (origin_latitude, origin_longitude, "origin"),
        (destination_latitude, destination_longitude, "destination"),
    ):
        if not math.isfinite(latitude) or not -90 <= latitude <= 90:
            raise ValueError(f"{prefix} latitude is invalid")
        if not math.isfinite(longitude) or not -180 <= longitude <= 180:
            raise ValueError(f"{prefix} longitude is invalid")
    now = today or datetime.now(ZoneInfo("Asia/Tokyo"))
    local_date = now.astimezone(ZoneInfo("Asia/Tokyo"))
    return {
        "viaList": (
            f"{origin_latitude:.6f},{origin_longitude:.6f},wgs84,500:"
            f"{destination_latitude:.6f},{destination_longitude:.6f},wgs84,500"
        ),
        "date": int(local_date.strftime("%Y%m%d")),
        "answerCount": 1,
        "gcs": "wgs84",
        "searchType": "plain",
    }


def normalize_ekispert_route_result(
    payload: dict[str, object],
    *,
    destination_id: str,
    origin_area_id: str | None,
    checked_at: datetime,
) -> RoutePresentation | None:
    """Normalize one actual MCP/API ResultSet route; never infer road geometry."""
    result_set = _result_set(payload)
    courses = _as_items(result_set.get("Course"))
    if not courses:
        return None
    course = courses[0]
    route_node = course.get("Route")
    if not isinstance(route_node, dict):
        return None
    points = _as_items(route_node.get("Point"))
    coordinates: list[tuple[float, float]] = []
    waypoints: list[str] = []
    for point in points[:MAX_ROUTE_POINTS]:
        station_name = _nested_text(point, "Station", "Name") or _clean_text(point.get("Name"))
        if station_name and station_name not in waypoints and len(waypoints) < 64:
            waypoints.append(station_name)
        geo = point.get("GeoPoint")
        if not isinstance(geo, dict):
            continue
        longitude = _number(geo.get("longi_d", geo.get("longitude", geo.get("lon"))))
        latitude = _number(geo.get("lati_d", geo.get("latitude", geo.get("lat"))))
        if longitude is None or latitude is None:
            continue
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            continue
        coordinate = (longitude, latitude)
        if not coordinates or coordinates[-1] != coordinate:
            coordinates.append(coordinate)
    if len(coordinates) > MAX_ROUTE_POINTS:
        coordinates = coordinates[:MAX_ROUTE_POINTS]

    checked = checked_at.astimezone(timezone.utc)
    reference = _clean_text(route_node.get("Name")) or _clean_text(course.get("Name")) or "course-1"
    provider_reference = re.sub(r"[^A-Za-z0-9_.:-]", "", reference)[:96] or "course-1"
    geometry = GeoJsonLineString(coordinates=tuple(coordinates)) if len(coordinates) >= 2 else None
    return RoutePresentation(
        id=f"route-{uuid4().hex}",
        status=RoutePresentationStatus.CANDIDATE,
        geometry=geometry,
        geometry_kind="TRANSIT_STATION_SEQUENCE" if geometry is not None else "NONE",
        presentation_label=(
            "Ekispert public-transit candidate; station sequence only, not a walking road route or safety assessment."
        ),
        waypoints=tuple(waypoints),
        origin_area_id=origin_area_id,
        destination_id=destination_id,
        provider="Ekispert MCP",
        provider_reference=provider_reference,
        checked_at=checked,
        expires_at=checked + timedelta(seconds=ROUTE_TTL_SECONDS),
        evidence_ids=(),
        freshness_status=FreshnessStatus.CURRENT,
        conflict=False,
    )


class EkispertRouteSource:
    """Process-wide bounded request/circuit policy for the paid mobility API."""

    def __init__(
        self,
        provider: EkispertMcpProvider | None = None,
        *,
        now=None,
        clock=monotonic,
        max_total_calls: int = ROUTE_MAX_TOTAL_CALLS,
        max_calls_per_session: int = ROUTE_MAX_CALLS_PER_SESSION,
    ) -> None:
        if max_total_calls < 1 or max_calls_per_session < 1:
            raise ValueError("route call budgets must be positive")
        self._provider = provider or EkispertMcpProvider()
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._clock = clock
        self._lock = asyncio.Lock()
        self._last_attempt = float("-inf")
        self._next_retry_monotonic = 0.0
        self._next_retry_at: datetime | None = None
        self._failures = 0
        self._cache: dict[str, tuple[float, RouteFetchResult]] = {}
        self._max_total_calls = max_total_calls
        self._max_calls_per_session = max_calls_per_session
        self._total_calls = 0
        self._session_calls: dict[str, int] = {}

    async def search(
        self,
        *,
        latitude: float,
        longitude: float,
        destination_latitude: float,
        destination_longitude: float,
        destination_id: str,
        origin_area_id: str | None,
        session_id: str = "anonymous",
    ) -> RouteFetchResult:
        try:
            arguments = build_ekispert_route_arguments(
                latitude,
                longitude,
                destination_latitude,
                destination_longitude,
                today=self._now(),
            )
        except ValueError:
            return RouteFetchResult(
                LiveSourceStatus.INVALID_RESPONSE, None, None, None,
                "Route origin or destination address is invalid.",
            )
        cache_key = json.dumps(
            {
                "arguments": arguments,
                "destination_id": destination_id,
                "origin_area_id": origin_area_id,
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        async with self._lock:
            mono_now = self._clock()
            for expired_key, (created_at, _) in tuple(self._cache.items()):
                if mono_now - created_at >= ROUTE_CACHE_SECONDS:
                    self._cache.pop(expired_key, None)
            cache_entry = self._cache.get(cache_key)
            cached = cache_entry[1] if cache_entry is not None else None
            if cache_entry is not None and mono_now - cache_entry[0] < ROUTE_CACHE_SECONDS:
                return cached
            session_calls = self._session_calls.get(session_id, 0)
            if session_calls >= self._max_calls_per_session:
                return RouteFetchResult(
                    LiveSourceStatus.UNAVAILABLE,
                    None,
                    None,
                    None,
                    "Ekispert actual-call budget exhausted for this live session; no provider call was made.",
                )
            if self._total_calls >= self._max_total_calls:
                return RouteFetchResult(
                    LiveSourceStatus.UNAVAILABLE,
                    None,
                    None,
                    None,
                    "Ekispert process actual-call budget exhausted; no provider call was made.",
                )
            if mono_now < self._next_retry_monotonic:
                return RouteFetchResult(
                    LiveSourceStatus.CIRCUIT_OPEN if self._failures >= 5 else LiveSourceStatus.BACKOFF,
                    cached.retrieved_at if cached else None,
                    self._next_retry_at,
                    cached.route if cached else None,
                    "Ekispert request is in bounded failure backoff.",
                )
            remaining = ROUTE_MIN_INTERVAL_SECONDS - (mono_now - self._last_attempt)
            if remaining > 0:
                await asyncio.sleep(remaining)
                mono_now = self._clock()
            self._last_attempt = mono_now
            self._total_calls += 1
            self._session_calls[session_id] = session_calls + 1
            try:
                payload = await self._provider.call_tool(EKISPERT_ROUTE_TOOL, arguments)
                retrieved = self._now()
                route = normalize_ekispert_route_result(
                    payload,
                    destination_id=destination_id,
                    origin_area_id=origin_area_id,
                    checked_at=retrieved,
                )
                if route is None:
                    result = RouteFetchResult(
                        LiveSourceStatus.UNSUPPORTED, retrieved, None, None,
                        "Ekispert returned no normalizable route candidate.",
                    )
                else:
                    result = RouteFetchResult(
                        LiveSourceStatus.FRESH, retrieved, None, route,
                        "Ekispert route is public-transit provider data only; it is not route-safety evidence.",
                    )
                self._cache[cache_key] = (self._clock(), result)
                while len(self._cache) > MAX_ROUTE_CACHE_ENTRIES:
                    oldest = min(self._cache, key=lambda item: self._cache[item][0])
                    self._cache.pop(oldest, None)
                self._failures = 0
                self._next_retry_monotonic = 0.0
                self._next_retry_at = None
                return result
            except EkispertMcpError as error:
                self._failures += 1
                delay = min(5 * (2 ** min(self._failures - 1, 6)), 300)
                if self._failures >= 5:
                    delay = 300
                self._next_retry_monotonic = self._clock() + delay
                self._next_retry_at = self._now() + timedelta(seconds=delay)
                return RouteFetchResult(
                    LiveSourceStatus.CIRCUIT_OPEN if self._failures >= 5 else LiveSourceStatus.BACKOFF,
                    None,
                    self._next_retry_at,
                    None,
                    f"Ekispert route request failed ({error.reason_code}); no route safety was inferred.",
                )

    def release_session(self, session_id: str) -> None:
        """Release only the per-session counter; process lifetime cap stays fixed."""
        self._session_calls.pop(session_id, None)


def _result_set(payload: dict[str, object]) -> dict[str, object]:
    structured = payload.get("structuredContent")
    if isinstance(structured, dict):
        found = _find_result_set(structured)
        if found is not None:
            return found
    content = payload.get("content")
    if isinstance(content, list):
        for item in content[:8]:
            if not isinstance(item, dict) or not isinstance(item.get("text"), str):
                continue
            text = item["text"]
            if len(text) > 256_000:
                continue
            try:
                parsed = json.loads(text)
            except (ValueError, TypeError):
                continue
            if isinstance(parsed, dict):
                found = _find_result_set(parsed)
                if found is not None:
                    return found
    found = _find_result_set(payload)
    return found or {}


def _find_result_set(node: dict[str, object]) -> dict[str, object] | None:
    direct = node.get("ResultSet")
    if isinstance(direct, dict):
        return direct
    # MCP adapters can wrap the standard API object one level deep.
    for key in ("result", "data", "structuredContent"):
        child = node.get(key)
        if isinstance(child, dict):
            found = _find_result_set(child)
            if found is not None:
                return found
    if "Course" in node:
        return node
    return None


def _as_items(value: object) -> list[dict[str, object]]:
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for item in value[:MAX_NORMALIZED_COURSES] if isinstance(item, dict)]
    return []


def _nested_text(value: dict[str, object], parent: str, child: str) -> str | None:
    nested = value.get(parent)
    if isinstance(nested, dict):
        return _clean_text(nested.get(child))
    return None


def _clean_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = "".join(ch for ch in value.strip() if ord(ch) >= 0x20 and ord(ch) != 0x7F)
    return cleaned[:240] or None


def _number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None
