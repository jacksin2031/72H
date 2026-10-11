"""Bounded adapters for official live source documents.

Provider bytes are parsed into small typed values here; no caller input can
choose source URLs, trust level, publication time, or area authorization.
"""

from __future__ import annotations

import csv
import io
import math
import re
import threading
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Callable, Mapping
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
from hashlib import sha256

import httpx

from .official_events import (
    BulletinOperation, OfficialBulletin, OfficialEventState, reduce_official_bulletin,
)

from seventytwoh_contracts.models import (
    Coordinate,
    DestinationDesignationRole,
    DestinationHazardDesignation,
    DestinationHazardDesignationStatus,
    DestinationHazardType,
    DestinationRecord,
    DestinationOpenStatus,
    DisasterEventType,
    LiveSourceStatus,
    TsunamiAreaStatus,
    TsunamiHeightExpression,
    TsunamiMaxHeight,
    TsunamiOperation,
    TsunamiReferenceForecastArea,
    TsunamiReferenceResponse,
    TsunamiReferenceSource,
    TsunamiReferenceStatus,
    TsunamiSourceFreshness,
    TsunamiWarningClass,
)

JMA_FEED_URL = "https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml"
JMA_SOURCE_KEY = "jma-live-eqvol"
JMA_SOURCE_NAME = "Japan Meteorological Agency (earthquake reports)"
JMA_DETAIL_PREFIX = "https://www.data.jma.go.jp/developer/xml/data/"
JMA_DETAIL_MAX_BYTES = 2_000_000
JMA_FEED_MAX_BYTES = 512_000
JMA_DETAIL_LIMIT = 5
JMA_POLL_INTERVAL_SECONDS = 60
JMA_EVIDENCE_TTL_SECONDS = 15 * 60
JMA_TSUNAMI_SOURCE_ID = "jma-bosai-xml"
JMA_TSUNAMI_SOURCE_NAME = "Japan Meteorological Agency (tsunami warnings)"
JMA_TSUNAMI_PRODUCT_CODE = "VTSE41"
JMA_TSUNAMI_SOURCE_KEY = "jma-live-tsunami"
JMA_TSUNAMI_DETAIL_LIMIT = 5
JMA_TSUNAMI_MAX_BULLETINS = 64
GSI_CSV_MAX_BYTES = 5_000_000
GSI_CSV_MAX_ROWS = 20_000
GSI_CSV_OUTPUT_LIMIT = 512
GSI_SOURCE_KEY = "gsi-shelter-designations"
GSI_SOURCE_NAME = "Geospatial Information Authority of Japan evacuation facility catalog"
GSI_ALLOWED_HOSTS = {"www.gsi.go.jp", "web1.gsi.go.jp", "hinanmap.gsi.go.jp"}

GSI_HAZARD_COLUMNS: tuple[tuple[DestinationHazardType, str], ...] = (
    (DestinationHazardType.FLOOD, "洪水"),
    (DestinationHazardType.LANDSLIDE, "崖崩れ、土石流及び地滑り"),
    (DestinationHazardType.STORM_SURGE, "高潮"),
    (DestinationHazardType.EARTHQUAKE, "地震"),
    (DestinationHazardType.TSUNAMI, "津波"),
    (DestinationHazardType.LARGE_FIRE, "大規模な火事"),
    (DestinationHazardType.INLAND_FLOOD, "内水氾濫"),
    (DestinationHazardType.VOLCANIC, "火山現象"),
)

TOKYO_SHELTER_URL = "https://www.opendata.metro.tokyo.lg.jp/soumu/130001_evacuation_area.csv"
TOKYO_SHELTER_SOURCE_KEY = "tokyo-evacuation-designations"
TOKYO_SHELTER_SOURCE_NAME = "Tokyo Metropolitan Government Emergency Map"
TOKYO_SHELTER_PUBLISHED_AT = datetime(2021, 4, 1, tzinfo=timezone(timedelta(hours=9)))
TOKYO_SHELTER_MAX_BYTES = 3_000_000
TOKYO_SHELTER_MAX_ROWS = 20_000

# JMA XML prefecture codes (01..47) are normalized only by this catalog.
JMA_PREFECTURES: dict[str, str] = {
    "01": "北海道", "02": "青森県", "03": "岩手県", "04": "宮城県", "05": "秋田県",
    "06": "山形県", "07": "福島県", "08": "茨城県", "09": "栃木県", "10": "群馬県",
    "11": "埼玉県", "12": "千葉県", "13": "東京都", "14": "神奈川県", "15": "新潟県",
    "16": "富山県", "17": "石川県", "18": "福井県", "19": "山梨県", "20": "長野県",
    "21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県", "25": "滋賀県",
    "26": "京都府", "27": "大阪府", "28": "兵庫県", "29": "奈良県", "30": "和歌山県",
    "31": "鳥取県", "32": "島根県", "33": "岡山県", "34": "広島県", "35": "山口県",
    "36": "徳島県", "37": "香川県", "38": "愛媛県", "39": "高知県", "40": "福岡県",
    "41": "佐賀県", "42": "長崎県", "43": "熊本県", "44": "大分県", "45": "宮崎県",
    "46": "鹿児島県", "47": "沖縄県",
}


@dataclass(frozen=True, slots=True)
class JmaPrefObservation:
    code: str | None
    name: str
    max_intensity: str | None

    @property
    def area_id(self) -> str | None:
        return f"JP-{self.code}" if self.code in JMA_PREFECTURES else None


@dataclass(frozen=True, slots=True)
class JmaEarthquakeReport:
    report_id: str
    title: str
    published_at: datetime
    occurred_at: datetime | None
    reference_url: str
    observations: tuple[JmaPrefObservation, ...]
    bulletin: OfficialBulletin | None = None
    withdrawn_observations: tuple[JmaPrefObservation, ...] = ()


@dataclass(frozen=True, slots=True)
class JmaFetchResult:
    status: LiveSourceStatus
    retrieved_at: datetime | None
    last_published_at: datetime | None
    next_retry_at: datetime | None
    reports: tuple[JmaEarthquakeReport, ...]
    detail: str


@dataclass(frozen=True, slots=True)
class JmaTsunamiArea:
    code: str
    name: str
    status: TsunamiAreaStatus
    warning_class: TsunamiWarningClass
    max_height: TsunamiMaxHeight
    arrival_at: datetime | None


@dataclass(frozen=True, slots=True)
class JmaTsunamiBulletin:
    event_id: str
    serial: str | None
    info_type: str
    operation: TsunamiOperation
    published_at: datetime
    occurred_at: datetime | None
    reference_url: str
    forecast_areas: tuple[JmaTsunamiArea, ...]
    bulletin: OfficialBulletin | None = None


@dataclass(frozen=True, slots=True)
class JmaTsunamiFetchResult:
    status: LiveSourceStatus
    retrieved_at: datetime | None
    last_published_at: datetime | None
    next_retry_at: datetime | None
    operation: TsunamiOperation
    serial: str | None
    bulletins: tuple[JmaTsunamiBulletin, ...]
    forecast_areas: tuple[TsunamiReferenceForecastArea, ...]
    conflict: bool
    detail: str


def jma_status_at_publication_deadline(
    status: LiveSourceStatus,
    last_published_at: datetime | None,
    now: datetime,
) -> LiveSourceStatus:
    """Do not let a recent retrieval or cached 304 renew publication freshness."""
    if (
        status == LiveSourceStatus.FRESH
        and last_published_at is not None
        and now >= last_published_at + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
    ):
        return LiveSourceStatus.STALE
    return status


@dataclass(frozen=True, slots=True)
class HttpPayload:
    status_code: int
    content: bytes
    headers: dict[str, str]


def _http_get(url: str, headers: dict[str, str]) -> HttpPayload:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in {
        "www.data.jma.go.jp",
        "www.opendata.metro.tokyo.lg.jp",
        "opendata.metro.tokyo.lg.jp",
    }:
        raise ValueError("source host not allowlisted")
    if parsed.netloc == "www.data.jma.go.jp":
        limit = JMA_FEED_MAX_BYTES if parsed.path.endswith("/feed/eqvol.xml") else JMA_DETAIL_MAX_BYTES
    else:
        limit = TOKYO_SHELTER_MAX_BYTES
    chunks: list[bytes] = []
    size = 0
    with httpx.Client(timeout=httpx.Timeout(4.0, connect=2.0), follow_redirects=False) as client:
        with client.stream("GET", url, headers=headers) as response:
            if response.status_code not in {200, 304}:
                raise httpx.HTTPStatusError("official source returned non-success", request=response.request, response=response)
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > limit:
                    raise ValueError("official source response exceeded the bounded size")
                chunks.append(chunk)
            return HttpPayload(response.status_code, b"".join(chunks), dict(response.headers))


class JmaEarthquakeSource:
    """One process-wide poller: serialized requests and >=60s feed cadence."""

    def __init__(
        self,
        fetch: Callable[[str, dict[str, str]], HttpPayload] = _http_get,
        *,
        now: Callable[[], datetime] | None = None,
        clock: Callable[[], float] = monotonic,
        poll_interval: int = JMA_POLL_INTERVAL_SECONDS,
        detail_limit: int = JMA_DETAIL_LIMIT,
    ) -> None:
        if not 60 <= poll_interval <= 3600:
            raise ValueError("JMA poll interval must be between 60 seconds and one hour")
        if not 1 <= detail_limit <= JMA_DETAIL_LIMIT:
            raise ValueError("JMA detail limit must be between 1 and 5")
        self._fetch = fetch
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._clock = clock
        self._poll_interval = poll_interval
        self._detail_limit = detail_limit
        self._lock = threading.RLock()
        self._last_attempt = float("-inf")
        self._etag: str | None = None
        self._last_modified: str | None = None
        self._cached: JmaFetchResult | None = None
        self._reports: tuple[JmaEarthquakeReport, ...] = ()
        self._lifecycle: dict[str, OfficialEventState] = {}
        self._snapshot_metadata: dict[str, OfficialBulletin] = {}
        self._snapshot_last_attempt = float("-inf")
        self._by_group: dict[str, JmaEarthquakeReport] = {}
        self._failures = 0
        self._next_retry_monotonic = 0.0
        self._next_retry_at: datetime | None = None

    def fetch_snapshot_metadata(self, references: tuple[str, ...]) -> dict[str, OfficialBulletin]:
        return _snapshot_metadata_from_source(self, references, _parse_jma_detail)

    def fetch_latest(self, *, force: bool = False) -> JmaFetchResult:
        with self._lock:
            mono_now = self._clock()
            if mono_now < self._next_retry_monotonic:
                return self._with_failure_status(LiveSourceStatus.CIRCUIT_OPEN if self._failures >= 5 else LiveSourceStatus.BACKOFF)
            if self._cached is not None and not force and mono_now - self._last_attempt < self._poll_interval:
                if jma_status_at_publication_deadline(
                    self._cached.status,
                    self._cached.last_published_at,
                    self._now(),
                ) == LiveSourceStatus.STALE and self._cached.status == LiveSourceStatus.FRESH:
                    self._cached = JmaFetchResult(
                        status=LiveSourceStatus.STALE,
                        retrieved_at=self._cached.retrieved_at,
                        last_published_at=self._cached.last_published_at,
                        next_retry_at=self._cached.next_retry_at,
                        reports=self._cached.reports,
                        detail="JMA cached publication reached its freshness deadline; original timestamps were retained.",
                    )
                return self._cached

            self._last_attempt = mono_now
            try:
                headers = {"Accept": "application/atom+xml, application/xml"}
                if self._etag:
                    headers["If-None-Match"] = self._etag
                if self._last_modified:
                    headers["If-Modified-Since"] = self._last_modified
                feed = self._fetch(JMA_FEED_URL, headers)
                if feed.status_code == 304:
                    if self._cached is None:
                        raise ValueError("JMA returned 304 without a cached representation")
                    retrieved = self._now()
                    status = (
                        LiveSourceStatus.INVALID_RESPONSE
                        if any(item.conflict for item in self._lifecycle.values())
                        else _report_freshness(self._reports, retrieved)
                    )
                    self._failures = 0
                    self._next_retry_monotonic = 0.0
                    self._next_retry_at = None
                    self._cached = JmaFetchResult(
                        status=status,
                        retrieved_at=retrieved,
                        last_published_at=self._cached.last_published_at,
                        next_retry_at=None,
                        reports=self._reports,
                        detail="JMA feed returned 304; original publication times were retained.",
                    )
                    return self._cached
                if feed.status_code != 200 or len(feed.content) > JMA_FEED_MAX_BYTES:
                    raise ValueError("JMA feed status or size is invalid")
                reports, feed_etag, feed_modified = self._parse_feed(feed.content)
                normalized: list[JmaEarthquakeReport] = []
                for url, _feed_updated_at in reports[: self._detail_limit]:
                    detail = self._fetch(url, {"Accept": "application/xml, text/xml"})
                    if detail.status_code != 200 or len(detail.content) > JMA_DETAIL_MAX_BYTES:
                        raise ValueError("JMA detail status or size is invalid")
                    normalized.append(_parse_jma_detail(url, detail.content, self._now()))
                retrieved = self._now()
                # Prepare an atomic batch: a malformed detail or capacity failure
                # must not partially advance the source's information units.
                lifecycle = dict(self._lifecycle)
                by_group = dict(self._by_group)
                for incoming in sorted(normalized, key=lambda item: item.published_at):
                    assert incoming.bulletin is not None
                    group = incoming.bulletin.group_id
                    prior = lifecycle.get(group)
                    reduced = reduce_official_bulletin(prior, incoming.bulletin)
                    lifecycle[group] = reduced
                    if prior is not None and reduced.head.raw_sha256 == prior.head.raw_sha256:
                        continue
                    previous = by_group.get(group)
                    withdrawn = tuple(dict.fromkeys(
                        (*(previous.observations if previous else ()),
                         *(previous.withdrawn_observations if previous else ()))
                    ))
                    if incoming.bulletin.operation == BulletinOperation.CANCEL:
                        incoming = replace(incoming, occurred_at=incoming.occurred_at or (previous.occurred_at if previous else None))
                    by_group[group] = replace(incoming, withdrawn_observations=withdrawn)
                if len(lifecycle) > 64:
                    raise ValueError("JMA information-unit capacity reached; reconciliation required")
                self._lifecycle, self._by_group = lifecycle, by_group
                self._reports = tuple(sorted(by_group.values(), key=lambda item: item.published_at))
                self._etag = feed.headers.get("etag") or feed_etag or self._etag
                self._last_modified = feed.headers.get("last-modified") or feed_modified or self._last_modified
                self._failures = 0
                self._next_retry_monotonic = 0.0
                self._next_retry_at = None
                last_published = max((item.published_at for item in self._reports), default=None)
                if any(item.conflict for item in lifecycle.values()):
                    source_status = LiveSourceStatus.INVALID_RESPONSE
                    detail_text = "Conflicting JMA bulletins have the same Control.DateTime; prior evidence cannot authorize actions."
                elif not self._reports:
                    source_status = LiveSourceStatus.UNSUPPORTED
                    detail_text = "JMA feed has no supported earthquake intensity reports in the bounded window."
                else:
                    source_status = _report_freshness(self._reports, retrieved)
                    detail_text = "JMA earthquake detail reports parsed from the official feed."
                self._cached = JmaFetchResult(
                    status=source_status,
                    retrieved_at=retrieved,
                    last_published_at=last_published,
                    next_retry_at=None,
                    reports=self._reports,
                    detail=detail_text,
                )
                return self._cached
            except (httpx.HTTPError, OSError, ValueError, ET.ParseError, UnicodeError):
                self._failures += 1
                delay = min(5 * (2 ** min(self._failures - 1, 6)), 300)
                if self._failures >= 5:
                    delay = 300
                self._next_retry_monotonic = mono_now + delay
                self._next_retry_at = self._now() + timedelta(seconds=delay)
                return self._with_failure_status(
                    LiveSourceStatus.CIRCUIT_OPEN if self._failures >= 5 else LiveSourceStatus.BACKOFF
                )

    def _with_failure_status(self, status: LiveSourceStatus) -> JmaFetchResult:
        old = self._cached
        return JmaFetchResult(
            status=status,
            retrieved_at=old.retrieved_at if old else None,
            last_published_at=old.last_published_at if old else None,
            next_retry_at=self._next_retry_at,
            reports=self._reports,
            detail=f"JMA source request failed; prior publication timestamps remain unchanged ({status.value}).",
        )

    def _parse_feed(self, body: bytes) -> tuple[list[tuple[str, datetime]], str | None, str | None]:
        _validate_xml_size(body, JMA_FEED_MAX_BYTES)
        root = ET.fromstring(body)
        entries: list[tuple[str, datetime]] = []
        for entry in root.iter():
            if _local_name(entry.tag) != "entry":
                continue
            title = _child_text(entry, "title")
            if title != "震源・震度に関する情報":
                continue
            updated_text = _child_text(entry, "updated")
            if not updated_text:
                continue
            published = _parse_datetime(updated_text)
            link = next(
                (node.attrib.get("href") for node in entry if _local_name(node.tag) == "link" and node.attrib.get("type") == "application/xml"),
                None,
            )
            if not link:
                continue
            parsed = urlparse(link)
            if parsed.scheme != "https" or parsed.netloc != "www.data.jma.go.jp" or not parsed.path.startswith("/developer/xml/data/"):
                continue
            entries.append((link, published))
        if len(entries) > 128:
            raise ValueError("JMA feed has too many entries")
        return sorted(entries, key=lambda item: item[1], reverse=True), None, None


class JmaTsunamiSource:
    """Bounded JMA VTSE41 poller with event-scoped update and cancellation state."""

    def __init__(
        self,
        fetch: Callable[[str, dict[str, str]], HttpPayload] = _http_get,
        *,
        now: Callable[[], datetime] | None = None,
        clock: Callable[[], float] = monotonic,
        poll_interval: int = JMA_POLL_INTERVAL_SECONDS,
        detail_limit: int = JMA_TSUNAMI_DETAIL_LIMIT,
    ) -> None:
        if not 60 <= poll_interval <= 3600:
            raise ValueError("JMA tsunami poll interval must be between 60 seconds and one hour")
        if not 1 <= detail_limit <= JMA_TSUNAMI_DETAIL_LIMIT:
            raise ValueError("JMA tsunami detail limit must be between 1 and 5")
        self._fetch = fetch
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._clock = clock
        self._poll_interval = poll_interval
        self._detail_limit = detail_limit
        self._lock = threading.RLock()
        self._last_attempt = float("-inf")
        self._etag: str | None = None
        self._last_modified: str | None = None
        self._bulletins: dict[str, JmaTsunamiBulletin] = {}
        self._lifecycle: dict[str, OfficialEventState] = {}
        self._snapshot_metadata: dict[str, OfficialBulletin] = {}
        self._snapshot_last_attempt = float("-inf")
        self._cached: JmaTsunamiFetchResult | None = None
        self._failures = 0
        self._next_retry_monotonic = 0.0
        self._next_retry_at: datetime | None = None

    def fetch_snapshot_metadata(self, references: tuple[str, ...]) -> dict[str, OfficialBulletin]:
        return _snapshot_metadata_from_source(self, references, _parse_jma_tsunami_detail)

    def fetch_latest(self, *, force: bool = False) -> JmaTsunamiFetchResult:
        with self._lock:
            mono_now = self._clock()
            if mono_now < self._next_retry_monotonic:
                return self._with_failure_status(
                    LiveSourceStatus.CIRCUIT_OPEN if self._failures >= 5 else LiveSourceStatus.BACKOFF
                )
            if self._cached is not None and not force and mono_now - self._last_attempt < self._poll_interval:
                return self._project_freshness(self._cached, self._now())

            self._last_attempt = mono_now
            try:
                headers = {"Accept": "application/atom+xml, application/xml"}
                if self._etag:
                    headers["If-None-Match"] = self._etag
                if self._last_modified:
                    headers["If-Modified-Since"] = self._last_modified
                feed = self._fetch(JMA_FEED_URL, headers)
                retrieved = self._now()
                if feed.status_code == 304:
                    if self._cached is None:
                        raise ValueError("JMA returned 304 without a cached tsunami feed representation")
                    self._failures = 0
                    self._next_retry_monotonic = 0.0
                    self._next_retry_at = None
                    return self._cache_result(
                        retrieved,
                        "JMA tsunami feed returned 304; original publication timestamps were retained.",
                    )
                if feed.status_code != 200 or len(feed.content) > JMA_FEED_MAX_BYTES:
                    raise ValueError("JMA tsunami feed status or size is invalid")
                entries = _parse_jma_tsunami_feed(feed.content)
                fetched: list[JmaTsunamiBulletin] = []
                # Feed entries are sorted oldest first so updates and cancels
                # are applied after the original bulletin when both are present.
                for url, _feed_updated_at in entries[-self._detail_limit :]:
                    detail = self._fetch(url, {"Accept": "application/xml, text/xml"})
                    if detail.status_code != 200 or len(detail.content) > JMA_DETAIL_MAX_BYTES:
                        raise ValueError("JMA tsunami detail status or size is invalid")
                    fetched.append(_parse_jma_tsunami_detail(url, detail.content, retrieved))

                lifecycle = dict(self._lifecycle)
                bulletins = dict(self._bulletins)
                for incoming in sorted(fetched, key=lambda item: item.published_at):
                    assert incoming.bulletin is not None
                    group = incoming.bulletin.group_id
                    prior = lifecycle.get(group)
                    reduced = reduce_official_bulletin(prior, incoming.bulletin)
                    lifecycle[group] = reduced
                    if prior is not None and reduced.head.raw_sha256 == prior.head.raw_sha256:
                        continue
                    previous = bulletins.get(group)
                    if incoming.info_type == "取消":
                        operation = TsunamiOperation.CANCEL
                        areas = tuple(
                            JmaTsunamiArea(
                                code=area.code,
                                name=area.name,
                                status=TsunamiAreaStatus.UNKNOWN,
                                warning_class=TsunamiWarningClass.UNKNOWN,
                                max_height=TsunamiMaxHeight(),
                                arrival_at=None,
                            )
                            for area in (previous.forecast_areas if previous else incoming.forecast_areas)
                        )
                        occurred = previous.occurred_at if previous else incoming.occurred_at
                    else:
                        operation = TsunamiOperation.UPDATE if previous else TsunamiOperation.ISSUE
                        areas = incoming.forecast_areas
                        occurred = incoming.occurred_at or (previous.occurred_at if previous else None)
                    bulletins[group] = JmaTsunamiBulletin(
                        event_id=incoming.event_id,
                        serial=incoming.serial,
                        info_type=incoming.info_type,
                        operation=operation,
                        published_at=incoming.published_at,
                        occurred_at=occurred,
                        reference_url=incoming.reference_url,
                        forecast_areas=areas,
                        bulletin=incoming.bulletin,
                    )

                if len(bulletins) > JMA_TSUNAMI_MAX_BULLETINS:
                    raise ValueError("JMA information-unit capacity reached; reconciliation required")
                self._lifecycle, self._bulletins = lifecycle, bulletins
                self._etag = feed.headers.get("etag") or self._etag
                self._last_modified = feed.headers.get("last-modified") or self._last_modified
                self._failures = 0
                self._next_retry_monotonic = 0.0
                self._next_retry_at = None
                return self._cache_result(retrieved, "JMA VTSE41 tsunami bulletins parsed from the official XML feed.")
            except (httpx.HTTPError, OSError, ValueError, ET.ParseError, UnicodeError):
                self._failures += 1
                delay = min(5 * (2 ** min(self._failures - 1, 6)), 300)
                if self._failures >= 5:
                    delay = 300
                self._next_retry_monotonic = mono_now + delay
                self._next_retry_at = self._now() + timedelta(seconds=delay)
                return self._with_failure_status(
                    LiveSourceStatus.CIRCUIT_OPEN if self._failures >= 5 else LiveSourceStatus.BACKOFF
                )

    def _cache_result(self, retrieved_at: datetime, detail: str) -> JmaTsunamiFetchResult:
        bulletins = tuple(sorted(self._bulletins.values(), key=lambda item: item.published_at))
        latest = bulletins[-1] if bulletins else None
        last_published_at = max((item.published_at for item in bulletins), default=None)
        forecast_areas, conflict = _aggregate_tsunami_forecast_areas(bulletins, retrieved_at)
        conflict = conflict or any(item.conflict for item in self._lifecycle.values())
        status = (
            LiveSourceStatus.UNSUPPORTED
            if not bulletins
            else LiveSourceStatus.STALE
            if last_published_at is not None
            and retrieved_at >= last_published_at + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
            else LiveSourceStatus.FRESH
        )
        self._cached = JmaTsunamiFetchResult(
            status=status,
            retrieved_at=retrieved_at,
            last_published_at=last_published_at,
            next_retry_at=None,
            operation=latest.operation if latest else TsunamiOperation.UNKNOWN,
            serial=latest.serial if latest else None,
            bulletins=bulletins,
            forecast_areas=forecast_areas,
            conflict=conflict,
            detail=detail,
        )
        return self._cached

    def _project_freshness(self, result: JmaTsunamiFetchResult, now: datetime) -> JmaTsunamiFetchResult:
        if (
            result.status == LiveSourceStatus.FRESH
            and result.last_published_at is not None
            and now >= result.last_published_at + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
        ):
            areas = tuple(
                area.model_copy(update={"status": TsunamiAreaStatus.UNKNOWN})
                for area in result.forecast_areas
            )
            stale = replace(
                result,
                status=LiveSourceStatus.STALE,
                forecast_areas=areas,
                detail="JMA tsunami publication reached its freshness deadline; original timestamps were retained.",
            )
            self._cached = stale
            return stale
        return result

    def _with_failure_status(self, status: LiveSourceStatus) -> JmaTsunamiFetchResult:
        old = self._cached
        return JmaTsunamiFetchResult(
            status=status,
            retrieved_at=old.retrieved_at if old else None,
            last_published_at=old.last_published_at if old else None,
            next_retry_at=self._next_retry_at,
            operation=old.operation if old else TsunamiOperation.UNKNOWN,
            serial=old.serial if old else None,
            bulletins=old.bulletins if old else (),
            forecast_areas=tuple(
                area.model_copy(update={"status": TsunamiAreaStatus.UNKNOWN})
                for area in (old.forecast_areas if old else ())
            ),
            conflict=False,
            detail=f"JMA tsunami source request failed; prior publication timestamps remain unchanged ({status.value}).",
        )


def _parse_jma_tsunami_feed(body: bytes) -> list[tuple[str, datetime]]:
    _validate_xml_size(body, JMA_FEED_MAX_BYTES)
    root = ET.fromstring(body)
    entries: list[tuple[str, datetime]] = []
    for entry in root.iter():
        if _local_name(entry.tag) != "entry":
            continue
        title = _child_text(entry, "title") or ""
        link = next(
            (
                node.attrib.get("href")
                for node in entry
                if _local_name(node.tag) == "link"
                and node.attrib.get("type") == "application/xml"
            ),
            None,
        )
        if not link or (JMA_TSUNAMI_PRODUCT_CODE not in link and "津波警報" not in title):
            continue
        parsed = urlparse(link)
        if (
            parsed.scheme != "https"
            or parsed.netloc != "www.data.jma.go.jp"
            or not parsed.path.startswith("/developer/xml/data/")
        ):
            raise ValueError("JMA tsunami feed contains a detail URL outside the allowlisted host/path")
        updated_text = _child_text(entry, "updated")
        if not updated_text:
            raise ValueError("JMA tsunami feed entry has no publication timestamp")
        entries.append((link, _parse_datetime(updated_text)))
    if len(entries) > 128:
        raise ValueError("JMA tsunami feed has too many entries")
    return sorted(entries, key=lambda item: item[1])


def _parse_jma_tsunami_detail(
    url: str,
    body: bytes,
    validation_now: datetime | None = None,
) -> JmaTsunamiBulletin:
    _validate_xml_size(body, JMA_DETAIL_MAX_BYTES)
    parsed_url = urlparse(url)
    if (
        parsed_url.scheme != "https"
        or parsed_url.netloc != "www.data.jma.go.jp"
        or not parsed_url.path.startswith("/developer/xml/data/")
    ):
        raise ValueError("JMA tsunami detail URL is outside the allowlisted host/path")
    root = ET.fromstring(body)
    title = _path_text(root, ("Control", "Title")) or ""
    if "津波" not in title or "予報" not in title:
        raise ValueError("JMA detail is not a tsunami warning/forecast bulletin")
    if _path_text(root, ("Control", "Status")) != "通常":
        raise ValueError("JMA tsunami control status is not the usual report state")
    info_type = _path_text(root, ("Head", "InfoType"))
    if info_type not in {"発表", "取消"}:
        raise ValueError("unsupported JMA tsunami InfoType")
    info_kind = _path_text(root, ("Head", "InfoKind"))
    if info_kind != "津波警報・注意報・予報":
        raise ValueError("JMA detail is not VTSE41 tsunami warning/forecast information")
    event_id = _path_text(root, ("Head", "EventID"))
    if not event_id or not re.fullmatch(r"\d{14}(?:\s+\d{14}){0,7}", event_id):
        raise ValueError("JMA tsunami EventID is missing or malformed")
    serial = _path_text(root, ("Head", "Serial"))
    if serial is not None and (len(serial) > 16 or not re.fullmatch(r"[A-Za-z0-9_-]+", serial)):
        raise ValueError("JMA tsunami serial is malformed")
    report_text = _path_text(root, ("Head", "ReportDateTime"))
    if not report_text:
        raise ValueError("JMA tsunami report publication time is missing")
    published_at = _parse_datetime(report_text)
    reference_now = validation_now or datetime.now(timezone.utc)
    if published_at > reference_now:
        raise ValueError("JMA tsunami publication time is in the future")

    operation = {
        "発表": TsunamiOperation.UNKNOWN,
        "取消": TsunamiOperation.CANCEL,
    }[info_type]
    occurred_at = _parse_origin_time(root)
    if occurred_at is not None and occurred_at > published_at:
        raise ValueError("JMA tsunami occurrence time follows its publication time")

    forecast = _path_node(root, ("Body", "Tsunami", "Forecast"))
    areas: list[JmaTsunamiArea] = []
    seen_area_codes: set[str] = set()
    if info_type != "取消":
        if forecast is None:
            raise ValueError("JMA tsunami bulletin has no forecast area section")
        for item in forecast:
            if _local_name(item.tag) != "Item":
                continue
            area = _path_node(item, ("Area",))
            code = _child_text(area, "Code") if area is not None else None
            name = _child_text(area, "Name") if area is not None else None
            if code is None or not re.fullmatch(r"\d{3}", code) or not name:
                raise ValueError("JMA tsunami forecast area code/name is missing or malformed")
            if code in seen_area_codes:
                # A bulletin must identify each forecast area once. Reject the
                # whole bulletin so XML order can never hide a higher warning.
                raise ValueError("JMA tsunami bulletin has duplicate forecast area code")
            seen_area_codes.add(code)
            kind = _path_node(item, ("Category", "Kind"))
            kind_code = _child_text(kind, "Code") if kind is not None else None
            warning_class = {
                "53": TsunamiWarningClass.MAJOR_WARNING,
                "51": TsunamiWarningClass.WARNING,
                "62": TsunamiWarningClass.ADVISORY,
                "71": TsunamiWarningClass.FORECAST,
                "72": TsunamiWarningClass.FORECAST,
                "00": TsunamiWarningClass.NONE,
            }.get(kind_code, TsunamiWarningClass.UNKNOWN)
            area_status = (
                TsunamiAreaStatus.ACTIVE
                if warning_class in {
                    TsunamiWarningClass.MAJOR_WARNING,
                    TsunamiWarningClass.WARNING,
                    TsunamiWarningClass.ADVISORY,
                    TsunamiWarningClass.FORECAST,
                }
                else TsunamiAreaStatus.CANCELLED
                if warning_class == TsunamiWarningClass.NONE
                else TsunamiAreaStatus.UNKNOWN
            )
            height_node = next(
                (node for node in item.iter() if _local_name(node.tag) == "TsunamiHeight"),
                None,
            )
            description = height_node.attrib.get("description") if height_node is not None else None
            raw_height = (height_node.text or "").strip() if height_node is not None else ""
            if raw_height and re.fullmatch(r"(?:\d+(?:\.\d*)?|\.\d+)", raw_height):
                value_m = float(raw_height)
                if not math.isfinite(value_m) or not 0 <= value_m <= 100:
                    raise ValueError("JMA tsunami maximum height is outside the accepted range")
                max_height = TsunamiMaxHeight(
                    value_m=value_m,
                    expression=TsunamiHeightExpression.NUMERIC,
                    description=description or None,
                )
            elif description and "巨大" in description:
                max_height = TsunamiMaxHeight(
                    expression=TsunamiHeightExpression.HUGE,
                    description=description,
                )
            elif description and "高い" in description:
                max_height = TsunamiMaxHeight(
                    expression=TsunamiHeightExpression.HIGH,
                    description=description,
                )
            else:
                max_height = TsunamiMaxHeight(
                    expression=TsunamiHeightExpression.UNKNOWN,
                    description=description or None,
                )
            arrival_text = next(
                (
                    (node.text or "").strip()
                    for node in item.iter()
                    if _local_name(node.tag) == "ArrivalTime" and node.text
                ),
                None,
            )
            arrival_at = _parse_datetime(arrival_text) if arrival_text else None
            areas.append(
                JmaTsunamiArea(
                    code=code,
                    name=name,
                    status=area_status,
                    warning_class=warning_class,
                    max_height=max_height,
                    arrival_at=arrival_at,
                )
            )
        if not areas or len(areas) > 128:
            raise ValueError("JMA tsunami bulletin has no areas or exceeds the area limit")
        if occurred_at is None:
            raise ValueError("JMA tsunami bulletin has no source-provided earthquake origin time")

    bulletin = _official_bulletin(root, url, body, "VTSE41", reference_now, tuple(area.code for area in areas))
    return JmaTsunamiBulletin(
        event_id=event_id,
        serial=serial,
        info_type=info_type,
        operation=operation,
        published_at=bulletin.issued_at,
        occurred_at=occurred_at,
        reference_url=url,
        forecast_areas=tuple(areas),
        bulletin=bulletin,
    )


def _aggregate_tsunami_forecast_areas(
    bulletins: tuple[JmaTsunamiBulletin, ...],
    now: datetime,
) -> tuple[tuple[TsunamiReferenceForecastArea, ...], bool]:
    by_code: dict[str, list[tuple[JmaTsunamiBulletin, JmaTsunamiArea]]] = {}
    for bulletin in bulletins:
        for area in bulletin.forecast_areas:
            by_code.setdefault(area.code, []).append((bulletin, area))
    result: list[TsunamiReferenceForecastArea] = []
    conflict = False
    for code, records in sorted(by_code.items()):
        active = [item for item in records if item[1].status == TsunamiAreaStatus.ACTIVE]
        same_bulletin_counts: dict[tuple[str, str | None], int] = {}
        for bulletin, _area in records:
            identity = (bulletin.event_id, bulletin.serial)
            same_bulletin_counts[identity] = same_bulletin_counts.get(identity, 0) + 1
        duplicate_in_bulletin = any(count > 1 for count in same_bulletin_counts.values())
        if duplicate_in_bulletin or len({item[0].event_id for item in active}) > 1:
            conflict = True
            chosen_bulletin, chosen_area = max(records, key=lambda item: item[0].published_at)
            area_status = TsunamiAreaStatus.UNKNOWN
        elif active:
            chosen_bulletin, chosen_area = active[0]
            area_status = chosen_area.status
        else:
            latest_time = max(item[0].published_at for item in records)
            latest = [item for item in records if item[0].published_at == latest_time]
            if len({item[1].status for item in latest}) > 1:
                conflict = True
                chosen_bulletin, chosen_area = latest[-1]
                area_status = TsunamiAreaStatus.UNKNOWN
            else:
                chosen_bulletin, chosen_area = latest[-1]
                area_status = chosen_area.status
        if now >= chosen_bulletin.published_at + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS):
            area_status = TsunamiAreaStatus.UNKNOWN
        result.append(
            TsunamiReferenceForecastArea(
                area_code=chosen_area.code,
                area_name=chosen_area.name,
                status=area_status,
                warning_class=chosen_area.warning_class,
                max_height=chosen_area.max_height,
                arrival_at=chosen_area.arrival_at,
            )
        )
    return tuple(result), conflict


def tsunami_reference_from_result(result: JmaTsunamiFetchResult) -> TsunamiReferenceResponse:
    """Project a feed result for the read-only reference endpoint, never SafetyCore."""
    latest = result.bulletins[-1] if result.bulletins else None
    if result.conflict:
        source_status = TsunamiSourceFreshness.CONFLICT
    elif result.status == LiveSourceStatus.FRESH:
        source_status = TsunamiSourceFreshness.CURRENT
    elif result.status == LiveSourceStatus.STALE:
        source_status = TsunamiSourceFreshness.STALE
    else:
        source_status = TsunamiSourceFreshness.UNKNOWN

    if source_status == TsunamiSourceFreshness.CONFLICT:
        areas = tuple(item.model_copy(update={"status": TsunamiAreaStatus.UNKNOWN}) for item in result.forecast_areas)
        status = TsunamiReferenceStatus.CONFLICT
    elif source_status != TsunamiSourceFreshness.CURRENT:
        areas = tuple(item.model_copy(update={"status": TsunamiAreaStatus.UNKNOWN}) for item in result.forecast_areas)
        status = TsunamiReferenceStatus.UNKNOWN
    else:
        areas = result.forecast_areas
        if any(item.status == TsunamiAreaStatus.ACTIVE for item in areas):
            status = TsunamiReferenceStatus.ACTIVE
        elif areas and all(item.status == TsunamiAreaStatus.CANCELLED for item in areas):
            status = TsunamiReferenceStatus.CANCELLED
        else:
            status = TsunamiReferenceStatus.UNKNOWN

    reference = latest.reference_url if latest is not None else JMA_FEED_URL
    return TsunamiReferenceResponse(
        mode="LIVE_REFERENCE",
        event_type=DisasterEventType.TSUNAMI,
        status=status,
        source_status=source_status,
        source=TsunamiReferenceSource(
            source_id=JMA_TSUNAMI_SOURCE_ID,
            product_code=JMA_TSUNAMI_PRODUCT_CODE,
            name=JMA_TSUNAMI_SOURCE_NAME,
            url=reference,
            published_at=latest.published_at if latest is not None else result.last_published_at,
            fetched_at=result.retrieved_at,
            operation=latest.operation if latest is not None else TsunamiOperation.UNKNOWN,
            serial=latest.serial if latest is not None else result.serial,
        ),
        forecast_areas=areas,
        safety_authority="NONE",
    )


def _parse_jma_detail(
    url: str,
    body: bytes,
    validation_now: datetime | None = None,
) -> JmaEarthquakeReport:
    _validate_xml_size(body, JMA_DETAIL_MAX_BYTES)
    root = ET.fromstring(body)
    title = _path_text(root, ("Control", "Title"))
    if title != "震源・震度に関する情報":
        raise ValueError("unsupported JMA detail type")
    control_status = _path_text(root, ("Control", "Status"))
    if control_status != "通常":
        raise ValueError("JMA control status is not the usual report state")
    info_type = _path_text(root, ("Head", "InfoType"))
    if info_type not in {"発表", "取消"}:
        raise ValueError("unsupported JMA earthquake InfoType")
    info_kind = _path_text(root, ("Head", "InfoKind"))
    if info_kind != "地震情報":
        raise ValueError("JMA detail is not earthquake information")
    event_id = _path_text(root, ("Head", "EventID"))
    if not event_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", event_id):
        raise ValueError("JMA EventID is missing or malformed")
    serial = _path_text(root, ("Head", "Serial")) or "0"
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,16}", serial):
        raise ValueError("JMA serial is malformed")
    report_text = _path_text(root, ("Head", "ReportDateTime"))
    origin_text = _path_text(root, ("Body", "Earthquake", "OriginTime"))
    if not report_text or (not origin_text and info_type != "取消"):
        raise ValueError("JMA report publication and occurrence times are required for observations")
    published = _parse_datetime(report_text)
    occurred = _parse_datetime(origin_text) if origin_text else None
    reference_now = validation_now or datetime.now(timezone.utc)
    if (occurred is not None and occurred > published) or published > reference_now:
        raise ValueError("JMA report publication time is outside the accepted window")
    pref_container = _path_node(root, ("Body", "Intensity", "Observation"))
    if pref_container is None and info_type != "取消":
        raise ValueError("JMA earthquake detail has no observed intensity section")
    observations: list[JmaPrefObservation] = []
    for pref in pref_container.iter() if pref_container is not None and info_type != "取消" else ():
        if _local_name(pref.tag) != "Pref":
            continue
        name = _child_text(pref, "Name") or "Unknown prefecture"
        code = _child_text(pref, "Code")
        if code is not None and not re.fullmatch(r"\d{1,2}", code):
            code = None
        code = code.zfill(2) if code else None
        intensity = _child_text(pref, "MaxInt")
        if intensity is not None and not re.fullmatch(r"[0-7][+-]?|不明", intensity):
            intensity = None
        observations.append(JmaPrefObservation(code, name, intensity))
    if len(observations) > 64:
        raise ValueError("JMA report has too many prefecture observations")
    if info_type != "取消" and not observations:
        raise ValueError("JMA earthquake detail has no observed prefecture")
    bulletin = _official_bulletin(root, url, body, "VXSE53", reference_now, tuple(item.code for item in observations if item.code))
    return JmaEarthquakeReport(bulletin.report_id, title, bulletin.issued_at, occurred, url, tuple(observations), bulletin)


def _official_bulletin(root, url, body, product, received_at, target_codes):
    """Preserve business and transmission times separately; never fill from receipt."""
    def timestamp(section, name):
        value = _path_text(root, (section, name))
        return _parse_datetime(value) if value else None

    return OfficialBulletin(
        product=product,
        info_kind_version=_path_text(root, ("Head", "InfoKindVersion")),
        title=_path_text(root, ("Control", "Title")),
        editorial_office=_path_text(root, ("Control", "EditorialOffice")),
        publishing_office=_path_text(root, ("Control", "PublishingOffice")),
        status=_path_text(root, ("Control", "Status")),
        event_id=_path_text(root, ("Head", "EventID")),
        serial=_path_text(root, ("Head", "Serial")),
        operation={"発表": BulletinOperation.ISSUE, "取消": BulletinOperation.CANCEL}[_path_text(root, ("Head", "InfoType"))],
        issued_at=timestamp("Control", "DateTime"),
        reported_at=timestamp("Head", "ReportDateTime"),
        target_at=timestamp("Head", "TargetDateTime"),
        valid_until=timestamp("Head", "ValidDateTime"),
        occurred_at=_parse_origin_time(root),
        occurrence_times=_origin_times(root),
        received_at=received_at,
        reference_url=url,
        raw_sha256=sha256(body).hexdigest(),
        target_codes=target_codes,
    )


def _parse_origin_time(root):
    return min(_origin_times(root), default=None)


def _origin_times(root):
    body = _path_node(root, ("Body",))
    return tuple(
        _parse_datetime(value)
        for node in body if _local_name(node.tag) == "Earthquake"
        if (value := _child_text(node, "OriginTime"))
    ) if body is not None else ()


def normalize_tokyo_shelters(
    body: bytes,
    *,
    published_at: datetime = TOKYO_SHELTER_PUBLISHED_AT,
    limit: int = 512,
) -> tuple[DestinationRecord, ...]:
    """Normalize Tokyo's official designation CSV; opening/capacity stay UNKNOWN."""
    if len(body) > TOKYO_SHELTER_MAX_BYTES or not 1 <= limit <= 512:
        raise ValueError("Tokyo shelter CSV is oversized or requested limit is invalid")
    text = body.decode("utf-8-sig", errors="strict")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    required = {"施設名", "所在地住所", "緯度", "経度", "区市町村"}
    if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
        raise ValueError("Tokyo shelter CSV schema mismatch")
    records: list[DestinationRecord] = []
    for index, row in enumerate(reader):
        if index >= TOKYO_SHELTER_MAX_ROWS:
            raise ValueError("Tokyo shelter CSV has too many rows")
        name = (row.get("施設名") or "").strip()
        address = (row.get("所在地住所") or "").strip()
        lat_text = (row.get("緯度") or "").strip()
        lng_text = (row.get("経度") or "").strip()
        if not name or not address or not lat_text or not lng_text:
            continue
        try:
            lat, lng = float(lat_text), float(lng_text)
            coordinate = Coordinate(lat=lat, lng=lng)
        except (ValueError, TypeError):
            continue
        designations = tuple(
            header for header in reader.fieldnames
            if header in {"洪水", "崖崩れ、土石流及び地滑り", "高潮", "地震", "津波", "大規模な火事", "内水氾濫", "火山現象"}
            and (row.get(header) or "").strip() not in {"", "-", "対象外"}
        )
        digest = re.sub(r"[^A-Za-z0-9_-]", "", f"tokyo-{index}-{name}")[:80]
        records.append(
            DestinationRecord(
                id=f"dest-{digest}",
                name=name,
                address=address,
                area_id="JP-13",
                coordinates=coordinate,
                source_key=TOKYO_SHELTER_SOURCE_KEY,
                source_name=TOKYO_SHELTER_SOURCE_NAME,
                source_url=TOKYO_SHELTER_URL,
                source_published_at=published_at,
                designation_types=designations or ("designated shelter; hazard classification not supplied",),
                supported_hazards=(),
                open_status=DestinationOpenStatus.UNKNOWN,
                is_synthetic=False,
            )
        )
        if len(records) >= limit:
            break
    return tuple(records)


def normalize_gsi_hazard_designations(
    fields: Mapping[str, str | None],
    *,
    designation_role: DestinationDesignationRole,
) -> tuple[DestinationHazardDesignation, ...]:
    """Keep all eight GSI hazard classes and distinguish blank from absent fields."""
    if designation_role == DestinationDesignationRole.EVACUATION_SHELTER:
        return tuple(
            DestinationHazardDesignation(
                hazard_type=hazard_type,
                status=DestinationHazardDesignationStatus.UNKNOWN,
            )
            for hazard_type, _column in GSI_HAZARD_COLUMNS
        )

    result: list[DestinationHazardDesignation] = []
    for hazard_type, column in GSI_HAZARD_COLUMNS:
        if column not in fields or fields[column] is None:
            status = DestinationHazardDesignationStatus.UNKNOWN
        else:
            raw = fields[column]
            if not isinstance(raw, str):
                raise ValueError(f"GSI hazard field {column} must be text")
            value = raw.strip()
            if value == "":
                status = DestinationHazardDesignationStatus.NOT_DESIGNATED
            elif value == "1":
                status = DestinationHazardDesignationStatus.DESIGNATED
            else:
                raise ValueError(f"GSI hazard field {column} has an illegal designation value")
        result.append(DestinationHazardDesignation(hazard_type=hazard_type, status=status))
    return tuple(result)


def normalize_gsi_destination_designation(
    record: DestinationRecord,
    fields: Mapping[str, str | None],
    *,
    designation_role: DestinationDesignationRole,
) -> DestinationRecord:
    """Attach official GSI classification without changing current-open status."""
    designations = normalize_gsi_hazard_designations(fields, designation_role=designation_role)
    current_event_hazards = {
        DestinationHazardType.EARTHQUAKE: DisasterEventType.EARTHQUAKE,
        DestinationHazardType.TSUNAMI: DisasterEventType.TSUNAMI,
    }
    supported_hazards = tuple(
        current_event_hazards[item.hazard_type]
        for item in designations
        if item.status == DestinationHazardDesignationStatus.DESIGNATED
        and item.hazard_type in current_event_hazards
    )
    roles = tuple(dict.fromkeys((*(record.designation_roles or ()), designation_role)))
    return record.model_copy(
        update={
            "designation_roles": roles,
            "hazard_designations": designations,
            "supported_hazards": supported_hazards,
            "open_status": DestinationOpenStatus.UNKNOWN,
        }
    )


def normalize_gsi_csv(
    body: bytes,
    *,
    area_id: str,
    source_url: str,
    designation_role: DestinationDesignationRole,
    source_published_at: datetime | None = None,
    limit: int = GSI_CSV_OUTPUT_LIMIT,
) -> tuple[DestinationRecord, ...]:
    """Normalize a bounded GSI city CSV; publication time is never inferred from DB update time."""
    if len(body) > GSI_CSV_MAX_BYTES or not 1 <= limit <= GSI_CSV_OUTPUT_LIMIT:
        raise ValueError("GSI CSV is oversized or requested output limit is invalid")
    if not re.fullmatch(r"JP-\d{2}", area_id):
        raise ValueError("GSI CSV requires a server-selected prefecture area ID")
    parsed_url = urlparse(source_url)
    if parsed_url.scheme != "https" or parsed_url.netloc not in GSI_ALLOWED_HOSTS:
        raise ValueError("GSI source URL must use an allowlisted official HTTPS host")
    if source_published_at is not None and (
        source_published_at.tzinfo is None or source_published_at.utcoffset() is None
    ):
        raise ValueError("GSI publication timestamp must include a timezone")

    text = body.decode("utf-8-sig", errors="strict")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    required = {"共通ID", "施設・場所名", "住所", "緯度", "経度"}
    if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
        raise ValueError("GSI evacuation CSV schema mismatch")
    records: list[DestinationRecord] = []
    seen_ids: set[str] = set()
    for index, row in enumerate(reader):
        if index >= GSI_CSV_MAX_ROWS:
            raise ValueError("GSI CSV has too many rows")
        if not any((value or "").strip() for value in row.values() if isinstance(value, str)):
            continue
        common_id = (row.get("共通ID") or "").strip()
        name = (row.get("施設・場所名") or "").strip()
        address = (row.get("住所") or "").strip()
        lat_text = (row.get("緯度") or "").strip()
        lng_text = (row.get("経度") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,88}", common_id):
            raise ValueError("GSI CSV common ID is missing or malformed")
        if common_id in seen_ids:
            raise ValueError("GSI CSV contains duplicate common IDs")
        seen_ids.add(common_id)
        if not name or not address or not lat_text or not lng_text:
            raise ValueError("GSI CSV contains a row with incomplete facility fields")
        try:
            coordinate = Coordinate(lat=float(lat_text), lng=float(lng_text))
        except (ValueError, TypeError) as exc:
            raise ValueError("GSI CSV contains invalid WGS84 coordinates") from exc
        designations = normalize_gsi_hazard_designations(
            row,
            designation_role=designation_role,
        )
        display_designations = (
            tuple(
                column for hazard, column in GSI_HAZARD_COLUMNS
                if next(item for item in designations if item.hazard_type == hazard).status
                == DestinationHazardDesignationStatus.DESIGNATED
            )
            if designation_role == DestinationDesignationRole.EMERGENCY_EVACUATION_SITE
            else ("指定避難所",)
        )
        record = DestinationRecord(
            id=f"gsi-{common_id}",
            name=name,
            address=address,
            area_id=area_id,
            coordinates=coordinate,
            source_key=GSI_SOURCE_KEY,
            source_name=GSI_SOURCE_NAME,
            source_url=source_url,
            source_published_at=source_published_at,
            designation_types=display_designations or ("指定緊急避難場所",),
            designation_roles=(designation_role,),
            hazard_designations=designations,
            open_status=DestinationOpenStatus.UNKNOWN,
        )
        records.append(
            normalize_gsi_destination_designation(
                record,
                row,
                designation_role=designation_role,
            )
        )
        if len(records) >= limit:
            break
    return tuple(records)


class TokyoShelterSource:
    """Static designation cache; never claims present opening or capacity."""

    def __init__(
        self,
        fetch: Callable[[str, dict[str, str]], HttpPayload] = _http_get,
        *,
        clock: Callable[[], float] = monotonic,
        refresh_interval: int = 24 * 60 * 60,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._fetch = fetch
        self._clock = clock
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._refresh_interval = refresh_interval
        self._lock = threading.RLock()
        self._last_attempt = float("-inf")
        self._records: tuple[DestinationRecord, ...] = ()
        self._status = LiveSourceStatus.UNAVAILABLE
        self._retrieved_at: datetime | None = None
        self._next_retry_at: datetime | None = None
        self._next_retry_monotonic = 0.0
        self._failures = 0

    def fetch_latest(self) -> tuple[LiveSourceStatus, tuple[DestinationRecord, ...], datetime | None, datetime | None]:
        with self._lock:
            if self._clock() < self._next_retry_monotonic:
                return self._status, self._records, self._retrieved_at, self._next_retry_at
            if self._records and self._clock() - self._last_attempt < self._refresh_interval:
                return self._status, self._records, self._retrieved_at, None
            self._last_attempt = self._clock()
            try:
                response = self._fetch(TOKYO_SHELTER_URL, {"Accept": "text/csv"})
                if response.status_code != 200:
                    raise ValueError("Tokyo shelter source returned a non-200 response")
                self._records = normalize_tokyo_shelters(response.content)
                self._retrieved_at = self._now()
                self._status = LiveSourceStatus.FRESH if self._records else LiveSourceStatus.UNSUPPORTED
                self._failures = 0
                self._next_retry_monotonic = 0.0
                self._next_retry_at = None
            except (httpx.HTTPError, OSError, ValueError, UnicodeError):
                self._failures += 1
                delay = min(5 * (2 ** min(self._failures - 1, 6)), 300)
                if self._failures >= 5:
                    delay = 300
                self._status = LiveSourceStatus.BACKOFF if self._records else LiveSourceStatus.UNAVAILABLE
                self._next_retry_monotonic = self._clock() + delay
                self._next_retry_at = self._now() + timedelta(seconds=delay)
            return self._status, self._records, self._retrieved_at, self._next_retry_at


def _report_freshness(reports: tuple[JmaEarthquakeReport, ...], now: datetime) -> LiveSourceStatus:
    if not reports:
        return LiveSourceStatus.UNSUPPORTED
    latest = max(item.published_at for item in reports)
    return LiveSourceStatus.STALE if now - latest >= timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS) else LiveSourceStatus.FRESH


def _validate_xml_size(body: bytes, limit: int) -> None:
    if not body or len(body) > limit:
        raise ValueError("XML document is empty or oversized")
    # JMA feeds use UTF-8; reject alternate encodings so declaration scans
    # cannot be bypassed with UTF-16/32 byte encodings.
    if body.startswith((b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff", b"\xff\xfe\x00\x00")):
        raise ValueError("XML encoding is outside the supported UTF-8 boundary")
    if b"\x00" in body:
        raise ValueError("XML document contains unsupported null-byte encoding")
    upper = body.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ValueError("XML document includes forbidden declarations")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(node: ET.Element, name: str) -> str | None:
    for child in node:
        if _local_name(child.tag) == name and child.text:
            return child.text.strip()
    return None


def _path_node(node: ET.Element, path: tuple[str, ...]) -> ET.Element | None:
    current = node
    for name in path:
        current = next((child for child in current if _local_name(child.tag) == name), None)
        if current is None:
            return None
    return current


def _path_text(node: ET.Element, path: tuple[str, ...]) -> str | None:
    found = _path_node(node, path)
    return found.text.strip() if found is not None and found.text else None


def _parse_datetime(value: str) -> datetime:
    normalized = value.strip().replace("Z", "+00:00")
    result = datetime.fromisoformat(normalized)
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("official timestamps must include a timezone")
    return result



def _snapshot_metadata_from_source(source, references, parser):
    """Bounded historical identity recovery, never current incident evidence."""
    with source._lock:
        references = tuple(dict.fromkeys(references))[:64]
        pending = tuple(url for url in references if url not in source._snapshot_metadata)
        if pending and source._clock() - source._snapshot_last_attempt >= source._poll_interval:
            source._snapshot_last_attempt = source._clock()
            for url in pending[:source._detail_limit]:
                if len(source._snapshot_metadata) >= 64:
                    break  # Never evict provenance silently to keep fetching.
                parsed = urlparse(url)
                if (parsed.scheme != "https" or parsed.netloc != "www.data.jma.go.jp"
                    or not parsed.path.startswith("/developer/xml/data/") or parsed.query or parsed.fragment):
                    continue
                try:
                    raw = source._fetch(url, {"Accept": "application/xml, text/xml"})
                    if raw.status_code != 200 or len(raw.content) > JMA_DETAIL_MAX_BYTES:
                        continue
                    metadata = parser(url, raw.content, source._now()).bulletin
                    if metadata is not None:
                        source._snapshot_metadata[url] = metadata
                except (httpx.HTTPError, OSError, ValueError, ET.ParseError, UnicodeError):
                    continue
        return {url: source._snapshot_metadata[url] for url in references if url in source._snapshot_metadata}
