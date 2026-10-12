from dataclasses import replace
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from agent_api.disaster_map import project_disaster_map
from agent_api.live import LiveStore
from agent_api.live_sources import _parse_jma_detail
from agent_api.main import create_app
from agent_api.official_journal import MemoryOfficialJournal
from seventytwoh_contracts.models import OfficialIntensityObservation, TsunamiAreaStatus
from test_live_sources import NOW, DETAIL_URL, _detail
from test_official_recovery import Harness


def results():
    eq, ts = Harness(), Harness("VTSE41")
    return eq.source(MemoryOfficialJournal()).fetch_latest(), ts.source(MemoryOfficialJournal()).fetch_latest(), eq.wall


def test_xml_hierarchy_keeps_measured_station_distinct_from_area_maxima():
    node = '<Area><Name>地域</Name><Code>100</Code><MaxInt>5+</MaxInt><City><Name>市</Name><Code>0123400</Code><MaxInt>5+</MaxInt><IntensityStation><Name>測站</Name><Code>0123401</Code><Int>4</Int></IntensityStation></City></Area>'
    raw = _detail().decode().replace('</Pref>', node + '</Pref>').encode()
    report = _parse_jma_detail(DETAIL_URL, raw, NOW)
    assert [(x.granularity, x.measurement, x.intensity) for x in report.map_observations] == [
        ("PREFECTURE", "MAXIMUM", "3"), ("REGION", "MAXIMUM", "5+"),
        ("CITY", "MAXIMUM", "5+"), ("STATION", "MEASURED", "4")]
    assert report.map_observations[-1].code == "0123401"
    assert report.observations[0].max_intensity == "3"  # Existing Safety Core scope unchanged.
    with pytest.raises(ValueError, match="duplicate"):
        _parse_jma_detail(DETAIL_URL, raw.replace(b'</City>', (node[node.index('<IntensityStation>'):node.index('</IntensityStation>') + 19] + '</City>').encode()), NOW)


def test_unknown_intensity_and_missing_station_code_are_not_invented():
    raw = _detail().decode().replace('</Pref>', '<Area><Name>地域</Name><Code>100</Code><City><Name>市</Name><IntensityStation><Name>測站</Name><Int>不明</Int></IntensityStation></City></Area></Pref>').encode()
    item = _parse_jma_detail(DETAIL_URL, raw, NOW).map_observations[-1]
    assert item.code is None and item.intensity == "不明"
    bad = _parse_jma_detail(DETAIL_URL, raw.replace("不明".encode(), b"NOT_AN_INTENSITY"), NOW).map_observations[-1]
    assert bad.intensity is None
    with pytest.raises(ValidationError):
        OfficialIntensityObservation(granularity="CITY", measurement="MEASURED", code=None, name="市", intensity="7", prefecture_code=None)


def test_original_311_sample_retains_actual_observation_granularity_without_current_coordinates():
    raw = (Path(__file__).parent / 'fixtures/jma_lifecycle/32-39_11_05_240613_VXSE53.xml').read_bytes()
    report = _parse_jma_detail(DETAIL_URL, raw, NOW)
    stations = [o for o in report.map_observations if o.granularity == 'STATION']
    cities = [o for o in report.map_observations if o.granularity == 'CITY']
    assert len(stations) == 2400 and len(cities) == 1275
    assert all(s.measurement == 'MEASURED' for s in stations)
    assert all(s.measurement == 'MAXIMUM' for s in cities)
    assert all(not hasattr(s, 'coordinates') for s in stations)
    assert report.bulletin.issued_at.year == 2011


def test_projection_uses_each_information_unit_and_original_provenance():
    eq, ts, now = results()
    response = project_disaster_map(eq, ts, now)
    assert len(response.reports) == 2
    assert response.reports[0].observations[0].granularity == "PREFECTURE"
    assert response.reports[1].forecast_areas[0].status == TsunamiAreaStatus.ACTIVE
    assert response.reports[1].bulletin.raw_sha256 == ts.bulletins[0].bulletin.raw_sha256
    assert response.safe_location_verified is response.route_authorized is False
    assert response.authority == "REFERENCE_ONLY"
    legacy = replace(eq, references=())
    assert not any(x.observations for x in project_disaster_map(legacy, ts, now).reports)


def test_expiry_conflict_and_capacity_never_present_current_warning():
    eq, ts, now = results()
    expired = project_disaster_map(eq, ts, now + timedelta(seconds=901))
    assert all(x.bulletin.lifecycle == "STALE" for x in expired.reports)
    assert all(a.status == TsunamiAreaStatus.UNKNOWN for x in expired.reports for a in x.forecast_areas)
    conflict = replace(ts, references=tuple(x.model_copy(update={"lifecycle": "CONFLICT"}) for x in ts.references))
    assert project_disaster_map(eq, conflict, now).reports[1].forecast_areas[0].status == TsunamiAreaStatus.UNKNOWN
    station = OfficialIntensityObservation(granularity="STATION", measurement="MEASURED", code=None, name="測站", intensity="4", prefecture_code=None)
    large = replace(eq, reports=tuple(replace(eq.reports[0], map_observations=(station,) * 6000) for _ in range(3)))
    capacity = project_disaster_map(large, ts, now)
    assert capacity.capacity_exceeded and capacity.reports == ()


def test_endpoint_accepts_no_gps_and_does_not_create_live_session():
    eq, ts = Harness(), Harness("VTSE41")
    store = LiveStore(jma_source=eq.source(MemoryOfficialJournal()), tsunami_source=ts.source(MemoryOfficialJournal()), now=lambda: eq.wall)
    client = TestClient(create_app(live_store=store))
    response = client.get('/api/reference/disaster-map')
    assert response.status_code == 200
    assert response.json()['mode'] == 'LIVE_REFERENCE'
    assert 'session_id' not in response.json()
    assert client.post('/api/reference/disaster-map', json={'lat': 38, 'lng': 141}).status_code == 405
