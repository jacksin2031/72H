from datetime import datetime, timedelta, timezone
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from agent_api.live import LiveStore
from agent_api.domain import _network_transition, apply_live_evidence_batch
from agent_api.live_sources import (
    JmaEarthquakeReport,
    JmaFetchResult,
    JmaPrefObservation,
)
from agent_api.main import create_app
from agent_api.planning import disaster_status_claim_keys, route_status_claim_key
from agent_api.safety import disaster_claim_key
from seventytwoh_contracts.models import (
    Claim,
    ClaimType,
    ClaimStateStatus,
    DisasterEvent,
    DisasterEventStatus,
    DisasterEventType,
    Evidence,
    FreshnessStatus,
    IncidentStatus,
    LiveSourceStatus,
    Location,
    NetworkState,
    Plan,
    PlanAction,
    PlanActionCategory,
    PlanActionStatus,
    PlanStatus,
    RiskLevel,
    SafeIntentId,
    SafetyDecision,
)

NOW = datetime(2026, 10, 6, 1, 0, tzinfo=timezone.utc)
SHIBUYA_PATH = ["JP-MUNI-13113", "JP-13", "JP"]
SHINJUKU_PATH = ["JP-MUNI-13104", "JP-13", "JP"]


class _FreshJmaNoReports:
    def fetch_latest(self):
        return JmaFetchResult(LiveSourceStatus.FRESH, NOW, NOW, None, (), "no current report")


class _EmptyShelterSource:
    def fetch_latest(self):
        return LiveSourceStatus.UNAVAILABLE, (), NOW, None


def _store_and_client():
    store = LiveStore(
        jma_source=_FreshJmaNoReports(),
        destination_source=_EmptyShelterSource(),
        now=lambda: NOW,
    )
    return store, TestClient(create_app(live_store=store))


def _start(client: TestClient, path=SHIBUYA_PATH):
    response = client.post(
        "/api/live/start",
        json={
            "language": "en",
            "profile": {
                "current_location": {"label": "untrusted client label", "area_ids": path},
                "accommodation_location": {"label": "Accommodation not set", "area_ids": []},
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _location_body(*, source="USER_SELECTED", observed_at=NOW, area_ids=SHINJUKU_PATH):
    return {
        "area_ids": area_ids,
        "source": source,
        "observed_at": observed_at.isoformat().replace("+00:00", "Z"),
    }


def _profile_body(
    *,
    accommodation_label="未設定",
    accommodation_area_ids=(),
    accommodation_source=None,
    accommodation_observed_at=None,
    party_size=1,
    safety_status="UNKNOWN",
    accessibility_constraints=(),
):
    return {
        "accommodation_location": {
            "label": accommodation_label,
            "area_ids": accommodation_area_ids,
            "lat": None,
            "lng": None,
            "source": accommodation_source,
            "observed_at": (
                accommodation_observed_at.isoformat().replace("+00:00", "Z")
                if accommodation_observed_at is not None else None
            ),
        },
        "party_size": party_size,
        "self_reported_safety_status": safety_status,
        "accessibility_constraints": accessibility_constraints,
    }


def test_live_start_accepts_registered_municipal_path_and_canonicalizes_label():
    _store, client = _store_and_client()

    snapshot = _start(client)
    canonical_labels = {area["id"]: area["label"] for area in snapshot["area_catalog"]}

    assert snapshot["profile"]["current_location"]["area_ids"] == SHIBUYA_PATH
    assert snapshot["profile"]["current_location"]["label"] == canonical_labels[SHIBUYA_PATH[0]]
    assert snapshot["profile"]["accommodation_location"]["area_ids"] == []
    assert {"JP", *(f"JP-{number:02d}" for number in range(1, 48))}.issubset(canonical_labels)
    assert len(snapshot["area_catalog"]) < 512
    assert len(snapshot["area_catalog"]) < 2000  # The full national registry is not copied into each session.


def test_live_start_accepts_initial_gps_without_coordinates_and_unset_accommodation():
    _store, client = _store_and_client()
    current_location = {
        "label": "untrusted client label",
        "area_ids": SHIBUYA_PATH,
        "source": "GPS",
        "observed_at": NOW.isoformat().replace("+00:00", "Z"),
    }
    payload = {
        "language": "en",
        "profile": {
            "current_location": current_location,
            "accommodation_location": {
                "label": "未設定",
                "area_ids": [],
                "lat": None,
                "lng": None,
            },
        },
    }
    assert "lat" not in current_location and "lng" not in current_location

    response = client.post("/api/live/start", json=payload)

    assert response.status_code == 201, response.text
    snapshot = response.json()
    current = snapshot["profile"]["current_location"]
    accommodation = snapshot["profile"]["accommodation_location"]
    canonical_labels = {area["id"]: area["label"] for area in snapshot["area_catalog"]}
    assert current["area_ids"] == SHIBUYA_PATH
    assert current["label"] == canonical_labels[SHIBUYA_PATH[0]]
    assert current["source"] == "GPS"
    assert current["observed_at"] == NOW.isoformat().replace("+00:00", "Z")
    assert current["lat"] is None and current["lng"] is None
    assert accommodation["label"] == "未設定"
    assert accommodation["area_ids"] == []
    assert accommodation["lat"] is None and accommodation["lng"] is None


@pytest.mark.parametrize(
    "observed_at",
    [NOW - timedelta(minutes=2, seconds=1), NOW + timedelta(seconds=1)],
)
def test_live_start_rejects_stale_or_future_initial_gps(observed_at):
    _store, client = _store_and_client()
    response = client.post(
        "/api/live/start",
        json={
            "language": "en",
            "profile": {
                "current_location": {
                    "label": "client label",
                    "area_ids": SHIBUYA_PATH,
                    "source": "GPS",
                    "observed_at": observed_at.isoformat().replace("+00:00", "Z"),
                },
                "accommodation_location": {"label": "未設定", "area_ids": []},
            },
        },
    )

    assert response.status_code == 422


def test_location_update_is_typed_canonical_and_manual_source_stays_manual():
    _store, client = _store_and_client()
    started = _start(client)

    response = client.post(
        f"/api/live/{started['session_id']}/location",
        json=_location_body(),
    )

    assert response.status_code == 200, response.text
    snapshot = response.json()
    location = snapshot["profile"]["current_location"]
    canonical_labels = {area["id"]: area["label"] for area in snapshot["area_catalog"]}
    assert location["area_ids"] == SHINJUKU_PATH
    assert location["label"] == canonical_labels[SHINJUKU_PATH[0]]
    assert location["source"] == "USER_SELECTED"
    assert location["observed_at"] == NOW.isoformat().replace("+00:00", "Z")
    assert location["lat"] is None and location["lng"] is None
    assert snapshot["source"]["status"] == started["source"]["status"]
    assert snapshot["situation"]["network_state"] == started["situation"]["network_state"]
    assert snapshot["evidence"] == started["evidence"]
    assert snapshot["trace"][-1]["event_type"] == "PROFILE_LOCATION_UPDATED"
    assert "does not verify disaster information or movement safety" in snapshot["trace"][-1]["public_summary"]
    assert "JP-MUNI-13113" in {area["id"] for area in snapshot["area_catalog"]}
    assert "JP-MUNI-13104" in {area["id"] for area in snapshot["area_catalog"]}
    assert len(snapshot["area_catalog"]) < 512


@pytest.mark.parametrize(
    "body",
    [
        _location_body(source="GPS", observed_at=NOW - timedelta(seconds=121)),
        _location_body(observed_at=NOW + timedelta(seconds=1)),
        _location_body(area_ids=["JP-MUNI-00000", "JP-13", "JP"]),
        _location_body(area_ids=["JP-MUNI-13113", "JP-14", "JP"]),
        {**_location_body(), "lat": 35.68, "lng": 139.76},
    ],
)
def test_location_update_rejects_stale_or_future_time_unknown_path_and_coordinates(body):
    _store, client = _store_and_client()
    started = _start(client)

    response = client.post(
        f"/api/live/{started['session_id']}/location",
        json=body,
    )

    assert response.status_code == 422


def test_gps_location_at_two_minute_boundary_is_accepted_and_has_gps_source():
    _store, client = _store_and_client()
    started = _start(client)

    response = client.post(
        f"/api/live/{started['session_id']}/location",
        json=_location_body(source="GPS", observed_at=NOW - timedelta(minutes=2)),
    )

    assert response.status_code == 200, response.text
    assert response.json()["profile"]["current_location"]["source"] == "GPS"


def test_same_area_gps_refresh_updates_timestamp_without_expiring_route_or_replanning():
    from seventytwoh_contracts.models import RoutePresentation, RoutePresentationStatus

    store, client = _store_and_client()
    response = client.post(
        "/api/live/start",
        json={
            "language": "en",
            "profile": {
                "current_location": {
                    "label": "Shibuya",
                    "area_ids": SHIBUYA_PATH,
                    "source": "GPS",
                    "observed_at": (NOW - timedelta(seconds=100)).isoformat().replace("+00:00", "Z"),
                },
                "accommodation_location": {"label": "未設定", "area_ids": []},
            },
        },
    )
    assert response.status_code == 201, response.text
    started = response.json()
    session_id = started["session_id"]
    aggregate = store._sessions[next(key for key in store._sessions if str(key) == session_id)]
    route = RoutePresentation(
        id="route_same_area_refresh",
        status=RoutePresentationStatus.CANDIDATE,
        origin_area_id=SHIBUYA_PATH[0],
        destination_id="destination_same_area_refresh",
        provider="fixture",
        provider_reference="fixture-route",
        checked_at=NOW - timedelta(seconds=5),
        expires_at=NOW + timedelta(minutes=5),
    )
    aggregate.state = replace(aggregate.state, routes=(route,))
    existing_plan_ids = tuple(item.id for item in aggregate.state.plans)
    existing_evidence_ids = tuple(item.id for item in aggregate.state.evidence)
    existing_network = aggregate.state.situation.network_state

    refreshed = client.post(
        f"/api/live/{session_id}/location",
        json=_location_body(
            source="GPS",
            observed_at=NOW - timedelta(seconds=1),
            area_ids=SHIBUYA_PATH,
        ),
    )

    assert refreshed.status_code == 200, refreshed.text
    snapshot = refreshed.json()
    location = snapshot["profile"]["current_location"]
    assert location["area_ids"] == SHIBUYA_PATH
    assert location["source"] == "GPS"
    assert location["observed_at"] == (NOW - timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
    assert tuple(item["id"] for item in snapshot["plans"]) == existing_plan_ids
    assert tuple(item["id"] for item in snapshot["evidence"]) == existing_evidence_ids
    assert snapshot["situation"]["network_state"] == existing_network.value
    assert snapshot["routes"][0]["id"] == route.id
    assert snapshot["routes"][0]["status"] == "CANDIDATE"
    assert snapshot["trace"][-1]["event_type"] == "PROFILE_LOCATION_REFRESHED"


def test_profile_update_keeps_session_and_stale_gps_while_evaluating_plan_history():
    store, client = _store_and_client()
    start_response = client.post(
        "/api/live/start",
        json={
            "language": "en",
            "profile": {
                "current_location": {
                    "label": "Shibuya",
                    "area_ids": SHIBUYA_PATH,
                    "source": "GPS",
                    "observed_at": (NOW - timedelta(seconds=90)).isoformat().replace("+00:00", "Z"),
                },
                "accommodation_location": {"label": "未設定", "area_ids": []},
            },
        },
    )
    assert start_response.status_code == 201, start_response.text
    started = start_response.json()
    session_id = started["session_id"]
    aggregate = store._sessions[next(key for key in store._sessions if str(key) == session_id)]
    original = aggregate.state
    plan = Plan(
        id="plan_profile_metadata_1",
        situation_id=original.situation.id,
        version=1,
        status=PlanStatus.ACTIVE,
        created_at=NOW,
        expires_at=NOW + timedelta(minutes=15),
        invalidate_on_new_relevant_evidence=True,
        based_on_evidence_ids=(),
        language=original.profile.preferred_language,
    )
    action = PlanAction(
        id="action_profile_metadata_next",
        plan_id=plan.id,
        category=PlanActionCategory.NEXT,
        intent_id=SafeIntentId.REVIEW_OFFICIAL_GUIDANCE,
        text="Review official guidance.",
        reason="Fixture for profile metadata reevaluation.",
        risk_level=RiskLevel.LOW,
        evidence_ids=(),
        status=PlanActionStatus.ACTIVE,
        safety_decision=SafetyDecision.ALLOW,
    )
    aggregate.state = replace(
        original,
        situation=original.situation.model_copy(update={"current_plan_id": plan.id}),
        plans=(plan,),
        plan_actions=(action,),
    )
    original_current = aggregate.state.profile.current_location
    original_network = aggregate.state.situation.network_state
    original_evidence_ids = tuple(item.id for item in aggregate.state.evidence)

    # The GPS fix expires while the user is editing settings. Metadata save remains
    # available, but it cannot refresh GPS provenance or authorize movement.
    store._now = lambda: NOW + timedelta(minutes=5)
    response = client.post(
        f"/api/live/{session_id}/profile",
        json=_profile_body(
            accommodation_label="client supplied label",
            accommodation_area_ids=SHINJUKU_PATH,
            party_size=3,
            safety_status="NEEDS_ASSISTANCE",
            accessibility_constraints=("wheelchair", "limited_stairs"),
            accommodation_source="USER_SELECTED",
            accommodation_observed_at=NOW - timedelta(days=10),
        ),
    )

    assert response.status_code == 200, response.text
    snapshot = response.json()
    profile = snapshot["profile"]
    canonical_labels = {area["id"]: area["label"] for area in snapshot["area_catalog"]}
    current_after = profile["current_location"]
    assert snapshot["session_id"] == session_id
    assert current_after == {
        "label": original_current.label,
        "lat": original_current.lat,
        "lng": original_current.lng,
        "area_ids": list(original_current.area_ids),
        "observed_at": original_current.observed_at.isoformat().replace("+00:00", "Z"),
        "source": "GPS",
    }
    assert current_after["observed_at"] != (NOW + timedelta(minutes=5)).isoformat().replace("+00:00", "Z")
    assert profile["accommodation_location"]["area_ids"] == SHINJUKU_PATH
    assert profile["accommodation_location"]["label"] == canonical_labels[SHINJUKU_PATH[0]]
    catalog = {area["id"]: area for area in snapshot["area_catalog"]}
    assert set(SHINJUKU_PATH).issubset(catalog)
    assert [catalog[item]["parent_id"] for item in SHINJUKU_PATH] == ["JP-13", "JP", None]
    assert profile["accommodation_location"]["lat"] is None
    assert profile["accommodation_location"]["lng"] is None
    assert profile["accommodation_location"]["source"] == "USER_SELECTED"
    assert profile["accommodation_location"]["observed_at"] == (
        NOW - timedelta(days=10)
    ).isoformat().replace("+00:00", "Z")
    assert profile["party_size"] == 3
    assert profile["self_reported_safety_status"] == "NEEDS_ASSISTANCE"
    assert profile["accessibility_constraints"] == ["wheelchair", "limited_stairs"]
    assert snapshot["situation"]["network_state"] == original_network.value
    assert tuple(item["id"] for item in snapshot["evidence"]) == original_evidence_ids
    assert [item["id"] for item in snapshot["plans"]] == [plan.id]
    assert [item["id"] for item in snapshot["plan_actions"]] == [action.id]
    assert snapshot["plan_evaluations"][-1]["plan_id"] == plan.id
    assert snapshot["plan_evaluations"][-1]["status"] == "KEEP"
    assert snapshot["spatial_guidance"]["movement_authorized"] is False
    assert snapshot["trace"][-1]["event_type"] == "PLAN_EVALUATED"


def test_profile_update_allows_unset_accommodation_area_path():
    _store, client = _store_and_client()
    started = _start(client)

    response = client.post(
        f"/api/live/{started['session_id']}/profile",
        json=_profile_body(),
    )

    assert response.status_code == 200, response.text
    accommodation = response.json()["profile"]["accommodation_location"]
    assert accommodation["label"] == "未設定"
    assert accommodation["area_ids"] == []
    assert accommodation["lat"] is None and accommodation["lng"] is None


@pytest.mark.parametrize(
    "body",
    [
        {**_profile_body(), "current_location": {"label": "Shibuya", "area_ids": SHIBUYA_PATH}},
        {**_profile_body(), "accommodation_location": {"label": "GPS", "area_ids": SHIBUYA_PATH, "source": "GPS", "observed_at": NOW.isoformat().replace("+00:00", "Z")}},
        {**_profile_body(), "accommodation_location": {"label": "coordinates", "area_ids": [], "lat": 35.68, "lng": 139.76}},
        {**_profile_body(), "accommodation_location": {"label": "unproven time", "area_ids": [], "source": None, "observed_at": NOW.isoformat().replace("+00:00", "Z")}},
        _profile_body(accommodation_area_ids=("JP-MUNI-13113", "JP-14", "JP")),
        _profile_body(party_size=0),
        _profile_body(safety_status="UNSAFE"),
    ],
)
def test_profile_update_rejects_location_scope_or_metadata_outside_contract(body):
    _store, client = _store_and_client()
    started = _start(client)

    response = client.post(f"/api/live/{started['session_id']}/profile", json=body)

    assert response.status_code == 422


def test_profile_update_unknown_session_is_404():
    _store, client = _store_and_client()

    response = client.post(f"/api/live/{uuid4()}/profile", json=_profile_body())

    assert response.status_code == 404


def test_profile_update_cannot_complete_reconnection_from_existing_evidence():
    store, client = _store_and_client()
    started = _start(client)
    session_id = started["session_id"]
    aggregate = store._sessions[next(key for key in store._sessions if str(key) == session_id)]
    original = aggregate.state
    current_area = original.profile.current_location.area_ids[0]
    destination = Location(label="Shinjuku", area_ids=tuple(SHINJUKU_PATH))
    event = DisasterEvent(
        id="event_profile_reconnect",
        situation_id=original.situation.id,
        event_type=DisasterEventType.EARTHQUAKE,
        occurred_at=NOW,
        received_at=NOW,
        affected_areas=("Tokyo",),
        affected_area_ids=(current_area,),
        source_name="JMA fixture",
        source_class="OFFICIAL",
        severity_raw="Fixture event; no 72H severity mapping",
        status=DisasterEventStatus.ACTIVE,
        raw_reference="https://www.data.jma.go.jp/developer/xml/data/reconnect-fixture.xml",
        is_synthetic=False,
    )
    situation = original.situation.model_copy(
        update={
            "active_event_ids": (event.id,),
            "incident_status": IncidentStatus.EVENT_DETECTED,
            "network_state": NetworkState.ONLINE_VERIFIED,
            "updated_at": NOW,
        }
    )
    before_reconnect = replace(
        original,
        profile=original.profile.model_copy(update={"current_destination": destination}),
        situation=situation,
        events=(event,),
    )
    reconnecting = _network_transition(
        before_reconnect,
        "profile-update-network-restored",
        NOW,
        NetworkState.RECONNECTING,
        "NETWORK_RESTORED",
        "Connectivity returned; fresh evidence is required.",
    )
    checked_at = NOW + timedelta(seconds=1)
    official_key = disaster_status_claim_keys(reconnecting)[0]
    route_key = route_status_claim_key(reconnecting)
    assert route_key is not None
    generic_official = Evidence(
        id="profile-reconnect-official",
        situation_id=reconnecting.situation.id,
        source_key="fixture-jma-current",
        source_name="JMA fixture",
        source_class="OFFICIAL",
        trust_status="VERIFIED_OFFICIAL",
        freshness_status=FreshnessStatus.CURRENT,
        published_at=checked_at,
        received_at=checked_at,
        relevant_areas=("Tokyo",),
        affected_area_ids=(current_area,),
        claim_type=ClaimType.DISASTER_STATUS,
        claims=(Claim(key=official_key, value="ACTIVE"),),
        summary="Fresh official evidence for profile update reconciliation test.",
        raw_reference="https://www.data.jma.go.jp/developer/xml/data/reconnect-fixture.xml",
        is_synthetic=False,
    )
    generic_partner = Evidence(
        id="profile-reconnect-partner",
        situation_id=reconnecting.situation.id,
        source_key="fixture-route-partner",
        source_name="Partner route fixture",
        source_class="PARTNER",
        trust_status="VERIFIED_PARTNER",
        freshness_status=FreshnessStatus.CURRENT,
        published_at=checked_at,
        received_at=checked_at,
        relevant_areas=("Tokyo",),
        affected_area_ids=(current_area, destination.area_ids[0]),
        claim_type=ClaimType.ROUTE_STATUS,
        claims=(Claim(key=route_key, value="UNKNOWN"),),
        summary="Fresh partner evidence for profile update reconciliation test.",
        raw_reference="https://example.invalid/reconnect-fixture",
        is_synthetic=False,
    )
    aggregate.state = replace(
        reconnecting,
        current_time=checked_at,
        situation=reconnecting.situation.model_copy(update={"updated_at": checked_at}),
        evidence=(generic_official, generic_partner),
    )
    store._now = lambda: checked_at

    response = client.post(
        f"/api/live/{session_id}/profile",
        json=_profile_body(party_size=2),
    )

    assert response.status_code == 200, response.text
    snapshot = response.json()
    assert snapshot["situation"]["network_state"] == NetworkState.RECONNECTING.value
    assert tuple(item["id"] for item in snapshot["evidence"]) == (
        generic_official.id,
        generic_partner.id,
    )

    # Saving identical settings later must also avoid reconciling from unrelated
    # evidence already present in the session.
    store._now = lambda: checked_at + timedelta(seconds=1)
    repeated = client.post(
        f"/api/live/{session_id}/profile",
        json=_profile_body(party_size=2),
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["situation"]["network_state"] == NetworkState.RECONNECTING.value


def test_location_update_unknown_session_is_404():
    _store, client = _store_and_client()

    response = client.post(f"/api/live/{uuid4()}/location", json=_location_body())

    assert response.status_code == 404


def test_scope_change_expires_old_routes_invalidates_high_risk_action_and_keeps_plan_history():
    from seventytwoh_contracts.models import (
        FreshnessStatus,
        RoutePresentation,
        RoutePresentationStatus,
    )

    store, client = _store_and_client()
    started = _start(client)
    session_id = started["session_id"]
    aggregate = store._sessions[next(key for key in store._sessions if str(key) == session_id)]
    original = aggregate.state
    plan = Plan(
        id="plan_location_1",
        situation_id=original.situation.id,
        version=1,
        status=PlanStatus.ACTIVE,
        created_at=NOW,
        expires_at=NOW + timedelta(minutes=15),
        invalidate_on_new_relevant_evidence=True,
        based_on_evidence_ids=(),
        language=original.profile.preferred_language,
    )
    action = PlanAction(
        id="action_location_high",
        plan_id=plan.id,
        category=PlanActionCategory.NOW,
        intent_id=SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER,
        text="Use a previously approved evacuation instruction.",
        reason="Fixture for location-scope invalidation.",
        risk_level=RiskLevel.HIGH,
        evidence_ids=(),
        status=PlanActionStatus.ACTIVE,
        safety_decision=SafetyDecision.ALLOW,
    )
    route = RoutePresentation(
        id="route_previous_location",
        status=RoutePresentationStatus.CANDIDATE,
        origin_area_id=SHIBUYA_PATH[0],
        destination_id="destination_previous_location",
        provider="fixture",
        provider_reference="fixture-route",
        checked_at=NOW,
        expires_at=NOW + timedelta(minutes=5),
        freshness_status=FreshnessStatus.CURRENT,
    )
    aggregate.state = replace(
        original,
        situation=original.situation.model_copy(update={"current_plan_id": plan.id}),
        plans=(plan,),
        plan_actions=(action,),
        routes=(route,),
    )

    response = client.post(
        f"/api/live/{session_id}/location",
        json=_location_body(),
    )

    assert response.status_code == 200, response.text
    snapshot = response.json()
    evaluation = next(item for item in snapshot["plan_evaluations"] if item["plan_id"] == plan.id)
    old_action = next(item for item in snapshot["plan_actions"] if item["id"] == action.id)
    old_plan = next(item for item in snapshot["plans"] if item["id"] == plan.id)
    current_plan_id = snapshot["situation"]["current_plan_id"]
    current_plan_actions = [item for item in snapshot["plan_actions"] if item["plan_id"] == current_plan_id]
    assert old_plan["version"] == 1 and old_plan["status"] == "ACTIVE"
    assert evaluation["invalid_action_ids"] == [action.id]
    assert old_action["status"] == "ACTIVE"  # Published plan history remains immutable.
    assert snapshot["routes"][0]["status"] == "EXPIRED"
    assert snapshot["spatial_guidance"]["movement_authorized"] is False
    assert any(item["version"] == 2 for item in snapshot["plans"])
    assert not any(item["risk_level"] == "HIGH" for item in current_plan_actions)


def test_jma_prefecture_observation_remains_ancestor_scoped_without_municipal_intensity_claim():
    store, client = _store_and_client()
    started = _start(client)
    session_id = started["session_id"]
    aggregate = store._sessions[next(key for key in store._sessions if str(key) == session_id)]
    report = JmaEarthquakeReport(
        report_id="municipal-location-prefecture-scope",
        title="JMA earthquake report fixture",
        published_at=NOW - timedelta(seconds=5),
        occurred_at=NOW - timedelta(seconds=10),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/municipal-location-fixture.xml",
        observations=(JmaPrefObservation(code="13", name="東京都", max_intensity="3"),),
    )

    pair = store._event_evidence_pair(aggregate.state, report, NOW)

    assert pair is not None
    _event, evidence = pair
    parent_status_key = disaster_claim_key("JP-13", DisasterEventType.EARTHQUAKE.value, "status")
    assert "JP-13" in evidence.affected_area_ids
    assert any(item.area_id == "JP-13" for item in evidence.disaster_assessments)
    assert parent_status_key in {claim.key for claim in evidence.claims}
    assert not any("max_intensity.jp-muni-13113" in claim.key.lower() for claim in evidence.claims)
    assert evidence.claim_type == ClaimType.DISASTER_STATUS
    updated = apply_live_evidence_batch(aggregate.state, (pair,), NOW)
    matched_parent = next(claim for claim in updated.situation.claim_states if claim.key == parent_status_key)
    assert matched_parent.status == ClaimStateStatus.VERIFIED
    assert matched_parent.value == "ACTIVE"
