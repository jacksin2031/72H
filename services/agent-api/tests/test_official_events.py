"""Official lifecycle regressions, including the real live evidence pipeline."""
import asyncio
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from agent_api.live import LiveStore
from agent_api.live_sources import (
    JMA_FEED_URL, JMA_SOURCE_KEY, HttpPayload, JmaEarthquakeSource,
    JmaTsunamiSource, _parse_jma_detail, _parse_jma_tsunami_detail,
    tsunami_reference_from_result,
)
from agent_api.official_events import BulletinValidity, reduce_official_bulletin
from seventytwoh_contracts.models import DisasterEventStatus, LiveSourceStatus, NetworkState
from test_live_sources import NOW, DETAIL_URL, TSUNAMI_DETAIL_URL, _detail, _tsunami_detail
from test_live_tsunami import _DestinationSource, _profile, _begin_reconnect


def quake(*, seconds=0, serial="1", event_id="20261006010000", info="発表", pref="04", intensity="3", office="気象庁本庁"):
    body = _detail(info_type=info, pref_code=pref).decode()
    body = body.replace("東京都", "宮城県" if pref == "04" else "東京都")
    body = body.replace("<Serial>1</Serial>", f"<Serial>{serial}</Serial>")
    body = body.replace("<EventID>20261006010000</EventID>", f"<EventID>{event_id}</EventID>")
    body = body.replace("<MaxInt>3</MaxInt>", f"<MaxInt>{intensity}</MaxInt>")
    issued = (NOW + timedelta(seconds=seconds)).isoformat()
    # Business report time stays the same: reusing Head.ReportDateTime/Serial
    # must not cause a later official revision to be discarded.
    body = body.replace("<DateTime>2026-10-06T01:00:00Z</DateTime>", f"<DateTime>{issued}</DateTime>")
    body = body.replace("気象庁本庁", office)
    if info == "取消":
        body = body[:body.index("<Body>")] + "<Body><Text>先ほどの情報を取り消します。</Text></Body></Report>"
    return body.encode()


def parsed(body):
    return _parse_jma_detail(DETAIL_URL, body, NOW + timedelta(hours=1))


def feed(documents):
    entries = "".join(
        f'<entry><title>震源・震度に関する情報</title><updated>{(NOW + timedelta(seconds=i)).isoformat()}</updated>'
        f'<link type="application/xml" href="{url}"/></entry>'
        for i, url in enumerate(documents)
    )
    return f'<feed xmlns="http://www.w3.org/2005/Atom">{entries}</feed>'.encode()


class FixtureFeed:
    def __init__(self, documents):
        self.documents = documents
        self.wall = [NOW + timedelta(seconds=30)]
        self.mono = [0.0]
        self.calls = 0

    def fetch(self, url, headers):
        self.calls += 1
        return HttpPayload(200, feed(self.documents) if url == JMA_FEED_URL else self.documents[url], {})

    def source(self):
        return JmaEarthquakeSource(self.fetch, now=lambda: self.wall[0], clock=lambda: self.mono[0])

    def step(self, documents, seconds=61):
        self.documents = documents
        self.mono[0] += seconds
        self.wall[0] += timedelta(seconds=seconds)


def test_official_clock_revision_office_failover_and_same_serial_cancel():
    first = parsed(quake()).bulletin
    revised = parsed(quake(seconds=5, serial="1", intensity="5+", office="大阪管区気象台")).bulletin
    cancellation = parsed(quake(seconds=10, serial="1", info="取消", office="大阪管区気象台")).bulletin
    assert first.group_id == revised.group_id == cancellation.group_id
    assert first.reported_at == revised.reported_at == cancellation.reported_at
    assert len({first.report_id, revised.report_id, cancellation.report_id}) == 3
    state = reduce_official_bulletin(None, first)
    state = reduce_official_bulletin(state, revised)
    assert state.head == revised
    state = reduce_official_bulletin(state, cancellation)
    assert state.validity(NOW + timedelta(days=1), 900) == BulletinValidity.CANCELLED
    assert state.head.occurred_at is None  # No invented time for Body/Text cancellation.
    assert reduce_official_bulletin(state, first).head == cancellation
    assert len(state.history) == 3


def test_duplicate_receipt_never_renews_ttl_and_conflict_cannot_clear_on_replay():
    first = parsed(quake()).bulletin
    state = reduce_official_bulletin(None, first)
    assert reduce_official_bulletin(state, first.model_copy(update={"received_at": NOW + timedelta(hours=2)})) is state
    assert state.validity(NOW + timedelta(seconds=899), 900) == BulletinValidity.CURRENT
    assert state.validity(NOW + timedelta(seconds=900), 900) == BulletinValidity.STALE
    contradictory = parsed(quake(intensity="7")).bulletin
    conflicted = reduce_official_bulletin(state, contradictory)
    assert conflicted.conflict and not state.conflict  # Pure reducer, no mutation.
    assert reduce_official_bulletin(conflicted, first).conflict
    assert reduce_official_bulletin(conflicted, parsed(quake(seconds=1)).bulletin).conflict is False


def test_distinct_information_units_cannot_be_reduced_together():
    first = parsed(quake()).bulletin
    other = parsed(quake(event_id="20261006020000")).bulletin
    with pytest.raises(ValueError, match="different"):
        reduce_official_bulletin(reduce_official_bulletin(None, first), other)


@pytest.mark.parametrize("mutate", [
    lambda x: x.replace(b"<DateTime>", b"<MissingTime>").replace(b"</DateTime>", b"</MissingTime>"),
    lambda x: x.replace(b"1.0_1", b"99.0"),
    lambda x: x.replace(b"20261006010000", b"not-official-id"),
    lambda x: x.replace(b"<InfoType>" + "発表".encode(), b"<InfoType>" + "訂正".encode()),
    lambda x: x.replace(b"<Serial>1</Serial>", b"<Serial></Serial>"),
])
def test_missing_official_identity_time_version_or_unsupported_operation_fails_closed(mutate):
    with pytest.raises((ValueError, ValidationError)):
        parsed(mutate(quake()))


def test_earthquake_parser_rejects_unofficial_reference_and_future_control_time():
    with pytest.raises(ValueError, match="allowlisted"):
        _parse_jma_detail("https://example.com/a.xml", quake(), NOW)
    with pytest.raises(ValueError, match="future"):
        _parse_jma_detail(DETAIL_URL, quake(seconds=1), NOW)


def test_feed_older_duplicate_and_empty_window_never_revive_cancelled_information():
    fixture = FixtureFeed({DETAIL_URL: quake()})
    source = fixture.source()
    source.fetch_latest()
    fixture.step({DETAIL_URL: quake(seconds=10, info="取消")})
    cancelled = source.fetch_latest()
    assert cancelled.reports[0].observations == ()
    assert cancelled.reports[0].withdrawn_observations[0].area_id == "JP-04"
    assert cancelled.reports[0].occurred_at is not None  # Prior official origin, not receipt.
    fixture.step({DETAIL_URL: quake()})
    assert source.fetch_latest().reports == cancelled.reports
    fixture.step({})
    assert source.fetch_latest().reports == cancelled.reports


def test_same_control_timestamp_conflict_survives_304_and_fails_session_closed():
    fixture = FixtureFeed({DETAIL_URL: quake()})
    source = fixture.source()
    store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: fixture.wall[0])
    first = store.start({"language": "zh-TW", "profile": _profile()})
    fixture.step({DETAIL_URL: quake(intensity="7")})
    conflicted = store.refresh(first.session_id)
    assert conflicted.source.status == LiveSourceStatus.INVALID_RESPONSE
    assert all(not item.eligible_for_claims for item in conflicted.evidence_projections)
    source._fetch = lambda *_: HttpPayload(304, b"", {})
    fixture.step({})
    assert source.fetch_latest().status == LiveSourceStatus.INVALID_RESPONSE


@pytest.mark.parametrize("async_path", [False, True])
def test_live_republication_and_cancel_invalidate_dependencies_preserving_plan_history(async_path):
    fixture = FixtureFeed({DETAIL_URL: quake()})
    store = LiveStore(jma_source=fixture.source(), destination_source=_DestinationSource(), now=lambda: fixture.wall[0])
    start = store.start({"language": "zh-TW", "profile": _profile()})
    first_plan_ids = tuple(item.id for item in start.plans)
    fixture.step({DETAIL_URL: quake(seconds=5, intensity="5+")})
    updated = asyncio.run(store.refresh_async(start.session_id)) if async_path else store.refresh(start.session_id)
    first_evidence = updated.evidence[0]
    assert first_evidence.trust_status.value == "STALE"
    assert start.events[0].id not in updated.situation.active_event_ids
    assert any(item.status.value in {"INVALIDATED", "PARTIAL_INVALIDATION"} for item in updated.plan_evaluations)
    assert tuple(item.id for item in updated.plans[:len(first_plan_ids)]) == first_plan_ids
    fixture.step({DETAIL_URL: quake(seconds=10, info="取消")})
    cancelled = asyncio.run(store.refresh_async(start.session_id)) if async_path else store.refresh(start.session_id)
    assert cancelled.events[-1].status == DisasterEventStatus.UNKNOWN
    assert cancelled.evidence[-1].disaster_assessments[0].status == DisasterEventStatus.UNKNOWN
    assert all(item.status != DisasterEventStatus.RESOLVED for item in cancelled.events)
    assert cancelled.spatial_guidance.movement_authorized is False
    fixture.step({DETAIL_URL: quake()})
    older = store.refresh(start.session_id)
    assert len(older.events) == len(cancelled.events)
    assert older.events[-1].status == DisasterEventStatus.UNKNOWN


def test_cancel_one_earthquake_cannot_remove_an_independent_active_event():
    other_url = DETAIL_URL.replace("010000", "020000")
    fixture = FixtureFeed({DETAIL_URL: quake(), other_url: quake(event_id="20261006020000")})
    store = LiveStore(jma_source=fixture.source(), destination_source=_DestinationSource(), now=lambda: fixture.wall[0])
    first = store.start({"language": "zh-TW", "profile": _profile()})
    fixture.step({DETAIL_URL: quake(seconds=5, info="取消")})
    current = store.refresh(first.session_id)
    assert len(current.situation.active_event_ids) == 2
    claim = next(item for item in current.situation.claim_states if item.key == "disaster.EARTHQUAKE.JP-04.status")
    assert claim.value == "ACTIVE"


def test_reconnect_requires_each_earthquake_information_unit():
    other_url = DETAIL_URL.replace("010000", "020000")
    fixture = FixtureFeed({DETAIL_URL: quake(), other_url: quake(event_id="20261006020000")})
    store = LiveStore(jma_source=fixture.source(), destination_source=_DestinationSource(), now=lambda: fixture.wall[0])
    first = store.start({"language": "zh-TW", "profile": _profile()})
    _begin_reconnect(store, first, fixture.wall[0] + timedelta(seconds=10))
    fixture.step({DETAIL_URL: quake(seconds=41)})
    one = store.refresh(first.session_id)
    assert one.situation.network_state == NetworkState.RECONNECTING
    fixture.step({other_url: quake(seconds=102, event_id="20261006020000")})
    both = store.refresh(first.session_id)
    assert both.situation.network_state == NetworkState.ONLINE_VERIFIED


def test_revised_scope_withdraws_omitted_prefecture_instead_of_reusing_its_intensity():
    fixture = FixtureFeed({DETAIL_URL: quake()})
    store = LiveStore(jma_source=fixture.source(), destination_source=_DestinationSource(), now=lambda: fixture.wall[0])
    first = store.start({"language": "zh-TW", "profile": _profile()})
    fixture.step({DETAIL_URL: quake(seconds=5, pref="13")})
    changed = store.refresh(first.session_id)
    assessment = next(item for item in changed.evidence[-1].disaster_assessments if item.area_id == "JP-04")
    assert assessment.status == DisasterEventStatus.UNKNOWN
    assert not any(item.key == "jma.earthquake.max_intensity.jp-04" for item in changed.evidence[-1].claims)


def test_tsunami_withdrawal_is_unknown_but_official_area_lifting_is_resolved_reference():
    wall, mono = [NOW], [0.0]
    doc = [_tsunami_detail()]
    def fetch(url, headers):
        if url == JMA_FEED_URL:
            return HttpPayload(200, f'<feed><entry><title>津波警報・注意報・予報</title><updated>{wall[0].isoformat()}</updated><link type="application/xml" href="{TSUNAMI_DETAIL_URL}"/></entry></feed>'.encode(), {})
        return HttpPayload(200, doc[0], {})
    source = JmaTsunamiSource(fetch, now=lambda: wall[0], clock=lambda: mono[0])
    source.fetch_latest()
    wall[0] += timedelta(seconds=61)
    mono[0] += 61
    doc[0] = _tsunami_detail(info_type="取消", report_at=wall[0].isoformat(), origin="")
    assert tsunami_reference_from_result(source.fetch_latest()).status.value == "UNKNOWN"
    wall[0] += timedelta(seconds=61)
    mono[0] += 61
    doc[0] = _tsunami_detail(kind="00", report_at=wall[0].isoformat())
    assert tsunami_reference_from_result(source.fetch_latest()).status.value == "CANCELLED"


def test_current_official_tsunami_samples_preserve_multi_origin_and_cancel_metadata():
    directory = Path(__file__).parent / "fixtures" / "jma_lifecycle"
    multi = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, (directory / "38-39_02_04_250206_VTSE41.xml").read_bytes(), NOW)
    assert len(multi.bulletin.event_id.split()) == 2
    assert len(multi.bulletin.occurrence_times) == 2
    assert multi.occurred_at == min(multi.bulletin.occurrence_times)
    cancel = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, (directory / "38-39_03_01_210805_VTSE41.xml").read_bytes(), NOW)
    assert cancel.occurred_at is None and cancel.serial is None
    assert cancel.bulletin.operation.value == "CANCEL"


def test_current_format_official_311_sample_preserves_scoped_observations_and_envelope_roundtrip():
    from agent_api.official_events import OfficialBulletin
    directory = Path(__file__).parent / "fixtures" / "jma_lifecycle"
    report = _parse_jma_detail(DETAIL_URL, (directory / "32-39_11_05_240613_VXSE53.xml").read_bytes(), NOW)
    assert report.bulletin.event_id == "20110311144640"
    assert report.observations
    assert report.bulletin.info_kind_version == "1.0_1"
    assert OfficialBulletin.model_validate_json(report.bulletin.model_dump_json()) == report.bulletin


def test_official_historical_vxse53_sample_is_retained_but_not_silently_accepted_as_current_format():
    directory = Path(__file__).parent / "fixtures" / "jma_lifecycle"
    raw = (directory / "32-35_06_06_100915_VXSE53.xml").read_bytes()
    with pytest.raises(ValidationError):
        _parse_jma_detail(DETAIL_URL, raw, NOW)


def test_pinned_official_samples_are_unmodified_and_match_manifest():
    import hashlib
    import json
    directory = Path(__file__).parent / "fixtures" / "jma_lifecycle"
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    for sample in manifest["samples"]:
        raw = (directory / sample["file"]).read_bytes()
        assert len(raw) == sample["bytes"]
        assert hashlib.sha256(raw).hexdigest() == sample["sha256"]


def test_malformed_multi_detail_batch_does_not_partially_replace_current_evidence():
    fixture = FixtureFeed({DETAIL_URL: quake()})
    source = fixture.source()
    previous = source.fetch_latest()
    invalid_url = DETAIL_URL.replace("010000", "030000")
    fixture.step({DETAIL_URL: quake(seconds=5, intensity="7"), invalid_url: b"<broken>"})
    failed = source.fetch_latest()
    assert failed.status == LiveSourceStatus.BACKOFF
    assert failed.reports == previous.reports
    assert failed.last_published_at == previous.last_published_at


def test_cold_start_cancel_does_not_invent_origin_or_area_or_clear_another_event():
    fixture = FixtureFeed({DETAIL_URL: quake(info="取消")})
    store = LiveStore(jma_source=fixture.source(), destination_source=_DestinationSource(), now=lambda: fixture.wall[0])
    result = store.start({"language": "zh-TW", "profile": _profile()})
    assert result.events == () and result.evidence == ()
    assert result.spatial_guidance.movement_authorized is False


class MutableResultSource:
    def __init__(self, result):
        self.result = result
        self.snapshot_metadata = {}

    def fetch_snapshot_metadata(self, references):
        return {url: self.snapshot_metadata[url] for url in references if url in self.snapshot_metadata}

    def fetch_latest(self):
        return self.result


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
@pytest.mark.parametrize("async_path", [False, True])
@pytest.mark.parametrize("operation", ["発表", "取消"])
def test_legacy_snapshot_migrates_exact_unit_and_cold_cancellation_preserves_real_scope(product, async_path, operation):
    from agent_api.live_sources import JmaFetchResult
    from test_live_tsunami import _tsunami_result, _EarthquakeSource
    wall = [NOW + timedelta(seconds=30)]
    if product == "VXSE53":
        report = replace(parsed(quake()), report_id="20261006010000-1", bulletin=None)
        source = MutableResultSource(JmaFetchResult(
            status=LiveSourceStatus.FRESH, retrieved_at=wall[0], last_published_at=report.published_at,
            next_retry_at=None, reports=(report,), detail="legacy snapshot fixture",
        ))
        store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: wall[0])
    else:
        source = MutableResultSource(_tsunami_result(NOW + timedelta(seconds=5)))
        store = LiveStore(jma_source=_EarthquakeSource(lambda: wall[0]), tsunami_source=source,
                          destination_source=_DestinationSource(), now=lambda: wall[0])
    if product == "VXSE53":
        source.snapshot_metadata[DETAIL_URL] = parsed(quake()).bulletin
    else:
        original = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, _tsunami_detail(), wall[0])
        source.snapshot_metadata[TSUNAMI_DETAIL_URL] = original.bulletin
        source.result = replace(source.result, bulletins=(replace(original, bulletin=None),), last_published_at=original.published_at)
    first = store.start({"language": "zh-TW", "profile": _profile()})
    prior = next(item for item in first.events if item.event_type.value == ("EARTHQUAKE" if product == "VXSE53" else "TSUNAMI"))
    evidence_id = f"ev_{prior.id}"
    plan_ids = tuple(item.id for item in first.plans)
    wall[0] += timedelta(seconds=61)
    if product == "VXSE53":
        fresh = parsed(quake(seconds=41, info=operation, pref="13"))
        source.result = replace(source.result, reports=(fresh,), retrieved_at=wall[0], last_published_at=fresh.published_at)
    else:
        fresh = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL,
            _tsunami_detail(info_type=operation, report_at=(NOW + timedelta(seconds=41)).isoformat(),
                            origin="" if operation == "取消" else "2026-10-06T00:58:00Z"), wall[0])
        # Cold source: no cached forecast areas or origin for the cancellation.
        if operation == "取消":
            assert fresh.occurred_at is None and fresh.forecast_areas == ()
        source.result = replace(source.result, bulletins=(fresh,), retrieved_at=wall[0], last_published_at=fresh.published_at)
    result = asyncio.run(store.refresh_async(first.session_id)) if async_path else store.refresh(first.session_id)
    retired = next(item for item in result.events if item.id == prior.id)
    assert retired.status == DisasterEventStatus.UNKNOWN
    assert prior.id not in result.situation.active_event_ids
    assert next(item for item in result.evidence if item.id == evidence_id).trust_status.value == "STALE"
    assert not next(item for item in result.evidence_projections if item.evidence_id == evidence_id).eligible_for_claims
    replacement = result.events[-1]
    assert "--" in replacement.id
    if operation == "取消":
        assert replacement.occurred_at == prior.occurred_at
        assert replacement.affected_area_ids == prior.affected_area_ids
        assert replacement.status == DisasterEventStatus.UNKNOWN
        claim = next(item for item in result.situation.claim_states if item.key == f"disaster.{prior.event_type.value}.JP-04.status")
        assert claim.value != "ACTIVE"
    assert tuple(item.id for item in result.plans[:len(plan_ids)]) == plan_ids
    assert result.spatial_guidance.movement_authorized is False


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_legacy_alias_scope_is_exact_and_newer_snapshot_cannot_be_overwritten(product):
    from agent_api.domain import apply_live_evidence_batch
    from test_live_tsunami import _EarthquakeSource, _tsunami_result, _TsunamiSource
    wall = NOW + timedelta(seconds=100)
    store = LiveStore(jma_source=_EarthquakeSource(lambda: wall),
                      tsunami_source=_TsunamiSource(_tsunami_result(wall)),
                      destination_source=_DestinationSource(), now=lambda: wall)
    first = store.start({"language": "zh-TW", "profile": _profile()})
    state = store._get_aggregate(first.session_id).state
    if product == "VXSE53":
        report = parsed(quake(seconds=41))
        event, proof = store._event_evidence_pair(state, replace(report, bulletin=None, report_id="20261006010000-1", published_at=wall), wall)
        state = apply_live_evidence_batch(state, ((event, proof),), wall)
        assert store._event_evidence_pair(state, report, wall) is None
        unrelated = parsed(quake(seconds=42, event_id="20261006020000")).bulletin
    else:
        report = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, _tsunami_detail(report_at=(NOW + timedelta(seconds=41)).isoformat()), wall)
        assert store._tsunami_event_evidence_pair(state, report, wall) is None
        compound = _tsunami_detail().replace(b"<EventID>20261006010000</EventID>", b"<EventID>20261006010000 20261006020000</EventID>")
        unrelated = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, compound, wall).bulletin
    assert store._prior_official_records(state, unrelated) == ()


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_reconnect_migrates_legacy_group_before_requiring_fresh_canonical_proof(product):
    from agent_api.live_sources import JmaFetchResult
    from test_live_tsunami import _tsunami_result
    wall = [NOW + timedelta(seconds=30)]
    empty = JmaFetchResult(status=LiveSourceStatus.FRESH, retrieved_at=wall[0],
        last_published_at=NOW, next_retry_at=None, reports=(), detail="empty earthquake fixture")
    if product == "VXSE53":
        report = replace(parsed(quake()), report_id="20261006010000-1", bulletin=None)
        source = MutableResultSource(replace(empty, reports=(report,)))
        store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: wall[0])
    else:
        source = MutableResultSource(_tsunami_result(NOW + timedelta(seconds=5)))
        store = LiveStore(jma_source=MutableResultSource(empty), tsunami_source=source,
            destination_source=_DestinationSource(), now=lambda: wall[0])
    if product == "VXSE53":
        source.snapshot_metadata[DETAIL_URL] = parsed(quake()).bulletin
    else:
        original = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, _tsunami_detail(), wall[0])
        source.snapshot_metadata[TSUNAMI_DETAIL_URL] = original.bulletin
        source.result = replace(source.result, bulletins=(replace(original, bulletin=None),), last_published_at=original.published_at)
    first = store.start({"language": "zh-TW", "profile": _profile()})
    old_id = first.events[0].id
    _begin_reconnect(store, first, wall[0] + timedelta(seconds=10))
    wall[0] += timedelta(seconds=61)
    if product == "VXSE53":
        fresh = parsed(quake(seconds=41))
        source.result = replace(source.result, reports=(fresh,), retrieved_at=wall[0], last_published_at=fresh.published_at)
    else:
        fresh = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL,
            _tsunami_detail(report_at=(NOW + timedelta(seconds=41)).isoformat()), wall[0])
        source.result = replace(source.result, bulletins=(fresh,), retrieved_at=wall[0], last_published_at=fresh.published_at)
    reconciled = store.refresh(first.session_id)
    assert old_id not in reconciled.situation.active_event_ids
    assert reconciled.situation.network_state == NetworkState.ONLINE_VERIFIED
    assert any(item.event_type == "RECONCILIATION_COMPLETED" for item in reconciled.trace)



@pytest.mark.parametrize("operation", ["発表", "取消"])
def test_mixed_legacy_and_canonical_earthquake_units_need_independent_reconnect_proofs(operation):
    from agent_api.live_sources import JmaFetchResult
    wall = [NOW + timedelta(seconds=30)]
    first_report = replace(parsed(quake()), bulletin=None, report_id="20261006010000-1")
    second_report = replace(parsed(quake(event_id="20261006020000")), bulletin=None, report_id="20261006020000-1", reference_url=DETAIL_URL.replace("010000", "020000"))
    source = MutableResultSource(JmaFetchResult(status=LiveSourceStatus.FRESH, retrieved_at=wall[0],
        last_published_at=NOW, next_retry_at=None, reports=(first_report, second_report), detail="legacy fixture"))
    store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: wall[0])
    source.snapshot_metadata[first_report.reference_url] = parsed(quake()).bulletin
    source.snapshot_metadata[second_report.reference_url] = parsed(quake(event_id="20261006020000")).bulletin.model_copy(update={"reference_url": second_report.reference_url})
    first = store.start({"language": "zh-TW", "profile": _profile()})
    _begin_reconnect(store, first, wall[0] + timedelta(seconds=10))
    wall[0] += timedelta(seconds=61)
    revision = parsed(quake(seconds=41, info=operation))
    source.result = replace(source.result, reports=(revision,), retrieved_at=wall[0], last_published_at=revision.published_at)
    one = store.refresh(first.session_id)
    assert one.situation.network_state == NetworkState.RECONNECTING
    claim = next(item for item in one.situation.claim_states if item.key == "disaster.EARTHQUAKE.JP-04.status")
    assert claim.value == "ACTIVE"  # Another unmigrated unit still has current warning evidence.
    wall[0] += timedelta(seconds=61)
    second_revision = parsed(quake(seconds=102, event_id="20261006020000"))
    source.result = replace(source.result, reports=(second_revision,), retrieved_at=wall[0], last_published_at=second_revision.published_at)
    both = store.refresh(first.session_id)
    assert both.situation.network_state == NetworkState.ONLINE_VERIFIED
    assert both.spatial_guidance.movement_authorized is False


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
@pytest.mark.parametrize("original_control", [20, 120])
def test_legacy_business_clock_is_not_misused_as_system_revision_clock(product, original_control):
    from agent_api.live_sources import JmaFetchResult
    from test_live_tsunami import _tsunami_result
    wall = [NOW + timedelta(seconds=30)]
    empty = JmaFetchResult(status=LiveSourceStatus.FRESH, retrieved_at=wall[0], last_published_at=NOW,
        next_retry_at=None, reports=(), detail="empty fixture")
    if product == "VXSE53":
        latest = parsed(quake(seconds=original_control, serial="2", pref="13"))
        # Actual parent parser projection: only Head.ReportDateTime persisted.
        legacy = replace(latest, report_id="20261006010000-2", bulletin=None,
                         published_at=latest.bulletin.reported_at)
        source = MutableResultSource(replace(empty, reports=(legacy,)))
        store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: wall[0])
    else:
        raw = _tsunami_detail().replace(b"<DateTime>2026-10-06T01:00:00Z</DateTime>",
            f"<DateTime>{(NOW + timedelta(seconds=original_control)).isoformat()}</DateTime>".encode())
        latest = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, raw, NOW + timedelta(hours=1))
        legacy = replace(latest, bulletin=None, published_at=latest.bulletin.reported_at)
        source = MutableResultSource(replace(_tsunami_result(wall[0]), bulletins=(legacy,), last_published_at=legacy.published_at))
        store = LiveStore(jma_source=MutableResultSource(empty), tsunami_source=source,
            destination_source=_DestinationSource(), now=lambda: wall[0])
    source.snapshot_metadata[latest.reference_url] = latest.bulletin
    first = store.start({"language": "zh-TW", "profile": _profile()})
    prior = first.events[0]
    wall[0] += timedelta(seconds=151)
    incoming_control = 10 if original_control == 20 else 41
    if product == "VXSE53":
        old = parsed(quake(seconds=incoming_control, serial="1", pref="04"))
        source.result = replace(source.result, reports=(old,), retrieved_at=wall[0], last_published_at=old.published_at)
    else:
        raw = _tsunami_detail().replace(b"<DateTime>2026-10-06T01:00:00Z</DateTime>",
            f"<DateTime>{(NOW + timedelta(seconds=incoming_control)).isoformat()}</DateTime>".encode())
        old = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, raw, NOW + timedelta(hours=1))
        source.result = replace(source.result, bulletins=(old,), retrieved_at=wall[0], last_published_at=old.published_at)
    result = store.refresh(first.session_id)
    assert len(result.events) == len(first.events)  # Never activate the older scope.
    assert result.events[0] == prior
    assert result.evidence[0] == first.evidence[0]
    assert result.spatial_guidance.movement_authorized is False


@pytest.mark.parametrize("failure", ["unavailable", "business_clock", "serial", "url", "title", "equal_clock_conflict"])
@pytest.mark.parametrize("async_path", [False, True])
def test_unverifiable_legacy_original_fails_closed(failure, async_path):
    from agent_api.live_sources import JmaFetchResult
    wall = [NOW + timedelta(seconds=30)]
    original = parsed(quake())
    legacy = replace(original, report_id="20261006010000-1", bulletin=None)
    source = MutableResultSource(JmaFetchResult(status=LiveSourceStatus.FRESH, retrieved_at=wall[0],
        last_published_at=NOW, next_retry_at=None, reports=(legacy,), detail="legacy fixture"))
    metadata = original.bulletin
    if failure == "business_clock":
        metadata = metadata.model_copy(update={"reported_at": NOW - timedelta(seconds=1)})
    elif failure == "serial":
        metadata = metadata.model_copy(update={"serial": "2"})
    elif failure == "url":
        metadata = metadata.model_copy(update={"reference_url": DETAIL_URL.replace("010000", "020000")})
    elif failure == "title":
        metadata = metadata.model_copy(update={"title": "別の公式情報単位"})
    elif failure == "equal_clock_conflict":
        metadata = metadata.model_copy(update={"issued_at": NOW + timedelta(seconds=41)})
    if failure != "unavailable":
        source.snapshot_metadata[DETAIL_URL] = metadata
    store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: wall[0])
    first = store.start({"language": "zh-TW", "profile": _profile()})
    wall[0] += timedelta(seconds=61)
    incoming = parsed(quake(seconds=41, intensity="7"))
    source.result = replace(source.result, reports=(incoming,), retrieved_at=wall[0], last_published_at=incoming.published_at)
    result = asyncio.run(store.refresh_async(first.session_id)) if async_path else store.refresh(first.session_id)
    assert len(result.events) == 1
    assert result.events[0].status == DisasterEventStatus.UNKNOWN
    assert result.evidence[0].trust_status.value == "STALE"
    assert result.source.status == LiveSourceStatus.INVALID_RESPONSE
    assert result.situation.network_state == NetworkState.ONLINE_DEGRADED
    assert result.spatial_guidance.movement_authorized is False


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_identical_original_migration_cannot_count_as_post_reconnect_publication(product):
    from agent_api.live_sources import JmaFetchResult
    from test_live_tsunami import _tsunami_result
    wall = [NOW + timedelta(seconds=30)]
    empty = JmaFetchResult(status=LiveSourceStatus.FRESH, retrieved_at=wall[0], last_published_at=NOW,
        next_retry_at=None, reports=(), detail="empty fixture")
    if product == "VXSE53":
        original = parsed(quake())
        legacy = replace(original, report_id="20261006010000-1", bulletin=None)
        source = MutableResultSource(replace(empty, reports=(legacy,)))
        store = LiveStore(jma_source=source, destination_source=_DestinationSource(), now=lambda: wall[0])
    else:
        original = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, _tsunami_detail(), wall[0])
        source = MutableResultSource(replace(_tsunami_result(wall[0]), bulletins=(replace(original, bulletin=None),), last_published_at=original.published_at))
        store = LiveStore(jma_source=MutableResultSource(empty), tsunami_source=source,
            destination_source=_DestinationSource(), now=lambda: wall[0])
    source.snapshot_metadata[original.reference_url] = original.bulletin
    first = store.start({"language": "zh-TW", "profile": _profile()})
    _begin_reconnect(store, first, wall[0] + timedelta(seconds=10))
    wall[0] += timedelta(seconds=61)
    source.result = replace(source.result, reports=(original,)) if product == "VXSE53" else replace(source.result, bulletins=(original,))
    result = store.refresh(first.session_id)
    assert first.events[0].id not in result.situation.active_event_ids
    assert result.situation.network_state == NetworkState.RECONNECTING
    assert result.evidence[-1].published_at == original.bulletin.issued_at
    assert result.evidence[-1].expires_at == original.bulletin.issued_at + timedelta(seconds=900)


@pytest.mark.parametrize("product", ["VXSE53", "VTSE41"])
def test_snapshot_original_fetch_is_allowlisted_bounded_cached_and_not_source_evidence(product):
    mono = [0.0]
    calls = []
    def fetch(url, headers):
        calls.append(url)
        return HttpPayload(200, quake() if product == "VXSE53" else _tsunami_detail(), {})
    cls = JmaEarthquakeSource if product == "VXSE53" else JmaTsunamiSource
    source = cls(fetch, now=lambda: NOW + timedelta(seconds=30), clock=lambda: mono[0])
    urls = tuple(DETAIL_URL.replace("010000", f"{i:06}") for i in range(7))
    references = ("https://example.com/private.xml", *urls)
    metadata = source.fetch_snapshot_metadata(references)
    assert len(calls) == len(metadata) == 4  # Bad URL consumes one bounded slot without HTTP.
    assert all(url.startswith("https://www.data.jma.go.jp/developer/xml/data/") for url in calls)
    first_received = next(iter(metadata.values())).received_at
    assert source.fetch_snapshot_metadata(references) == metadata
    assert len(calls) == 4
    mono[0] += 61
    completed = source.fetch_snapshot_metadata(references)
    assert len(completed) == 7
    assert completed[urls[0]].received_at == first_received
    assert source._lifecycle == {}  # Historical identity recovery cannot create live heads.
