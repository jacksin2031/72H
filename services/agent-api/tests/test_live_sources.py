from datetime import datetime, timedelta, timezone

import pytest

from agent_api.live_sources import (
    JMA_FEED_URL,
    JMA_EVIDENCE_TTL_SECONDS,
    JMA_SOURCE_KEY,
    TOKYO_SHELTER_PUBLISHED_AT,
    TOKYO_SHELTER_URL,
    HttpPayload,
    JmaEarthquakeSource,
    TokyoShelterSource,
    _parse_jma_detail,
    _validate_xml_size,
    normalize_tokyo_shelters,
)
from seventytwoh_contracts.models import LiveSourceStatus

NOW = datetime(2026, 10, 6, 1, 0, tzinfo=timezone.utc)
DETAIL_URL = "https://www.data.jma.go.jp/developer/xml/data/20261006010000_0_VXSE53_010000.xml"


def _detail(*, control="通常", info_type="発表", report_at="2026-10-06T01:00:00Z", origin_at="2026-10-06T00:58:00Z", pref_code="13"):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="urn:test"><Control><Title>震源・震度に関する情報</Title><Status>{control}</Status></Control>
<Head><ReportDateTime>{report_at}</ReportDateTime><InfoType>{info_type}</InfoType><InfoKind>地震情報</InfoKind><EventID>20261006010000</EventID><Serial>1</Serial></Head>
<Body><Earthquake><OriginTime>{origin_at}</OriginTime></Earthquake><Intensity><Observation><Pref><Name>東京都</Name><Code>{pref_code}</Code><MaxInt>3</MaxInt></Pref></Observation></Intensity></Body></Report>""".encode()


def _feed(updated="2026-10-06T01:00:00Z"):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>震源・震度に関する情報</title><updated>{updated}</updated>
<link rel="related" type="application/xml" href="{DETAIL_URL}"/></entry></feed>""".encode()


def test_jma_normal_report_is_typed_with_exact_prefecture_scope_and_unknown_code_unscoped():
    parsed = _parse_jma_detail(DETAIL_URL, _detail(), NOW)
    assert parsed.observations[0].area_id == "JP-13"
    assert parsed.observations[0].max_intensity == "3"

    unscoped = _parse_jma_detail(DETAIL_URL, _detail(pref_code="99"), NOW)
    assert unscoped.observations[0].area_id is None
    assert unscoped.observations[0].name == "東京都"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"control": "試験"},
        {"info_type": "取消"},
        {"info_type": "訂正"},
        {"report_at": ""},
        {"origin_at": ""},
        {"report_at": "2026-10-06T01:01:00Z"},
    ],
)
def test_jma_rejects_test_correction_cancel_missing_time_and_future_publication(kwargs):
    with pytest.raises(ValueError):
        _parse_jma_detail(DETAIL_URL, _detail(**kwargs), NOW)


def test_jma_xml_boundary_scans_full_bounded_payload_and_rejects_utf16():
    with pytest.raises(ValueError, match="forbidden"):
        _validate_xml_size(b" " * 8192 + b"<!DOCTYPE x><x/>", 20_000)
    with pytest.raises(ValueError):
        _validate_xml_size("<x/>".encode("utf-16"), 100)
    with pytest.raises(ValueError):
        _validate_xml_size(b"<x/>\x00", 100)


def test_jma_304_updates_retrieval_but_never_publication_freshness():
    mono = [0.0]
    wall = [NOW]
    calls = []
    responses = [
        HttpPayload(200, _feed(), {"etag": "feed-v1"}),
        HttpPayload(200, _detail(), {}),
        HttpPayload(304, b"", {}),
        HttpPayload(304, b"", {}),
    ]

    def fetch(url, headers):
        calls.append((url, dict(headers)))
        return responses.pop(0)

    source = JmaEarthquakeSource(fetch, now=lambda: wall[0], clock=lambda: mono[0])
    first = source.fetch_latest()
    assert first.status == LiveSourceStatus.FRESH
    published = first.last_published_at
    first_retrieved = first.retrieved_at

    mono[0] += 61
    wall[0] += timedelta(seconds=61)
    second = source.fetch_latest()
    assert second.status == LiveSourceStatus.FRESH
    assert second.last_published_at == published
    assert second.retrieved_at > first_retrieved
    assert calls[2][1]["If-None-Match"] == "feed-v1"

    mono[0] += 15 * 60
    wall[0] += timedelta(seconds=15 * 60)
    third = source.fetch_latest(force=True)
    assert third.status == LiveSourceStatus.STALE
    assert third.last_published_at == published


def test_jma_cached_poll_projects_stale_at_exact_publication_deadline_without_renewing_times():
    mono = [0.0]
    wall = [NOW]
    calls = []
    responses = [HttpPayload(200, _feed(), {}), HttpPayload(200, _detail(), {})]

    def fetch(url, headers):
        calls.append((url, dict(headers)))
        return responses.pop(0)

    source = JmaEarthquakeSource(fetch, now=lambda: wall[0], clock=lambda: mono[0])
    first = source.fetch_latest()
    assert first.status == LiveSourceStatus.FRESH
    published = first.last_published_at
    retrieved = first.retrieved_at

    mono[0] += 30  # still inside the >=60 second official-feed polling cadence
    wall[0] += timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS - 1)
    before_deadline = source.fetch_latest()
    assert before_deadline.status == LiveSourceStatus.FRESH

    mono[0] += 1
    wall[0] += timedelta(seconds=1)
    at_deadline = source.fetch_latest()
    assert at_deadline.status == LiveSourceStatus.STALE
    assert at_deadline.last_published_at == published
    assert at_deadline.retrieved_at == retrieved
    assert len(calls) == 2


def test_jma_failure_backoff_is_global_and_cached_report_does_not_hide_failure_status():
    mono = [0.0]
    wall = [NOW]
    calls = []

    def fetch(_url, _headers):
        calls.append(mono[0])
        raise ValueError("fixture failure")

    source = JmaEarthquakeSource(fetch, now=lambda: wall[0], clock=lambda: mono[0])
    result = source.fetch_latest()
    assert result.status == LiveSourceStatus.BACKOFF
    assert result.next_retry_at == NOW + timedelta(seconds=5)
    assert source.fetch_latest().status == LiveSourceStatus.BACKOFF
    assert len(calls) == 1
    mono[0] += 5
    wall[0] += timedelta(seconds=5)
    result = source.fetch_latest()
    assert result.status == LiveSourceStatus.BACKOFF
    assert len(calls) == 2


def test_tokyo_designation_is_unknown_open_and_empty_failure_obeys_backoff():
    csv_bytes = "区市町村コード,区市町村,施設名,所在地住所,緯度,経度,地震\n13101,千代田区,避難所,東京都千代田区1-1,35.68,139.76,○\n".encode()
    records = normalize_tokyo_shelters(csv_bytes)
    assert records[0].open_status.value == "UNKNOWN"
    assert records[0].source_published_at == TOKYO_SHELTER_PUBLISHED_AT
    assert records[0].supported_hazards == ()

    mono = [0.0]
    calls = []

    def fail(_url, _headers):
        calls.append(True)
        raise ValueError("fixture failure")

    source = TokyoShelterSource(fail, clock=lambda: mono[0], now=lambda: NOW)
    first = source.fetch_latest()
    second = source.fetch_latest()
    assert first[0] == LiveSourceStatus.UNAVAILABLE
    assert second[0] == LiveSourceStatus.UNAVAILABLE
    assert first[3] == NOW + timedelta(seconds=5)
    assert len(calls) == 1
    assert TOKYO_SHELTER_URL.startswith("https://www.opendata.metro.tokyo.lg.jp/")
    assert JMA_SOURCE_KEY == "jma-live-eqvol"
    assert JMA_FEED_URL.startswith("https://www.data.jma.go.jp/")
