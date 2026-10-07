"""Bounded adapters for official live source documents.

Provider bytes are parsed into small typed values here; no caller input can
choose source URLs, trust level, publication time, or area authorization.
"""

from __future__ import annotations

import csv
import io
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import monotonic
from typing import Callable
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import httpx

from seventytwoh_contracts.models import (
    Coordinate,
    DestinationRecord,
    DestinationOpenStatus,
    LiveSourceStatus,
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
    occurred_at: datetime
    reference_url: str
    observations: tuple[JmaPrefObservation, ...]


@dataclass(frozen=True, slots=True)
class JmaFetchResult:
    status: LiveSourceStatus
    retrieved_at: datetime | None
    last_published_at: datetime | None
    next_retry_at: datetime | None
    reports: tuple[JmaEarthquakeReport, ...]
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
        self._failures = 0
        self._next_retry_monotonic = 0.0
        self._next_retry_at: datetime | None = None

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
                    status = _report_freshness(self._reports, retrieved)
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
                self._reports = tuple(normalized)
                self._etag = feed.headers.get("etag") or feed_etag or self._etag
                self._last_modified = feed.headers.get("last-modified") or feed_modified or self._last_modified
                self._failures = 0
                self._next_retry_monotonic = 0.0
                self._next_retry_at = None
                last_published = max((item.published_at for item in normalized), default=None)
                if not normalized:
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
        return entries, None, None


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
    if info_type != "発表":
        # Corrections and cancellations need a separate typed resolution path.
        raise ValueError("JMA correction or cancellation is not supported by this adapter")
    info_kind = _path_text(root, ("Head", "InfoKind"))
    if info_kind not in {None, "地震情報"}:
        raise ValueError("JMA detail is not earthquake information")
    event_id = _path_text(root, ("Head", "EventID"))
    if not event_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", event_id):
        raise ValueError("JMA EventID is missing or malformed")
    serial = _path_text(root, ("Head", "Serial")) or "0"
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,16}", serial):
        raise ValueError("JMA serial is malformed")
    report_text = _path_text(root, ("Head", "ReportDateTime"))
    origin_text = _path_text(root, ("Body", "Earthquake", "OriginTime"))
    if not report_text or not origin_text:
        raise ValueError("JMA report publication and occurrence times are both required")
    published = _parse_datetime(report_text)
    occurred = _parse_datetime(origin_text)
    reference_now = validation_now or datetime.now(timezone.utc)
    if occurred > published or published > reference_now:
        raise ValueError("JMA report publication time is outside the accepted window")
    pref_container = _path_node(root, ("Body", "Intensity", "Observation"))
    if pref_container is None:
        raise ValueError("JMA earthquake detail has no observed intensity section")
    observations: list[JmaPrefObservation] = []
    for pref in pref_container.iter():
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
    safe_id = f"{event_id}-{serial}"
    return JmaEarthquakeReport(safe_id, title, published, occurred, url, tuple(observations))


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
