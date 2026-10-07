import asyncio
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from agent_api.live import LiveStore
from agent_api.live_routes import (
    EKISPERT_ROUTE_TOOL,
    EkispertRouteSource,
    build_ekispert_route_arguments,
    normalize_ekispert_route_result,
    RouteFetchResult,
)
from agent_api.main import create_app
from agent_api.planner import CandidatePlanner, PlannerConfig
from agent_api.live_sources import (
    JMA_EVIDENCE_TTL_SECONDS,
    JMA_PREFECTURES,
    JMA_SOURCE_KEY,
    JmaEarthquakeReport,
    JmaFetchResult,
    JmaPrefObservation,
    TOKYO_SHELTER_SOURCE_KEY,
    TOKYO_SHELTER_SOURCE_NAME,
    TOKYO_SHELTER_URL,
)
from seventytwoh_contracts.models import (
    Coordinate,
    DestinationOpenStatus,
    DestinationRecord,
    LiveSourceStatus,
    RoutePresentationStatus,
)

NOW = datetime(2026, 10, 6, 1, 0, tzinfo=timezone.utc)


def test_ekispert_arguments_use_two_wgs84_coordinates_and_advertised_parameters_only():
    arguments = build_ekispert_route_arguments(
        35.6812, 139.7671, 35.6895, 139.6917,
        today=datetime(2026, 10, 5, 16, 0, tzinfo=timezone.utc),
    )
    assert arguments == {
        "viaList": "35.681200,139.767100,wgs84,500:35.689500,139.691700,wgs84,500",
        "date": 20261006,
        "answerCount": 1,
        "gcs": "wgs84",
        "searchType": "plain",
    }
    assert "searchCount" not in arguments


def test_ekispert_route_normalizer_uses_real_point_coordinates_only_and_keeps_candidate_status():
    payload = {
        "structuredContent": {
            "ResultSet": {
                "Course": [{
                    "Name": "provider course",
                    "Route": {
                        "Name": "provider route",
                        "Point": [
                            {"Station": {"Name": "東京"}, "GeoPoint": {"longi_d": "139.7671", "lati_d": "35.6812"}},
                            {"Station": {"Name": "新宿"}, "GeoPoint": {"longi_d": "139.7004", "lati_d": "35.6896"}},
                        ],
                    },
                }]
            }
        }
    }
    route = normalize_ekispert_route_result(
        payload,
        destination_id="dest-1",
        origin_area_id="JP-13",
        checked_at=NOW,
    )
    assert route is not None
    assert route.status == RoutePresentationStatus.CANDIDATE
    assert route.destination_id == "dest-1"
    assert route.geometry_kind == "TRANSIT_STATION_SEQUENCE"
    assert route.geometry.coordinates == ((139.7671, 35.6812), (139.7004, 35.6896))
    assert route.waypoints == ("東京", "新宿")
    assert "not a walking road route" in route.presentation_label


def test_ekispert_route_without_actual_geo_points_keeps_geometry_null():
    payload = {"content": [{"type": "text", "text": '{"ResultSet":{"Course":{"Route":{"Point":{"Station":{"Name":"東京"}}}}}}'}]}
    route = normalize_ekispert_route_result(payload, destination_id="dest-1", origin_area_id=None, checked_at=NOW)
    assert route is not None
    assert route.geometry is None
    assert route.geometry_kind == "NONE"
    assert route.waypoints == ("東京",)


def test_route_normalizer_rejects_invalid_coordinate_pairs_without_fabricating_geometry():
    payload = {"ResultSet": {"Course": {"Route": {"Point": [
        {"GeoPoint": {"longi_d": "999", "lati_d": "35"}},
        {"GeoPoint": {"longi_d": "139", "lati_d": "95"}},
    ]}}}}
    route = normalize_ekispert_route_result(payload, destination_id="dest-1", origin_area_id=None, checked_at=NOW)
    assert route is not None
    assert route.geometry is None


def test_route_source_processes_one_fixed_tool_and_caches_per_key_without_renewing_route(monkeypatch):
    class Provider:
        def __init__(self):
            self.calls = []

        async def call_tool(self, name, arguments):
            self.calls.append((name, arguments))
            return {"ResultSet": {"Course": {"Route": {"Point": [
                {"GeoPoint": {"longi_d": "139.7671", "lati_d": "35.6812"}},
                {"GeoPoint": {"longi_d": "139.7004", "lati_d": "35.6896"}},
            ]}}}}

    mono = [0.0]
    wall = [NOW]
    provider = Provider()
    source = EkispertRouteSource(provider, now=lambda: wall[0], clock=lambda: mono[0])
    kwargs = dict(
        latitude=35.6812,
        longitude=139.7671,
        destination_latitude=35.6895,
        destination_longitude=139.6917,
        destination_id="dest-1",
        origin_area_id="JP-13",
    )
    first = asyncio.run(source.search(**kwargs))
    mono[0] += 10
    wall[0] += timedelta(seconds=10)
    second = asyncio.run(source.search(**kwargs))
    assert first.status == second.status == LiveSourceStatus.FRESH
    assert first.route.checked_at == second.route.checked_at == NOW
    assert len(provider.calls) == 1
    assert provider.calls[0][0] == EKISPERT_ROUTE_TOOL


def test_route_source_hard_bounds_actual_calls_per_session_and_process(monkeypatch):
    monkeypatch.setattr("agent_api.live_routes.ROUTE_MIN_INTERVAL_SECONDS", 0)

    class Provider:
        def __init__(self):
            self.calls = 0

        async def call_tool(self, _name, _arguments):
            self.calls += 1
            return {"ResultSet": {"Course": {"Route": {"Point": [
                {"GeoPoint": {"longi_d": "139.7", "lati_d": "35.6"}},
                {"GeoPoint": {"longi_d": "139.8", "lati_d": "35.7"}},
            ]}}}}

    provider = Provider()
    source = EkispertRouteSource(
        provider,
        now=lambda: NOW,
        clock=lambda: 0.0,
        max_total_calls=2,
        max_calls_per_session=1,
    )

    def search(origin, session):
        return asyncio.run(source.search(
            latitude=35.6,
            longitude=origin,
            destination_latitude=35.7,
            destination_longitude=139.8,
            destination_id="dest-1",
            origin_area_id="JP-13",
            session_id=session,
        ))

    first = search(139.7, "session-a")
    cached = search(139.7, "session-a")
    session_limited = search(139.71, "session-a")
    second_session = search(139.72, "session-b")
    process_limited = search(139.73, "session-c")

    assert first.status == LiveSourceStatus.FRESH
    assert cached.status == LiveSourceStatus.FRESH
    assert session_limited.status == LiveSourceStatus.UNAVAILABLE
    assert "session" in session_limited.detail and "budget" in session_limited.detail
    assert second_session.status == LiveSourceStatus.FRESH
    assert process_limited.status == LiveSourceStatus.UNAVAILABLE
    assert "process" in process_limited.detail and "budget" in process_limited.detail
    assert provider.calls == 2


class _JmaStub:
    def fetch_latest(self):
        return JmaFetchResult(LiveSourceStatus.UNSUPPORTED, NOW, None, None, (), "no current report")


class _ShelterStub:
    def fetch_latest(self):
        destination = DestinationRecord(
            id="dest-tokyo-1",
            name="designated facility",
            address="Tokyo facility address",
            area_id="JP-13",
            coordinates=Coordinate(lat=35.68, lng=139.76),
            source_key=TOKYO_SHELTER_SOURCE_KEY,
            source_name=TOKYO_SHELTER_SOURCE_NAME,
            source_url=TOKYO_SHELTER_URL,
            source_published_at=datetime(2021, 4, 1, tzinfo=timezone.utc),
            designation_types=("designated shelter",),
            open_status=DestinationOpenStatus.UNKNOWN,
        )
        return LiveSourceStatus.FRESH, (destination,), NOW, None


class _RouteStub:
    async def search(self, **kwargs):
        self.kwargs = kwargs
        route = normalize_ekispert_route_result(
            {"ResultSet": {"Course": {"Route": {"Point": [
                {"GeoPoint": {"longi_d": "139.76", "lati_d": "35.68"}},
                {"GeoPoint": {"longi_d": "139.69", "lati_d": "35.69"}},
            ]}}}},
            destination_id=kwargs["destination_id"],
            origin_area_id=kwargs["origin_area_id"],
            checked_at=NOW,
        )
        return RouteFetchResult(LiveSourceStatus.FRESH, NOW, None, route, "candidate only")


def test_live_route_search_api_uses_server_destination_and_returns_bound_candidate():
    route_source = _RouteStub()
    store = LiveStore(jma_source=_JmaStub(), destination_source=_ShelterStub(), route_source=route_source, now=lambda: NOW)
    client = TestClient(create_app(live_store=store))
    profile = {
        "current_location": {"label": "user location", "lat": 35.6812, "lng": 139.7671, "area_ids": ["JP-13", "JP"]},
        "accommodation_location": {"label": "stay", "lat": 35.69, "lng": 139.69, "area_ids": ["JP-13", "JP"]},
    }
    started = client.post("/api/live/start", json={"language": "en", "profile": profile})
    assert started.status_code == 201, started.text
    snapshot = started.json()
    assert snapshot["mode"] == "LIVE"
    assert snapshot["source"]["source_key"] == JMA_SOURCE_KEY
    assert snapshot["destination_source"]["status"] == "STALE"
    destination_id = snapshot["destinations"][0]["id"]
    response = client.post(
        f"/api/live/{snapshot['session_id']}/routes/search",
        json={
            "origin": {"label": "user location", "lat": 35.6812, "lng": 139.7671, "area_ids": ["JP-13", "JP"]},
            "destination_id": destination_id,
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["route_source"]["status"] == "FRESH"
    assert result["routes"][0]["status"] == "CANDIDATE"
    assert result["routes"][0]["destination_id"] == destination_id
    assert result["spatial_guidance"]["movement_authorized"] is False
    assert result["spatial_guidance"]["map_mount_eligible"] is False
    assert route_source.kwargs["destination_latitude"] == 35.68
    assert route_source.kwargs["destination_longitude"] == 139.76


def test_live_route_search_unknown_and_expired_sessions_return_404():
    store = LiveStore(jma_source=_JmaStub(), destination_source=_ShelterStub(), now=lambda: NOW)
    client = TestClient(create_app(live_store=store))
    profile = {
        "current_location": {"label": "user location", "lat": 35.6812, "lng": 139.7671, "area_ids": ["JP-13", "JP"]},
        "accommodation_location": {"label": "stay", "lat": 35.69, "lng": 139.69, "area_ids": ["JP-13", "JP"]},
    }
    started = client.post("/api/live/start", json={"language": "en", "profile": profile})
    assert started.status_code == 201, started.text
    snapshot = started.json()
    body = {
        "origin": {"label": "user location", "lat": 35.6812, "lng": 139.7671, "area_ids": ["JP-13", "JP"]},
        "destination_id": snapshot["destinations"][0]["id"],
    }

    unknown = client.post(f"/api/live/{uuid4()}/routes/search", json=body)
    assert unknown.status_code == 404

    session_id = snapshot["session_id"]
    store._sessions[next(key for key in store._sessions if str(key) == session_id)].expires_at = monotonic() - 1
    expired = client.post(f"/api/live/{session_id}/routes/search", json=body)
    assert expired.status_code == 404


def test_jma_prefecture_claim_batch_keeps_all_47_statuses_under_64_claim_contract():
    store = LiveStore(jma_source=_JmaStub(), destination_source=_ShelterStub(), now=lambda: NOW)
    profile = {
        "current_location": {"label": "Shibuya", "area_ids": ["JP-13", "JP"]},
        "accommodation_location": {"label": "Asakusa", "area_ids": ["JP-13", "JP"]},
    }
    aggregate = store._create_session({"language": "en", "profile": profile})
    observations = tuple(
        JmaPrefObservation(code=code, name=name, max_intensity="3")
        for code, name in JMA_PREFECTURES.items()
    )
    report = JmaEarthquakeReport(
        report_id="fixture-47-prefectures",
        title="JMA prefecture observation fixture",
        published_at=NOW - timedelta(seconds=5),
        occurred_at=NOW - timedelta(seconds=10),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/fixture.xml",
        observations=observations,
    )

    pair = store._event_evidence_pair(aggregate.state, report, NOW)
    assert pair is not None
    _event, evidence = pair
    status_claims = [claim for claim in evidence.claims if ".status" in claim.key]
    intensity_claims = [claim for claim in evidence.claims if ".max_intensity." in claim.key]
    assert len(evidence.affected_area_ids) == 47
    assert len(evidence.disaster_assessments) == 47
    assert len(status_claims) == 47
    assert len(evidence.claims) <= 64
    assert [claim.key for claim in intensity_claims] == ["jma.earthquake.max_intensity.jp-13"]
    assert "JP-13" in evidence.summary


def test_live_fresh_jma_evidence_uses_bounded_candidate_planner_before_publish():
    report = JmaEarthquakeReport(
        report_id="fresh-live-planner-fixture",
        title="JMA earthquake report fixture",
        published_at=NOW - timedelta(seconds=5),
        occurred_at=NOW - timedelta(seconds=10),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/live-planner-fixture.xml",
        observations=(JmaPrefObservation(code="13", name="東京都", max_intensity="2"),),
    )

    class FreshJma:
        def fetch_latest(self):
            return JmaFetchResult(LiveSourceStatus.FRESH, NOW, report.published_at, None, (report,), "fixture fresh")

    class ChoosingRunner:
        def __init__(self):
            self.calls = 0
            self.contexts = []

        async def run_candidate(self, context, _config):
            self.calls += 1
            self.contexts.append(context)
            choices = []
            for category in context["choices"]:
                option = category["options"][0]
                choices.append({
                    "category": category["category"],
                    "intent_id": option["intent_id"],
                    "evidence_ids": option["eligible_evidence_ids"][:1],
                })
            return {"choices": choices}

    runner = ChoosingRunner()
    planner = CandidatePlanner(
        PlannerConfig(
            mode="gemini",
            model="gemini-3.5-flash-lite",
            project="fixture-project",
            location="global",
            timeout_seconds=1,
            max_calls_per_session=6,
            global_calls_per_minute=12,
            global_max_calls=100,
        ),
        runner=runner,
    )
    store = LiveStore(
        jma_source=FreshJma(),
        destination_source=_ShelterStub(),
        planner=planner,
        now=lambda: NOW,
    )
    snapshot = asyncio.run(store.start_async({
        "language": "en",
        "profile": {
            "current_location": {"label": "Shibuya", "area_ids": ["JP-13", "JP"]},
            "accommodation_location": {"label": "Asakusa", "area_ids": ["JP-13", "JP"]},
        },
    }))

    assert snapshot.source.status == LiveSourceStatus.FRESH
    assert snapshot.evidence[0].source_key == JMA_SOURCE_KEY
    assert snapshot.evidence[0].trust_status.value == "VERIFIED_OFFICIAL"
    assert runner.calls == 1
    assert runner.contexts[0]["verified_claims"]
    assert any(item.event_type == "GEMINI_CANDIDATE_APPLIED" for item in snapshot.trace)
    assert snapshot.spatial_guidance.movement_authorized is False


def test_live_snapshot_projects_jma_stale_at_exact_publication_deadline_without_renewing_times():
    wall = [NOW]
    report = JmaEarthquakeReport(
        report_id="live-expiry-boundary",
        title="JMA publication deadline fixture",
        published_at=NOW,
        occurred_at=NOW - timedelta(seconds=10),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/fixture-expiry.xml",
        observations=(JmaPrefObservation(code="13", name="東京都", max_intensity="2"),),
    )

    class FreshJma:
        def fetch_latest(self):
            return JmaFetchResult(LiveSourceStatus.FRESH, wall[0], report.published_at, None, (report,), "fixture fresh")

    store = LiveStore(jma_source=FreshJma(), destination_source=_ShelterStub(), now=lambda: wall[0])
    snapshot = asyncio.run(store.start_async({
        "language": "en",
        "profile": {
            "current_location": {"label": "Shibuya", "area_ids": ["JP-13", "JP"]},
            "accommodation_location": {"label": "Asakusa", "area_ids": ["JP-13", "JP"]},
        },
    }))
    retrieved_at = snapshot.source.retrieved_at
    published_at = snapshot.source.last_published_at
    assert snapshot.source.status == LiveSourceStatus.FRESH

    wall[0] = NOW + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
    expired = store.get(snapshot.session_id)

    assert expired.source.status == LiveSourceStatus.STALE
    assert expired.source.retrieved_at == retrieved_at
    assert expired.source.last_published_at == published_at == NOW
    assert expired.evidence_projections
    assert all(item.freshness_status.value == "STALE" for item in expired.evidence_projections)
    assert expired.spatial_guidance.movement_authorized is False


def test_live_planner_wait_crossing_jma_deadline_rechecks_freshness_before_publish():
    wall = [NOW]
    report = JmaEarthquakeReport(
        report_id="live-planner-expiry-boundary",
        title="JMA planner wait deadline fixture",
        published_at=NOW,
        occurred_at=NOW - timedelta(seconds=10),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/fixture-planner-expiry.xml",
        observations=(JmaPrefObservation(code="13", name="東京都", max_intensity="2"),),
    )

    class FreshJma:
        def fetch_latest(self):
            return JmaFetchResult(LiveSourceStatus.FRESH, wall[0], report.published_at, None, (report,), "fixture fresh")

    class DeadlineCrossingRunner:
        async def run_candidate(self, context, _config):
            choices = []
            for category in context["choices"]:
                option = category["options"][0]
                choices.append({
                    "category": category["category"],
                    "intent_id": option["intent_id"],
                    "evidence_ids": option["eligible_evidence_ids"][:1],
                })
            wall[0] = NOW + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
            return {"choices": choices}

    planner = CandidatePlanner(
        PlannerConfig(
            mode="gemini",
            model="gemini-3.5-flash-lite",
            project="fixture-project",
            location="global",
            timeout_seconds=1,
            max_calls_per_session=6,
            global_calls_per_minute=12,
            global_max_calls=100,
        ),
        runner=DeadlineCrossingRunner(),
    )
    store = LiveStore(
        jma_source=FreshJma(),
        destination_source=_ShelterStub(),
        planner=planner,
        now=lambda: wall[0],
    )

    snapshot = asyncio.run(store.start_async({
        "language": "en",
        "profile": {
            "current_location": {"label": "Shibuya", "area_ids": ["JP-13", "JP"]},
            "accommodation_location": {"label": "Asakusa", "area_ids": ["JP-13", "JP"]},
        },
    }))

    assert snapshot.source.status == LiveSourceStatus.STALE
    assert snapshot.source.last_published_at == NOW
    assert snapshot.evidence_projections
    assert all(item.freshness_status.value == "STALE" for item in snapshot.evidence_projections)
    assert snapshot.spatial_guidance.movement_authorized is False


def test_live_session_purge_releases_shared_planner_budget_key():
    class PlannerTracker:
        def __init__(self):
            self.released = []

        def release_session(self, session_id):
            self.released.append(session_id)

    planner = PlannerTracker()
    store = LiveStore(planner=planner, ttl_seconds=0, now=lambda: NOW)
    aggregate = store._create_session({
        "language": "en",
        "profile": {
            "current_location": {"label": "Shibuya", "area_ids": ["JP-13", "JP"]},
            "accommodation_location": {"label": "Asakusa", "area_ids": ["JP-13", "JP"]},
        },
    })
    store._purge_expired_locked()
    assert aggregate.session_id not in store._sessions
    assert planner.released == [f"live-{aggregate.session_id}"]
