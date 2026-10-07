from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace

from seventytwoh_contracts.models import (
    Claim,
    ClaimType,
    Coordinate,
    DestinationOpenStatus,
    DestinationRecord,
    DisasterAssessment,
    DisasterEvent,
    DisasterEventStatus,
    DisasterEventType,
    Evidence,
    FreshnessStatus,
    NetworkState,
    PlanActionCategory,
    PlanActionStatus,
    PlanEvaluationStatus,
    PlanStatus,
    RoutePresentation,
    RoutePresentationStatus,
    SafeIntentId,
    SourceClass,
    TrustStatus,
    GeoJsonLineString,
)

from agent_api.planning import evaluate_and_replan
from agent_api.safety import SafetyPolicy, project_evidence
from agent_api.spatial import (
    MOVEMENT_DIRECTIVE_VALUE,
    evaluated_spatial_guidance,
    movement_claim_keys,
)


def _movement_state(initial_state):
    now = initial_state.current_time
    area_id = initial_state.profile.current_location.area_ids[0]
    destination_id = "dest-verified-1"
    route_id = "route-verified-1"
    keys = movement_claim_keys(area_id, destination_id, route_id, "EARTHQUAKE")
    published = now - timedelta(seconds=20)
    event = DisasterEvent(
        id="evt-live-earthquake",
        situation_id=initial_state.situation.id,
        event_type=DisasterEventType.EARTHQUAKE,
        occurred_at=published,
        received_at=published,
        affected_areas=("Tokyo",),
        affected_area_ids=(area_id,),
        source_name="JMA test fixture",
        source_class=SourceClass.OFFICIAL,
        severity_raw="JMA intensity observation; no 72H level mapping",
        status=DisasterEventStatus.ACTIVE,
        raw_reference="https://www.data.jma.go.jp/developer/xml/data/test.xml",
        is_synthetic=False,
    )
    area_evidence = Evidence(
        id="ev-current-disaster",
        situation_id=initial_state.situation.id,
        source_key="jma-live-eqvol",
        source_name="JMA fixture feed",
        source_class=SourceClass.OFFICIAL,
        trust_status=TrustStatus.VERIFIED_OFFICIAL,
        freshness_status=FreshnessStatus.CURRENT,
        published_at=published,
        received_at=published,
        relevant_areas=("Tokyo",),
        affected_area_ids=(area_id,),
        disaster_assessments=(DisasterAssessment(area_id=area_id, event_type=DisasterEventType.EARTHQUAKE, status=DisasterEventStatus.ACTIVE),),
        claim_type=ClaimType.DISASTER_STATUS,
        claims=(Claim(key=f"disaster.EARTHQUAKE.{area_id}.status", value="ACTIVE"),),
        summary="Fixture confirms current earthquake report scope for unit testing only.",
        raw_reference="https://www.data.jma.go.jp/developer/xml/data/test.xml",
        is_synthetic=False,
    )
    evidence = [area_evidence]
    status_specs = (
        ("ev-movement", "fixture-official-movement", ClaimType.MOVEMENT_DIRECTIVE, keys[0], MOVEMENT_DIRECTIVE_VALUE),
        ("ev-destination-open", "fixture-official-destination", ClaimType.DESTINATION_STATUS, keys[1], "OPEN"),
        ("ev-destination-hazard", "fixture-official-destination", ClaimType.DESTINATION_STATUS, keys[2], "ELIGIBLE"),
        ("ev-route-safety", "fixture-official-route", ClaimType.ROUTE_STATUS, keys[3], "VERIFIED_USABLE"),
    )
    for evidence_id, source_key, claim_type, key, value in status_specs:
        required_areas = {
            "ev-movement": (area_id,),
            "ev-destination-open": ("JP-13",),
            "ev-destination-hazard": ("JP-13",),
            "ev-route-safety": (area_id, "JP-13"),
        }[evidence_id]
        evidence.append(Evidence(
            id=evidence_id,
            situation_id=initial_state.situation.id,
            source_key=source_key,
            source_name=f"{source_key} fixture",
            source_class=SourceClass.OFFICIAL,
            trust_status=TrustStatus.VERIFIED_OFFICIAL,
            freshness_status=FreshnessStatus.CURRENT,
            published_at=published,
            received_at=published,
            relevant_areas=("Tokyo",),
            affected_area_ids=required_areas,
            claim_type=claim_type,
            claims=(Claim(key=key, value=value),),
            summary="Server-owned typed fixture for deterministic gate tests.",
            raw_reference="https://example.invalid/unit-fixture",
            is_synthetic=False,
        ))
    destination = DestinationRecord(
        id=destination_id,
        name="Fixture Designated Shelter",
        address="Fixture address",
        area_id="JP-13",
        coordinates=Coordinate(lat=35.68, lng=139.76),
        source_key="fixture-designation-catalog",
        source_name="Fixture designation catalog",
        source_url="https://example.invalid/destinations",
        source_published_at=published,
        designation_types=("designated shelter",),
        supported_hazards=(DisasterEventType.EARTHQUAKE,),
        open_status=DestinationOpenStatus.UNKNOWN,
        is_synthetic=False,
    )
    route_evidence = next(item for item in evidence if item.id == "ev-route-safety")
    route = RoutePresentation(
        id=route_id,
        status=RoutePresentationStatus.VERIFIED_USABLE,
        geometry=GeoJsonLineString(coordinates=((139.70, 35.66), (139.76, 35.68))),
        geometry_kind="PROVIDER_GEOMETRY",
        presentation_label="Official road authority test fixture route.",
        waypoints=("Origin", "Shelter"),
        origin_area_id=area_id,
        destination_id=destination_id,
        provider="Fixture road authority",
        provider_reference="fixture-route-1",
        checked_at=now - timedelta(seconds=10),
        expires_at=now + timedelta(minutes=2),
        evidence_ids=(route_evidence.id,),
        freshness_status=FreshnessStatus.CURRENT,
        conflict=False,
    )
    situation = initial_state.situation.model_copy(update={
        "active_event_ids": (event.id,),
        "incident_status": "EVENT_DETECTED",
        "updated_at": now,
    })
    state = replace(
        initial_state,
        situation=situation,
        events=(event,),
        evidence=tuple(evidence),
        destinations=(destination,),
        routes=(route,),
    )
    policy = SafetyPolicy(
        movement_directive_source_keys=("fixture-official-movement",),
        destination_status_source_keys=("fixture-official-destination",),
        route_status_source_keys=("fixture-official-route",),
    )
    return state, policy, route


def _generate_fixture_plan(state, policy):
    before = replace(state, situation=state.situation.model_copy(update={"active_event_ids": (), "incident_status": "IDLE"}), events=(), evidence=(), destinations=(), routes=())
    event = SimpleNamespace(id="spatial-fixture-evaluation")
    return evaluate_and_replan(before, state, event, policy)


def test_typed_server_source_evidence_can_authorize_high_risk_map_gate_positive(initial_state):
    state, policy, _route = _movement_state(initial_state)
    planned = _generate_fixture_plan(state, policy)
    plan = next(item for item in planned.plans if item.id == planned.situation.current_plan_id)
    action = next(item for item in planned.plan_actions if item.plan_id == plan.id and item.category == PlanActionCategory.NOW)
    projection = evaluated_spatial_guidance(planned, planned.current_time, policy)

    assert plan.status == PlanStatus.ACTIVE
    assert action.status == PlanActionStatus.ACTIVE
    assert action.intent_id == SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER
    assert action.risk_level.value == "HIGH"
    assert action.safety_decision.value == "ALLOW"
    assert projection.movement_authorized is True
    assert projection.map_mount_eligible is True
    assert projection.plan_id == plan.id
    assert projection.action_id == action.id


def test_candidate_route_replacement_invalidates_active_plan_and_appends_safe_version(initial_state):
    state, policy, route = _movement_state(initial_state)
    planned = _generate_fixture_plan(state, policy)
    replacement = route.model_copy(update={
        "id": "route-new-provider-candidate",
        "status": RoutePresentationStatus.CANDIDATE,
        "checked_at": planned.current_time,
        "expires_at": planned.current_time + timedelta(minutes=5),
        "evidence_ids": (),
        "geometry_kind": "NONE",
        "geometry": None,
    })
    after = replace(planned, routes=(*planned.routes, replacement))
    after = after.model_copy() if hasattr(after, "model_copy") else after
    reevaluated = evaluate_and_replan(
        planned,
        after,
        SimpleNamespace(id="route-change-event"),
        policy,
    )
    previous = next(item for item in reevaluated.plans if item.id == "plan_v1")
    current = next(item for item in reevaluated.plans if item.id == reevaluated.situation.current_plan_id)
    spatial = evaluated_spatial_guidance(reevaluated, reevaluated.current_time, policy)

    assert previous.status == PlanStatus.ACTIVE  # Published versions remain immutable history.
    assert reevaluated.plan_evaluations[-1].status == PlanEvaluationStatus.PARTIAL_INVALIDATION
    assert len(reevaluated.plans) == 2
    assert reevaluated.situation.current_plan_id != previous.id
    assert current.previous_plan_id == previous.id
    assert spatial.movement_authorized is False
    assert spatial.map_mount_eligible is False


def test_open_destination_evidence_expiry_invalidates_active_plan_and_replans(initial_state):
    state, _default_policy, route = _movement_state(initial_state)
    policy = SafetyPolicy(
        destination_ttl_seconds=60,
        movement_directive_source_keys=("fixture-official-movement",),
        destination_status_source_keys=("fixture-official-destination",),
        route_status_source_keys=("fixture-official-route",),
    )
    planned = _generate_fixture_plan(state, policy)
    old_plan = next(item for item in planned.plans if item.id == planned.situation.current_plan_id)
    open_evidence = next(item for item in state.evidence if item.id == "ev-destination-open")
    expiry = project_evidence(open_evidence, planned.current_time, policy).expires_at
    assert expiry < route.expires_at
    assert old_plan.expires_at == expiry
    now = expiry
    advanced = replace(planned, current_time=now, situation=planned.situation.model_copy(update={"updated_at": now}))
    reevaluated = evaluate_and_replan(
        planned,
        advanced,
        SimpleNamespace(id="spatial-expiry-event"),
        policy,
    )
    previous = next(item for item in reevaluated.plans if item.id == old_plan.id)
    spatial = evaluated_spatial_guidance(reevaluated, now, policy)

    assert previous.status == PlanStatus.ACTIVE  # Expiration is recorded in the evaluation history.
    assert reevaluated.plan_evaluations[-1].status == PlanEvaluationStatus.EXPIRED
    assert len(reevaluated.plans) == 2
    assert reevaluated.situation.current_plan_id == reevaluated.plans[-1].id
    assert spatial.movement_authorized is False
    assert spatial.map_mount_eligible is False


def test_hours_old_current_open_claim_cannot_authorize_a_static_designation(initial_state):
    state, policy, _route = _movement_state(initial_state)
    stale_at = state.current_time - timedelta(hours=3)
    evidence = tuple(
        item.model_copy(update={"published_at": stale_at, "received_at": stale_at})
        if item.id in {"ev-destination-open", "ev-destination-hazard"}
        else item
        for item in state.evidence
    )
    changed = replace(state, evidence=evidence)
    projection = evaluated_spatial_guidance(changed, changed.current_time, policy)
    assert projection.movement_authorized is False
    assert projection.map_mount_eligible is False


def test_default_runtime_policy_has_no_movement_source_authority(initial_state):
    state, _policy, _route = _movement_state(initial_state)
    projection = evaluated_spatial_guidance(state, state.current_time, SafetyPolicy())
    assert projection.movement_authorized is False
    assert projection.map_mount_eligible is False


def test_movement_gate_rejects_offline_reconnecting_and_wrong_route_origin(initial_state):
    state, policy, route = _movement_state(initial_state)
    for network_state in (NetworkState.OFFLINE_RECENT, NetworkState.OFFLINE_STALE, NetworkState.RECONNECTING):
        offline = replace(
            state,
            situation=state.situation.model_copy(update={"network_state": network_state}),
        )
        assert evaluated_spatial_guidance(offline, offline.current_time, policy).movement_authorized is False

    wrong_origin_route = route.model_copy(update={"origin_area_id": "JP-27"})
    wrong_origin = replace(state, routes=(wrong_origin_route,))
    assert evaluated_spatial_guidance(wrong_origin, wrong_origin.current_time, policy).movement_authorized is False


def test_movement_gate_rejects_transit_station_sequence_even_when_marked_verified(initial_state):
    state, policy, route = _movement_state(initial_state)
    station_sequence = route.model_copy(update={"geometry_kind": "TRANSIT_STATION_SEQUENCE"})
    changed = replace(state, routes=(station_sequence,))
    projection = evaluated_spatial_guidance(changed, changed.current_time, policy)
    assert projection.movement_authorized is False
    assert projection.map_mount_eligible is False


def test_movement_gate_requires_exact_area_scope_for_each_authority(initial_state):
    state, policy, _route = _movement_state(initial_state)
    for evidence_id in ("ev-movement", "ev-destination-open", "ev-destination-hazard", "ev-route-safety"):
        evidence = tuple(
            item.model_copy(update={"affected_area_ids": ("JP-27",)})
            if item.id == evidence_id else item
            for item in state.evidence
        )
        changed = replace(state, evidence=evidence)
        projection = evaluated_spatial_guidance(changed, changed.current_time, policy)
        assert projection.movement_authorized is False, evidence_id
