from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from agent_api.live_sources import (
    JMA_FEED_URL,
    JMA_EVIDENCE_TTL_SECONDS,
    JMA_SOURCE_KEY,
    JMA_TSUNAMI_PRODUCT_CODE,
    JMA_TSUNAMI_SOURCE_ID,
    GSI_SOURCE_KEY,
    GSI_HAZARD_COLUMNS,
    TOKYO_SHELTER_PUBLISHED_AT,
    TOKYO_SHELTER_URL,
    HttpPayload,
    JmaEarthquakeSource,
    JmaTsunamiSource,
    TokyoShelterSource,
    _parse_jma_detail,
    _parse_jma_tsunami_detail,
    _parse_jma_tsunami_feed,
    _validate_xml_size,
    normalize_gsi_destination_designation,
    normalize_gsi_hazard_designations,
    normalize_gsi_csv,
    normalize_tokyo_shelters,
    tsunami_reference_from_result,
)
from seventytwoh_contracts.models import (
    Coordinate,
    DestinationDesignationRole,
    DestinationHazardDesignationStatus,
    DestinationHazardType,
    DestinationRecord,
    DisasterEventType,
    LiveSourceStatus,
    TsunamiAreaStatus,
    TsunamiHeightExpression,
    TsunamiOperation,
    TsunamiReferenceStatus,
    TsunamiSourceFreshness,
    TsunamiWarningClass,
)

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


TSUNAMI_DETAIL_URL = "https://www.data.jma.go.jp/developer/xml/data/20261006010000_VTSE41_010000.xml"


def _tsunami_detail(
    *, info_type="発表", report_at="2026-10-06T01:00:00Z", serial="1", code="220",
    name="宮城県", kind="53", height="NaN", description="巨大",
    arrival="2026-10-06T01:20:00+09:00", origin="2026-10-06T00:58:00Z",
):
    areas = "" if info_type == "取消" else f"""
    <Tsunami><Forecast><Item><Area><Name>{name}</Name><Code>{code}</Code></Area>
      <Category><Kind><Name>fixture warning</Name><Code>{kind}</Code></Kind></Category>
      <FirstHeight><ArrivalTime>{arrival}</ArrivalTime></FirstHeight>
      <MaxHeight><jmx_eb:TsunamiHeight xmlns:jmx_eb=\"urn:jmaxml:element\" unit=\"m\" description=\"{description}\">{height}</jmx_eb:TsunamiHeight></MaxHeight>
    </Item></Forecast></Tsunami>"""
    earthquake = f"<Earthquake><OriginTime>{origin}</OriginTime></Earthquake>" if origin else ""
    return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Report xmlns=\"urn:test\"><Control><Title>津波警報・注意報・予報</Title><Status>通常</Status></Control>
<Head><ReportDateTime>{report_at}</ReportDateTime><InfoType>{info_type}</InfoType><InfoKind>津波警報・注意報・予報</InfoKind><EventID>20261006010000</EventID><Serial>{serial}</Serial></Head>
<Body>{earthquake}{areas}</Body></Report>""".encode()


def _tsunami_feed(url=TSUNAMI_DETAIL_URL, updated="2026-10-06T01:00:00Z"):
    return f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<feed xmlns=\"http://www.w3.org/2005/Atom\"><entry><title>津波警報・注意報・予報</title><updated>{updated}</updated>
<link rel=\"related\" type=\"application/xml\" href=\"{url}\"/></entry></feed>""".encode()


def test_jma_vtse41_parser_keeps_official_codes_times_and_symbolic_height_without_earthquake_scale():
    bulletin = _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, _tsunami_detail(), NOW)
    area = bulletin.forecast_areas[0]
    assert bulletin.operation == TsunamiOperation.UNKNOWN  # source state normalizes the first issue
    assert bulletin.event_id == "20261006010000"
    assert (area.code, area.name) == ("220", "宮城県")
    assert area.status == TsunamiAreaStatus.ACTIVE
    assert area.warning_class == TsunamiWarningClass.MAJOR_WARNING
    assert area.max_height.value_m is None
    assert area.max_height.expression == TsunamiHeightExpression.HUGE
    assert area.arrival_at is not None and area.arrival_at.utcoffset() is not None
    assert JMA_TSUNAMI_PRODUCT_CODE == "VTSE41"
    assert JMA_TSUNAMI_SOURCE_ID == "jma-bosai-xml"

    numeric = _parse_jma_tsunami_detail(
        TSUNAMI_DETAIL_URL,
        _tsunami_detail(kind="51", height="5", description="5m"),
        NOW,
    ).forecast_areas[0]
    assert numeric.warning_class == TsunamiWarningClass.WARNING
    assert numeric.max_height.value_m == 5.0
    assert numeric.max_height.expression == TsunamiHeightExpression.NUMERIC


@pytest.mark.parametrize(
    "url,detail,match",
    [
        ("http://www.data.jma.go.jp/developer/xml/data/x_VTSE41.xml", _tsunami_detail(), "outside"),
        (TSUNAMI_DETAIL_URL, _tsunami_detail(code="22"), "code/name"),
        (TSUNAMI_DETAIL_URL, _tsunami_detail(report_at="2026-10-06T01:01:00Z"), "future"),
        (TSUNAMI_DETAIL_URL, _tsunami_detail(origin=""), "origin time"),
    ],
)
def test_jma_vtse41_rejects_untrusted_or_malformed_details(url, detail, match):
    with pytest.raises(ValueError, match=match):
        _parse_jma_tsunami_detail(url, detail, NOW)


@pytest.mark.parametrize("warning_order", [("51", "71"), ("71", "51")])
def test_jma_vtse41_rejects_duplicate_forecast_area_code_in_either_warning_order(warning_order):
    first_code, second_code = warning_order
    detail = _tsunami_detail(kind=first_code)
    first_item = detail.split(b"<Item>", 1)[1].split(b"</Item>", 1)[0]
    old_kind = f"<Kind><Name>fixture warning</Name><Code>{first_code}</Code></Kind>".encode()
    new_kind = f"<Kind><Name>fixture warning</Name><Code>{second_code}</Code></Kind>".encode()
    second_item = first_item.replace(old_kind, new_kind)
    assert second_item != first_item
    duplicate = detail.replace(
        b"</Item></Forecast>", b"</Item><Item>" + second_item + b"</Item></Forecast>"
    )

    with pytest.raises(ValueError, match="duplicate forecast area code"):
        _parse_jma_tsunami_detail(TSUNAMI_DETAIL_URL, duplicate, NOW)


def test_jma_vtse41_cancellation_without_cached_area_is_typed_but_does_not_fabricate_area():
    cancellation = _parse_jma_tsunami_detail(
        TSUNAMI_DETAIL_URL,
        _tsunami_detail(info_type="取消", serial="2", report_at="2026-10-06T01:01:00Z", origin=""),
        NOW + timedelta(minutes=2),
    )
    assert cancellation.info_type == "取消"
    assert cancellation.forecast_areas == ()
    assert cancellation.occurred_at is None


def test_jma_vtse41_feed_requires_official_detail_url_and_is_product_bounded():
    assert _parse_jma_tsunami_feed(_tsunami_feed()) == [(TSUNAMI_DETAIL_URL, NOW)]
    with pytest.raises(ValueError, match="outside"):
        _parse_jma_tsunami_feed(_tsunami_feed("https://example.com/developer/xml/data/a_VTSE41.xml"))


def test_jma_tsunami_source_projects_issue_correction_cancel_and_retains_original_areas():
    mono = [0.0]
    wall = [NOW]
    versions = [
        _tsunami_detail(),
        _tsunami_detail(info_type="訂正", serial="2", report_at="2026-10-06T01:01:00Z", kind="51", height="3", description="3m"),
        _tsunami_detail(info_type="取消", serial="3", report_at="2026-10-06T01:02:00Z", origin=""),
    ]

    def fetch(url, _headers):
        if url == JMA_FEED_URL:
            current = versions[0]
            published = current.split(b"<ReportDateTime>", 1)[1].split(b"</ReportDateTime>", 1)[0].decode()
            return HttpPayload(200, _tsunami_feed(updated=published), {})
        return HttpPayload(200, versions.pop(0), {})

    source = JmaTsunamiSource(fetch, now=lambda: wall[0], clock=lambda: mono[0])
    issued = source.fetch_latest()
    assert issued.operation == TsunamiOperation.ISSUE
    assert issued.bulletins[0].forecast_areas[0].status == TsunamiAreaStatus.ACTIVE
    assert tsunami_reference_from_result(issued).status == TsunamiReferenceStatus.ACTIVE

    mono[0] += 61
    wall[0] += timedelta(seconds=61)
    corrected = source.fetch_latest(force=True)
    assert corrected.operation == TsunamiOperation.CORRECTION
    assert corrected.bulletins[0].serial == "2"
    assert corrected.bulletins[0].forecast_areas[0].warning_class == TsunamiWarningClass.WARNING

    mono[0] += 61
    wall[0] += timedelta(seconds=61)
    cancelled = source.fetch_latest(force=True)
    assert cancelled.operation == TsunamiOperation.CANCEL
    assert cancelled.bulletins[0].forecast_areas[0].status == TsunamiAreaStatus.CANCELLED
    assert tsunami_reference_from_result(cancelled).status == TsunamiReferenceStatus.CANCELLED
    assert cancelled.bulletins[0].occurred_at == NOW - timedelta(minutes=2)


def test_jma_tsunami_expiry_304_and_conflict_keep_reference_fail_closed():
    mono = [0.0]
    wall = [NOW]
    responses = [
        HttpPayload(200, _tsunami_feed(), {}),
        HttpPayload(200, _tsunami_detail(), {}),
        HttpPayload(304, b"", {}),
        HttpPayload(304, b"", {}),
    ]

    def fetch(_url, _headers):
        return responses.pop(0)

    source = JmaTsunamiSource(fetch, now=lambda: wall[0], clock=lambda: mono[0])
    first = source.fetch_latest()
    published = first.last_published_at
    assert first.status == LiveSourceStatus.FRESH

    mono[0] += 61
    wall[0] += timedelta(seconds=61)
    renewed_retrieval = source.fetch_latest(force=True)
    assert renewed_retrieval.last_published_at == published
    assert renewed_retrieval.retrieved_at == wall[0]
    assert renewed_retrieval.status == LiveSourceStatus.FRESH

    mono[0] += JMA_EVIDENCE_TTL_SECONDS - 61
    wall[0] = NOW + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
    stale = source.fetch_latest(force=True)
    assert stale.status == LiveSourceStatus.STALE
    assert stale.forecast_areas[0].status == TsunamiAreaStatus.UNKNOWN
    projected = tsunami_reference_from_result(stale)
    assert projected.status == TsunamiReferenceStatus.UNKNOWN
    assert projected.source_status == TsunamiSourceFreshness.STALE
    assert projected.forecast_areas[0].status == TsunamiAreaStatus.UNKNOWN

    conflicted = tsunami_reference_from_result(replace(first, conflict=True))
    assert conflicted.status == TsunamiReferenceStatus.CONFLICT
    assert conflicted.source_status == TsunamiSourceFreshness.CONFLICT
    assert all(item.status == TsunamiAreaStatus.UNKNOWN for item in conflicted.forecast_areas)


def test_jma_tsunami_source_recovers_after_backoff_with_new_publication_evidence():
    mono = [0.0]
    wall = [NOW]
    responses = [
        HttpPayload(200, _tsunami_feed(), {}),
        HttpPayload(200, _tsunami_detail(), {}),
        ValueError("temporary source outage"),
        HttpPayload(200, _tsunami_feed(updated="2026-10-06T01:00:04Z"), {}),
        HttpPayload(200, _tsunami_detail(
            info_type="訂正", serial="2", report_at="2026-10-06T01:00:04Z", kind="51", height="3", description="3m"
        ), {}),
    ]

    def fetch(_url, _headers):
        response = responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    source = JmaTsunamiSource(fetch, now=lambda: wall[0], clock=lambda: mono[0])
    issued = source.fetch_latest()
    old_published = issued.last_published_at
    assert issued.status == LiveSourceStatus.FRESH

    mono[0] += 61
    wall[0] += timedelta(seconds=61)
    failed = source.fetch_latest(force=True)
    assert failed.status == LiveSourceStatus.BACKOFF
    assert failed.last_published_at == old_published
    assert failed.forecast_areas[0].status == TsunamiAreaStatus.UNKNOWN

    mono[0] += 5
    wall[0] += timedelta(seconds=5)
    restored = source.fetch_latest(force=True)
    assert restored.status == LiveSourceStatus.FRESH
    assert restored.operation == TsunamiOperation.CORRECTION
    assert restored.last_published_at > old_published
    assert restored.forecast_areas[0].status == TsunamiAreaStatus.ACTIVE
    assert restored.forecast_areas[0].warning_class == TsunamiWarningClass.WARNING


def _gsi_fields(overrides=None):
    values = {column: "" for _kind, column in GSI_HAZARD_COLUMNS}
    values.update(overrides or {})
    return values


def test_gsi_designation_normalizer_preserves_eight_classes_and_distinguishes_blank_missing_and_invalid():
    fields = _gsi_fields({"津波": "1", "地震": "", "洪水": None})
    normalized = normalize_gsi_hazard_designations(
        fields,
        designation_role=DestinationDesignationRole.EMERGENCY_EVACUATION_SITE,
    )
    statuses = {item.hazard_type: item.status for item in normalized}
    assert len(statuses) == 8
    assert statuses[DestinationHazardType.TSUNAMI] == DestinationHazardDesignationStatus.DESIGNATED
    assert statuses[DestinationHazardType.EARTHQUAKE] == DestinationHazardDesignationStatus.NOT_DESIGNATED
    assert statuses[DestinationHazardType.FLOOD] == DestinationHazardDesignationStatus.UNKNOWN
    with pytest.raises(ValueError, match="illegal"):
        normalize_gsi_hazard_designations(
            _gsi_fields({"津波": "○"}),
            designation_role=DestinationDesignationRole.EMERGENCY_EVACUATION_SITE,
        )

    shelter = normalize_gsi_hazard_designations(
        {"施設名": "避難所"},
        designation_role=DestinationDesignationRole.EVACUATION_SHELTER,
    )
    assert len(shelter) == 8
    assert all(item.status == DestinationHazardDesignationStatus.UNKNOWN for item in shelter)

    old_record = DestinationRecord(
        id="destination-old-snapshot",
        name="避難場所",
        address="宮城県",
        area_id="JP-04",
        coordinates=Coordinate(lat=38.26, lng=141.0),
        source_key="gsi-official",
        source_name="GSI",
        source_url="https://www.gsi.go.jp/data.csv",
        source_published_at=NOW,
        designation_types=("old designation field",),
    )
    assert old_record.designation_roles is None
    assert old_record.hazard_designations is None
    normalized_record = normalize_gsi_destination_designation(
        old_record,
        _gsi_fields({"津波": "1"}),
        designation_role=DestinationDesignationRole.EMERGENCY_EVACUATION_SITE,
    )
    assert normalized_record.supported_hazards == (DisasterEventType.TSUNAMI,)
    assert normalized_record.open_status.value == "UNKNOWN"


def test_gsi_csv_normalizer_builds_separate_emergency_site_and_general_shelter_rows():
    emergency = (
        "NO,共通ID,施設・場所名,住所,洪水,地震,津波,緯度,経度\n"
        "1,E040001,石巻小学校,宮城県石巻市1-1,1,,1,38.434,141.302\n"
    ).encode()
    sites = normalize_gsi_csv(
        emergency,
        area_id="JP-04",
        source_url="https://hinanmap.gsi.go.jp/hinanjocp/csv/ishinomaki.csv",
        designation_role=DestinationDesignationRole.EMERGENCY_EVACUATION_SITE,
        # No official municipality publish timestamp was supplied; do not invent one.
    )
    assert len(sites) == 1
    site = sites[0]
    assert site.id == "gsi-E040001"
    assert site.source_key == GSI_SOURCE_KEY
    assert site.source_published_at is None
    assert site.open_status.value == "UNKNOWN"
    assert site.supported_hazards == (DisasterEventType.TSUNAMI,)
    by_type = {item.hazard_type: item.status for item in site.hazard_designations}
    assert len(by_type) == 8
    assert by_type[DestinationHazardType.FLOOD] == DestinationHazardDesignationStatus.DESIGNATED
    assert by_type[DestinationHazardType.TSUNAMI] == DestinationHazardDesignationStatus.DESIGNATED
    assert by_type[DestinationHazardType.LANDSLIDE] == DestinationHazardDesignationStatus.UNKNOWN
    assert by_type[DestinationHazardType.EARTHQUAKE] == DestinationHazardDesignationStatus.NOT_DESIGNATED

    shelter = (
        "NO,共通ID,施設・場所名,住所,指定緊急避難場所との住所同一,受入対象者,緯度,経度\n"
        "1,E040002,石巻市役所,宮城県石巻市2-2,1,一般,38.434,141.302\n"
    ).encode()
    shelters = normalize_gsi_csv(
        shelter,
        area_id="JP-04",
        source_url="https://hinanmap.gsi.go.jp/hinanjocp/csv/ishinomaki-shelter.csv",
        designation_role=DestinationDesignationRole.EVACUATION_SHELTER,
    )
    assert shelters[0].designation_roles == (DestinationDesignationRole.EVACUATION_SHELTER,)
    assert shelters[0].supported_hazards == ()
    assert all(item.status == DestinationHazardDesignationStatus.UNKNOWN for item in shelters[0].hazard_designations)
    assert shelters[0].open_status.value == "UNKNOWN"


def test_gsi_csv_normalizer_rejects_illegal_classification_and_nonofficial_url():
    csv_bytes = (
        "NO,共通ID,施設・場所名,住所,津波,緯度,経度\n"
        "1,E040003,避難場所,宮城県石巻市3-3,○,38.434,141.302\n"
    ).encode()
    with pytest.raises(ValueError, match="illegal"):
        normalize_gsi_csv(
            csv_bytes,
            area_id="JP-04",
            source_url="https://hinanmap.gsi.go.jp/hinanjocp/csv/ishinomaki.csv",
            designation_role=DestinationDesignationRole.EMERGENCY_EVACUATION_SITE,
        )
    with pytest.raises(ValueError, match="allowlisted"):
        normalize_gsi_csv(
            csv_bytes,
            area_id="JP-04",
            source_url="https://example.com/fake.csv",
            designation_role=DestinationDesignationRole.EMERGENCY_EVACUATION_SITE,
        )
