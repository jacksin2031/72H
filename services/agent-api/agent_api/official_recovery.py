"""Resumable finite-feed scans. A completed window is never a no-hazard verdict."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
from hashlib import sha256
import json
from typing import Annotated, Literal
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
import httpx

from pydantic import AwareDatetime, Field, StrictStr
from seventytwoh_contracts.models import (
    ContractModel, LiveSourceStatus, OfficialSourceRecovery, OfficialReportReference, TsunamiAreaStatus,
    TsunamiMaxHeight, TsunamiOperation, TsunamiReferenceForecastArea, TsunamiWarningClass,
)

from .official_events import BulletinOperation, OfficialBulletin, OfficialEventState, reduce_official_bulletin
from .official_journal import JournalConflict

SHORT_FEED = "https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml"
LONG_FEED = "https://www.data.jma.go.jp/developer/xml/feed/eqvol_l.xml"
MAX_FEED_BYTES = 1_000_000
MAX_QUEUE = 1024
MAX_ARCHIVED = 4096


def detail_url(url):
    parsed = urlparse(url)
    if (parsed.scheme != "https" or parsed.netloc != "www.data.jma.go.jp"
        or not parsed.path.startswith("/developer/xml/data/") or parsed.query or parsed.fragment):
        raise ValueError("official detail URL outside allowlist")
    return url


class PendingDetail(ContractModel):
    url: Annotated[StrictStr, Field(max_length=300)]
    signature: Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]


class SavedFeed(ContractModel):
    url: Literal[SHORT_FEED, LONG_FEED]
    raw_sha256: Annotated[StrictStr, Field(pattern=r"^[a-f0-9]{64}$")]
    retrieved_at: AwareDatetime
    published_at: AwareDatetime
    etag: Annotated[StrictStr, Field(max_length=512, pattern=r"^[^\r\n]*$")] | None = None
    modified: Annotated[StrictStr, Field(max_length=128, pattern=r"^[^\r\n]*$")] | None = None


class JournalFrame(ContractModel):
    schema_version: Literal[1] = 1
    product: Literal["VXSE53", "VTSE41"]
    reports: Annotated[tuple[OfficialBulletin, ...], Field(max_length=MAX_ARCHIVED)] = ()
    feeds: Annotated[tuple[SavedFeed, ...], Field(max_length=2)] = ()
    pending: Annotated[tuple[PendingDetail, ...], Field(max_length=MAX_QUEUE)] = ()
    observed_signatures: Annotated[tuple[StrictStr, ...], Field(max_length=8192)] = ()
    last_verified_at: AwareDatetime | None = None
    window_start_at: AwareDatetime | None = None
    coverage_origin_at: AwareDatetime | None = None
    gap: Literal["CHECKPOINT_OUTSIDE_WINDOW", "EMPTY_RECOVERY_WINDOW"] | None = None
    reconciliation_required_since: AwareDatetime | None = None
    audit_cursor: Annotated[int, Field(ge=0, le=MAX_QUEUE)] = 0


def feed_publication(raw, now):
    from .live_sources import _child_text, _parse_datetime
    value = _child_text(ET.fromstring(raw), "updated")
    if not value:
        raise ValueError("official feed lacks its publication timestamp")
    published = _parse_datetime(value)
    if published > now:
        raise ValueError("official feed publication is in the future")
    return published


def parse_feed(product, raw, validation_now=None):
    from .live_sources import _validate_xml_size, _local_name, _child_text, _parse_datetime
    _validate_xml_size(raw, MAX_FEED_BYTES)
    root = ET.fromstring(raw)
    if _local_name(root.tag) != "feed":
        raise ValueError("invalid official feed representation")
    pending, times = [], []
    entries = [node for node in root if _local_name(node.tag) == "entry"]
    if len(entries) > 2048:
        raise ValueError("official feed entry capacity exceeded")
    for entry in entries:
        updated = _child_text(entry, "updated")
        if updated:
            updated_at = _parse_datetime(updated)
            if validation_now is not None and updated_at > validation_now:
                raise ValueError("feed discovery timestamp is in the future")
            times.append(updated_at)
        title = _child_text(entry, "title") or ""
        url = next((node.attrib.get("href") for node in entry
                    if _local_name(node.tag) == "link" and node.attrib.get("type") == "application/xml"), None)
        supported = (title == "震源・震度に関する情報" if product == "VXSE53"
                     else ("VTSE41" in (url or "") or "津波警報" in title))
        if not supported:
            continue
        if not url or not updated:
            raise ValueError("supported feed entry lacks source identity/time")
        pending.append(PendingDetail(url=detail_url(url), signature=sha256(ET.tostring(entry)).hexdigest()))
    if len(pending) > MAX_QUEUE:
        raise ValueError("official detail queue capacity exceeded")
    # Atom order/updated are discovery data. Detail Control.DateTime decides revisions.
    return tuple(pending), min(times, default=None)


class OfficialRecoveryEngine:
    def __init__(self, owner, product, journal):
        from .live_sources import _parse_jma_detail, _parse_jma_tsunami_detail
        self.owner, self.product, self.journal = owner, product, journal
        self.parser = _parse_jma_detail if product == "VXSE53" else _parse_jma_tsunami_detail
        self.frame = JournalFrame(product=product)
        self.token = 0
        self.states, self.projections = {}, {}
        self.loaded = False
        self.restored = False
        self.last_attempt = float("-inf")
        self.last_long = float("-inf")
        self.failures = 0
        self.retry_at = None
        self.next_retry = 0.0
        self.error = None
        self.storage_failed = False
        self.stage = "RESTORE"
        self.connection_status = "UNKNOWN"
        self.latest_fetch_at = None
        self._result = None
        self._restart_verified = None

    def _load(self):
        read = self.journal.load(self.product)
        if read.document is not None and set(json.loads(read.document)) != set(JournalFrame.model_fields):
            raise ValueError("incomplete official checkpoint schema")
        frame = JournalFrame.model_validate_json(read.document) if read.document else JournalFrame(product=self.product)
        if frame.product != self.product:
            raise ValueError("official checkpoint product mismatch")
        now = self.owner._now()
        if frame.last_verified_at is not None and frame.last_verified_at > now:
            raise ValueError("official checkpoint verification is in the future")
        if any(value is not None and value > now for value in (frame.window_start_at, frame.coverage_origin_at, frame.reconciliation_required_since)):
            raise ValueError("official checkpoint discovery window is in the future")
        if any(item.received_at > now or item.product != self.product for item in frame.reports):
            raise ValueError("official checkpoint time/product mismatch")
        for item in frame.pending:
            detail_url(item.url)
        projections, states = {}, {}
        for metadata in frame.reports:
            raw = self.journal.read_raw(metadata.raw_sha256)
            report = self.parser(metadata.reference_url, raw, metadata.received_at)
            if report.bulletin != metadata:
                raise ValueError("official archive does not reproduce its envelope")
            self._reduce(states, projections, report)
        for feed in frame.feeds:
            if feed.retrieved_at > now or feed.published_at > feed.retrieved_at:
                raise ValueError("official checkpoint receipt is in the future")
            raw = self.journal.read_raw(feed.raw_sha256)
            parse_feed(self.product, raw, feed.retrieved_at)
            if feed_publication(raw, feed.retrieved_at) != feed.published_at:
                raise ValueError("official feed publication does not match its raw bytes")
        self.frame, self.token = frame, read.token
        self.states, self.projections = states, projections
        self.restored = read.document is not None
        self._restart_verified = frame.last_verified_at
        self.latest_fetch_at = max((item.retrieved_at for item in frame.feeds), default=None)
        self.loaded = True

    def _reduce(self, states, projections, incoming):
        from .live_sources import JmaTsunamiArea
        metadata = incoming.bulletin
        if metadata is None:
            raise ValueError("missing official envelope")
        group = metadata.group_id
        prior = states.get(group)
        # History remains in the durable archive, not silently discarded.
        if prior and len(prior.history) >= 256:
            prior = OfficialEventState(prior.head, (prior.head,), prior.conflict)
        reduced = reduce_official_bulletin(prior, metadata)
        states[group] = reduced
        if prior and reduced.head.raw_sha256 == prior.head.raw_sha256:
            return
        previous = projections.get(group)
        if self.product == "VXSE53":
            withdrawn = tuple(dict.fromkeys((*(previous.observations if previous else ()),
                                            *(previous.withdrawn_observations if previous else ()))))
            occurrence = incoming.occurred_at
            if metadata.operation == BulletinOperation.CANCEL and occurrence is None and previous:
                occurrence = previous.occurred_at
            projections[group] = replace(incoming, occurred_at=occurrence, withdrawn_observations=withdrawn)
        else:
            if metadata.operation == BulletinOperation.CANCEL:
                areas = tuple(JmaTsunamiArea(area.code, area.name, TsunamiAreaStatus.UNKNOWN,
                    TsunamiWarningClass.UNKNOWN, TsunamiMaxHeight(), None)
                    for area in (previous.forecast_areas if previous else incoming.forecast_areas))
                occurrence = previous.occurred_at if previous else incoming.occurred_at
                operation = TsunamiOperation.CANCEL
            else:
                areas, occurrence = incoming.forecast_areas, incoming.occurred_at
                operation = TsunamiOperation.UPDATE if previous else TsunamiOperation.ISSUE
            projections[group] = replace(incoming, forecast_areas=areas, occurred_at=occurrence, operation=operation)

    def _feed(self, url, raw_objects):
        saved = next((item for item in self.frame.feeds if item.url == url), None)
        headers = {"Accept": "application/atom+xml, application/xml"}
        if saved:
            if saved.etag:
                headers["If-None-Match"] = saved.etag
            if saved.modified:
                headers["If-Modified-Since"] = saved.modified
        payload = self.owner._fetch(url, headers)
        self.connection_status = "REACHABLE"
        if payload.status_code == 304:
            if saved is None:
                # No stored representation: 304 cannot be used as an empty feed.
                payload = self.owner._fetch(url, {"Accept": "application/atom+xml, application/xml"})
                if payload.status_code != 200:
                    raise ValueError("304 without a stored official feed")
            else:
                self.stage = "READ_ARCHIVE"
                raw = self.journal.read_raw(saved.raw_sha256)
                self.stage = "FEED"
                self.latest_fetch_at = self.owner._now()
                return saved.model_copy(update={"retrieved_at": self.owner._now()}), *parse_feed(self.product, raw, self.owner._now())
        if payload.status_code != 200:
            raise ValueError("official feed request failed")
        pending, oldest = parse_feed(self.product, payload.content, self.owner._now())
        self.latest_fetch_at = self.owner._now()
        digest = sha256(payload.content).hexdigest()
        raw_objects[digest] = payload.content
        saved = SavedFeed(url=url, raw_sha256=digest, retrieved_at=self.owner._now(),
                          published_at=feed_publication(payload.content, self.owner._now()),
                          etag=payload.headers.get("etag"), modified=payload.headers.get("last-modified"))
        return saved, pending, oldest

    def fetch_latest(self, *, force=False):
        with self.owner._lock:
            mono = self.owner._clock()
            if mono < self.next_retry:
                return self._project(failed=True)
            if self.loaded and self.error is None and not force and mono - self.last_attempt < self.owner._poll_interval:
                return self._project(failed=self.error is not None)
            self.last_attempt = mono
            try:
                if not self.loaded:
                    self.stage = "RESTORE"
                    self._load()
                raw_objects = {}
                feeds = {item.url: item for item in self.frame.feeds}
                queue = list(self.frame.pending)
                signatures = set(self.frame.observed_signatures)
                window_start, origin, gap = self.frame.window_start_at, self.frame.coverage_origin_at, self.frame.gap
                required = self.frame.reconciliation_required_since
                previous_short = feeds.get(SHORT_FEED)
                # Five minutes is an application continuity ceiling, below JMA's
                # short-feed minimum retention. It is not a delivery guarantee.
                if previous_short and (self.owner._now() - previous_short.retrieved_at).total_seconds() > 300:
                    required = required or self.owner._now()
                scanned_long = mono - self.last_long >= 3600 or required is not None
                audit_cursor = self.frame.audit_cursor
                audit_entries = ()
                self.stage = "FEED"
                if scanned_long:
                    previous_long = feeds.get(LONG_FEED)
                    long, entries, oldest = self._feed(LONG_FEED, raw_objects)
                    feeds[LONG_FEED] = long
                    queued = {(item.url, item.signature) for item in queue}
                    queue.extend(item for item in entries if item.signature not in signatures
                                 and (item.url, item.signature) not in queued)
                    # A changed snapshot may audit known detail URLs, but never
                    # re-populates the recovery queue or starves new entries.
                    if previous_long and previous_long.raw_sha256 != long.raw_sha256:
                        audit_entries = tuple(item for item in entries if item.signature in signatures)
                    window_start = oldest
                    origin = min((value for value in (origin, oldest) if value is not None), default=None)
                    boundary = self._restart_verified or self.frame.last_verified_at
                    if boundary is not None and (oldest is None or boundary < oldest):
                        gap = "EMPTY_RECOVERY_WINDOW" if oldest is None else "CHECKPOINT_OUTSIDE_WINDOW"
                short, entries, _ = self._feed(SHORT_FEED, raw_objects)
                feeds[SHORT_FEED] = short
                queued = {(item.url, item.signature) for item in queue}
                queue.extend(item for item in entries if item.signature not in signatures
                             and (item.url, item.signature) not in queued)
                if len(queue) > MAX_QUEUE:
                    raise ValueError("official detail queue capacity exceeded")
                batch, pending = queue[:self.owner._detail_limit], queue[self.owner._detail_limit:]
                if not queue and audit_entries:
                    start = audit_cursor % len(audit_entries)
                    batch = list((audit_entries[start:] + audit_entries[:start])[:self.owner._detail_limit])
                    audit_cursor = (start + len(batch)) % len(audit_entries)
                reports = list(self.frame.reports)
                seen_hashes = {item.raw_sha256 for item in reports}
                states, projections = dict(self.states), dict(self.projections)
                parsed = []
                self.stage = "DETAIL"
                for entry in batch:
                    payload = self.owner._fetch(detail_url(entry.url), {"Accept": "application/xml, text/xml"})
                    if payload.status_code != 200 or len(payload.content) > 2_000_000:
                        raise ValueError("official detail request/size invalid")
                    report = self.parser(entry.url, payload.content, self.owner._now())
                    self.latest_fetch_at = self.owner._now()
                    parsed.append(report)
                    metadata = report.bulletin
                    if metadata.raw_sha256 not in seen_hashes:
                        reports.append(metadata)
                        seen_hashes.add(metadata.raw_sha256)
                        raw_objects[metadata.raw_sha256] = payload.content
                    signatures.add(entry.signature)
                for report in sorted(parsed, key=lambda item: item.bulletin.issued_at):
                    self._reduce(states, projections, report)
                # Commit order must also replay the original deterministic reduction.
                metadata_by_hash = {item.raw_sha256: item for item in reports}
                old_hashes = {item.raw_sha256 for item in self.frame.reports}
                reports = [*self.frame.reports, *(metadata_by_hash[item.bulletin.raw_sha256]
                    for item in sorted(parsed, key=lambda item: item.bulletin.issued_at)
                    if item.bulletin.raw_sha256 not in old_hashes)]
                reports = list({item.raw_sha256: item for item in reports}.values())
                if len(reports) > MAX_ARCHIVED or len(signatures) > 8192:
                    raise ValueError("official archive/index capacity exceeded")
                now = self.owner._now()
                if ((self.frame.last_verified_at is not None and now < self.frame.last_verified_at)
                    or any(feed.retrieved_at > now for feed in feeds.values())):
                    raise ValueError("local observation clock moved backwards during recovery")
                active_heads = sum(min(item.head.issued_at + timedelta(seconds=900),
                    item.head.valid_until or item.head.issued_at + timedelta(seconds=900)) > now for item in states.values())
                if active_heads > 64:
                    raise ValueError("current official unit capacity exceeded")
                long = feeds.get(LONG_FEED)
                if not pending and long and required is not None and long.published_at >= required:
                    required = None
                # 304/short receipts never refresh this source publication clock.
                verified = (long.published_at if long and not pending and gap is None
                    and required is None and window_start is not None else self.frame.last_verified_at)
                frame = JournalFrame(product=self.product, reports=tuple(reports), feeds=tuple(feeds.values()),
                    pending=tuple(pending), observed_signatures=tuple(sorted(signatures)), window_start_at=window_start,
                    coverage_origin_at=origin, gap=gap, reconciliation_required_since=required,
                    audit_cursor=audit_cursor, last_verified_at=verified)
                self.stage = "COMMIT"
                token = self.journal.commit(self.product, self.token, frame.model_dump_json().encode(), raw_objects)
                self.frame, self.token = frame, token
                self.states, self.projections = states, projections
                self.owner._lifecycle = states
                if scanned_long:
                    self.last_long = mono
                self._restart_verified = None
                self.failures, self.error, self.retry_at, self.next_retry = 0, None, None, 0.0
                self.storage_failed = False
                return self._project()
            except Exception as exc:
                # Only exception class is surfaced: provider/ADC details may contain secrets.
                self.error = type(exc).__name__
                self.storage_failed = self.stage in {"RESTORE", "READ_ARCHIVE", "COMMIT"}
                if self.stage in {"FEED", "DETAIL"} and isinstance(exc, (httpx.TransportError, OSError)):
                    self.connection_status = "UNAVAILABLE"
                self.failures += 1
                delay = min(5 * 2 ** min(self.failures - 1, 6), 300)
                self.next_retry = mono + delay
                self.retry_at = self.owner._now() + timedelta(seconds=delay)
                if isinstance(exc, JournalConflict):
                    self.loaded = False  # Reload the winning checkpoint; never overwrite it.
                return self._project(failed=True)

    def recovery(self, failed=False):
        return OfficialSourceRecovery(persistence=self.journal.kind,
            storage_status="FAILED" if failed and self.storage_failed else "UNCONFIGURED" if self.journal.kind == "MEMORY" else "HEALTHY",
            scan_status="UNKNOWN" if failed else "GAP" if self.frame.gap else "SCANNING" if self.frame.pending or self.frame.reconciliation_required_since
                else "WINDOW_VERIFIED" if self.frame.last_verified_at else "NOT_STARTED",
            connection_status=self.connection_status, last_successful_fetch_at=self.latest_fetch_at,
            pending_details=len(self.frame.pending), archived_reports=len(self.frame.reports), checkpoint_version=self.token,
            last_checked_at=max((item.retrieved_at for item in self.frame.feeds), default=None),
            last_verified_at=self.frame.last_verified_at, window_start_at=self.frame.window_start_at,
            coverage_origin_at=self.frame.coverage_origin_at, restored=self.restored,
            reconciliation_required_since=self.frame.reconciliation_required_since,
            limitations=("Verified feed window is not nationwide safety or a no-warning verdict.",
                "Last verified time is the long-feed publication, not an HTTP receipt or guaranteed delivery watermark.",
                *( ("Awaiting a newer long-feed snapshot after a polling interruption.",) if self.frame.reconciliation_required_since else () ),
                *( (self.frame.gap,) if self.frame.gap else () ),
                *( (f"Recovery failed ({self.error}); committed timestamps retained.",) if failed else () )))

    def _project(self, failed=False):
        from .live_sources import JmaFetchResult, JmaTsunamiFetchResult, _aggregate_tsunami_forecast_areas, jma_report_deadline
        now = self.owner._now()
        heads = tuple(sorted(self.projections.values(), key=lambda item: item.published_at)[-64:])
        published = max((item.published_at for item in heads), default=None)
        conflict = any(item.conflict for item in self.states.values())
        recovery = self.recovery(failed)
        status = (LiveSourceStatus.CIRCUIT_OPEN if failed and self.failures >= 5 else LiveSourceStatus.BACKOFF if failed
            else LiveSourceStatus.INVALID_RESPONSE if recovery.scan_status == "SCANNING" or self.frame.gap or conflict
            else LiveSourceStatus.UNSUPPORTED if not heads
            else LiveSourceStatus.STALE if not any(now < jma_report_deadline(item) for item in heads) else LiveSourceStatus.FRESH)
        detail = f"Official {self.product} recovery: {recovery.scan_status}; {len(self.frame.pending)} pending. Feed window does not prove no hazard."
        references = self._references(now, status)
        if self.product == "VXSE53":
            return JmaFetchResult(status, recovery.last_checked_at, published, self.retry_at, heads, detail, recovery, references)
        areas, area_conflict = _aggregate_tsunami_forecast_areas(heads, now)
        if status != LiveSourceStatus.FRESH:
            areas = tuple(item.model_copy(update={"status": TsunamiAreaStatus.UNKNOWN}) for item in areas)
        latest = heads[-1] if heads else None
        return JmaTsunamiFetchResult(status, recovery.last_checked_at, published, self.retry_at,
            latest.operation if latest else TsunamiOperation.UNKNOWN, latest.serial if latest else None,
            heads, areas, conflict or area_conflict, detail, recovery, references)

    def _references(self, now, status):
        from .live_sources import JMA_SOURCE_NAME, JMA_TSUNAMI_SOURCE_NAME
        ordered = sorted(self.frame.reports, key=lambda item: item.issued_at, reverse=True)
        heads = sorted((item.head for item in self.states.values()), key=lambda item: item.issued_at, reverse=True)[:64]
        selected = list({item.report_id: item for item in (*heads, *ordered)}.values())[:128]
        result = []
        for metadata in selected:
            state = self.states[metadata.group_id]
            is_head = metadata.report_id == state.head.report_id
            expires = metadata.issued_at + timedelta(seconds=900)
            if metadata.valid_until is not None:
                expires = min(expires, metadata.valid_until)
            lifecycle = ("CONFLICT" if state.conflict else "SUPERSEDED" if not is_head
                else "WITHDRAWN" if metadata.operation == BulletinOperation.CANCEL
                else "STALE" if now >= expires else "UNKNOWN" if status != LiveSourceStatus.FRESH else "CURRENT")
            result.append(OfficialReportReference(report_id=metadata.report_id, group_id=metadata.group_id,
                product=metadata.product, title=metadata.title,
                source_name=JMA_SOURCE_NAME if self.product == "VXSE53" else JMA_TSUNAMI_SOURCE_NAME,
                reference_url=metadata.reference_url, event_ids=tuple(metadata.event_id.split()), serial=metadata.serial,
                operation=metadata.operation.value, lifecycle=lifecycle, issued_at=metadata.issued_at,
                reported_at=metadata.reported_at, received_at=metadata.received_at, target_at=metadata.target_at,
                occurred_at=metadata.occurred_at, official_valid_until=metadata.valid_until,
                evidence_expires_at=expires, target_codes=metadata.target_codes, is_head=is_head,
                superseded_by=None if is_head else state.head.report_id, raw_sha256=metadata.raw_sha256,
                parser_version=metadata.parser_version, information_version=metadata.info_kind_version,
                code_mapping_version=metadata.code_mapping_version))
        return tuple(result)
