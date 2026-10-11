"""Typed, deterministic spatial movement evaluation shared by planning and API projection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from seventytwoh_contracts.models import (
    ClaimStateStatus,
    ClaimType,
    DestinationEligibility,
    DestinationOpenStatus,
    DestinationProjection,
    DisasterEventType,
    FreshnessStatus,
    LocationSource,
    NetworkState,
    PlanActionCategory,
    PlanActionStatus,
    PlanStatus,
    RoutePresentation,
    RoutePresentationStatus,
    SafeIntentId,
    SafetyDecision,
    RiskLevel,
    SpatialActionKind,
    SpatialGuidanceProjection,
    TrustStatus,
)

from .safety import SafetyPolicy, derive_claim_states, project_evidence
from .state import CoreState
from .location_freshness import gps_observation_is_fresh

MOVEMENT_DIRECTIVE_VALUE = "EVACUATE_TO_DESIGNATED_SHELTER"


@dataclass(frozen=True, slots=True)
class MovementSupport:
    destination_id: str
    route: RoutePresentation
    destination: DestinationProjection
    evidence_ids: tuple[str, ...]
    claim_keys: tuple[str, ...]
    expires_at: datetime


def movement_claim_keys(area_id: str, destination_id: str, route_id: str, hazard: str) -> tuple[str, ...]:
    return (
        f"movement.directive.{area_id}",
        f"destination.{destination_id}.open_status",
        f"destination.{destination_id}.hazard.{hazard}.suitability",
        f"route.{route_id}.safety_status",
    )


def resolve_movement_support(
    state: CoreState,
    now: datetime,
    policy: SafetyPolicy,
) -> MovementSupport | None:
    """Return support only when all three current typed source domains agree."""
    location_areas = state.profile.current_location.area_ids
    if not location_areas or state.situation.network_state != NetworkState.ONLINE_VERIFIED:
        return None
    current_location = state.profile.current_location
    if current_location.source == LocationSource.GPS:
        if not gps_observation_is_fresh(current_location.observed_at, now):
            return None
    hazard_types = {
        event.event_type for event in state.events
        if event.status.value == "ACTIVE" and event.event_type == DisasterEventType.EARTHQUAKE
    }
    if len(hazard_types) != 1:
        return None
    hazard = next(iter(hazard_types)).value
    # Preserve append order: a newly checked route replaces the prior decision even
    # when its provider timestamp has only second-level precision.
    latest_route = state.routes[-1] if state.routes else None
    if latest_route is None or latest_route.destination_id is None:
        return None
    route = latest_route
    if state.last_reconnect_at is not None and route.checked_at < state.last_reconnect_at:
        return None
    destination_record = next((item for item in state.destinations if item.id == route.destination_id), None)
    if destination_record is None or destination_record.is_synthetic:
        return None
    if (
        route.status != RoutePresentationStatus.VERIFIED_USABLE
        or route.geometry is None
        or route.geometry_kind != "PROVIDER_GEOMETRY"
        or route.origin_area_id != location_areas[0]
        or route.conflict
        or route.freshness_status != FreshnessStatus.CURRENT
        or now < route.checked_at
        or now >= route.expires_at
    ):
        return None

    claim_states, conflict_keys, conflict_evidence_ids = derive_claim_states(
        state.situation,
        state.evidence,
        now,
        policy,
        events=state.events,
    )
    claims = {item.key: item for item in claim_states}
    conflicts = set(conflict_keys)
    conflicting_ids = set(conflict_evidence_ids)
    keys = movement_claim_keys(location_areas[0], destination_record.id, route.id, hazard)
    expected_values = (
        MOVEMENT_DIRECTIVE_VALUE,
        DestinationOpenStatus.OPEN.value,
        DestinationEligibility.ELIGIBLE.value,
        RoutePresentationStatus.VERIFIED_USABLE.value,
    )
    type_and_sources = (
        (ClaimType.MOVEMENT_DIRECTIVE, set(policy.movement_directive_source_keys)),
        (ClaimType.DESTINATION_STATUS, set(policy.destination_status_source_keys)),
        (ClaimType.DESTINATION_STATUS, set(policy.destination_status_source_keys)),
        (ClaimType.ROUTE_STATUS, set(policy.route_status_source_keys)),
    )
    required_area_scopes = (
        {location_areas[0]},
        {destination_record.area_id},
        {destination_record.area_id},
        {location_areas[0], destination_record.area_id},
    )
    supported_ids: set[str] = set()
    for key, expected, (claim_type, source_keys), required_areas in zip(
        keys, expected_values, type_and_sources, required_area_scopes, strict=True
    ):
        if not source_keys or key in conflicts:
            return None
        claim = claims.get(key)
        if claim is None or claim.status != ClaimStateStatus.VERIFIED or claim.value != expected:
            return None
        allowed = [
            evidence for evidence in state.evidence
            if evidence.id in claim.evidence_ids
            and evidence.claim_type == claim_type
            and evidence.source_key in source_keys
            and evidence.source_class.value == "OFFICIAL"
            and evidence.trust_status == TrustStatus.VERIFIED_OFFICIAL
            and required_areas.issubset(evidence.affected_area_ids)
            and not evidence.is_synthetic
            and not evidence.conflict
            and evidence.id not in conflicting_ids
            and project_evidence(evidence, now, policy).eligible_for_high_risk
            and (
                state.last_reconnect_at is None
                or (
                    evidence.published_at >= state.last_reconnect_at
                    and evidence.received_at >= state.last_reconnect_at
                )
            )
        ]
        if not allowed:
            return None
        supported_ids.update(item.id for item in allowed)

    route_status_ids = {
        evidence.id for evidence in state.evidence
        if evidence.id in supported_ids
        and evidence.claim_type == ClaimType.ROUTE_STATUS
        and evidence.source_key in policy.route_status_source_keys
    }
    if not route_status_ids.intersection(route.evidence_ids):
        return None
    movement_ids = {
        evidence.id for evidence in state.evidence
        if evidence.id in supported_ids and evidence.claim_type == ClaimType.MOVEMENT_DIRECTIVE
    }
    destination_evidence_ids = tuple(sorted(supported_ids - route_status_ids - movement_ids))
    if not destination_evidence_ids:
        return None
    destination_checked = max(
        item.published_at for item in state.evidence if item.id in destination_evidence_ids
    )
    destination_expires = min(
        project_evidence(item, now, policy).expires_at
        for item in state.evidence
        if item.id in destination_evidence_ids
    )
    if not destination_checked <= now < destination_expires:
        return None
    if destination_expires <= destination_checked:
        return None
    destination = DestinationProjection(
        destination_id=destination_record.id,
        eligibility=DestinationEligibility.ELIGIBLE,
        hazard_type=DisasterEventType(hazard),
        hazard_suitability=DestinationEligibility.ELIGIBLE,
        freshness_status=FreshnessStatus.CURRENT,
        conflict=False,
        evidence_ids=destination_evidence_ids,
        current_open_status=DestinationOpenStatus.OPEN,
        checked_at=destination_checked,
        expires_at=destination_expires,
    )
    route_evidence_expiry = min(
        project_evidence(item, now, policy).expires_at
        for item in state.evidence
        if item.id in route_status_ids
    )
    route_expiry = min(route.expires_at, route_evidence_expiry)
    if route_expiry <= route.checked_at or now >= route_expiry:
        return None
    if route_expiry != route.expires_at:
        route = route.model_copy(update={"expires_at": route_expiry})
    return MovementSupport(
        destination_id=destination_record.id,
        route=route,
        destination=destination,
        evidence_ids=tuple(sorted(supported_ids)),
        claim_keys=keys,
        expires_at=min(destination_expires, route_expiry),
    )


def evaluated_spatial_guidance(
    state: CoreState,
    now: datetime,
    policy: SafetyPolicy,
) -> SpatialGuidanceProjection:
    """Compute map/movement gate from typed evidence and the active Safety Core plan."""
    plan = next((item for item in state.plans if item.id == state.situation.current_plan_id), None)
    action = next(
        (
            item for item in reversed(state.plan_actions)
            if plan is not None
            and item.plan_id == plan.id
            and item.category == PlanActionCategory.NOW
            and item.status == PlanActionStatus.ACTIVE
        ),
        None,
    )
    support = resolve_movement_support(state, now, policy)
    authorized = bool(
        plan is not None
        and plan.status == PlanStatus.ACTIVE
        and now < plan.expires_at
        and action is not None
        and action.intent_id == SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER
        and action.risk_level == RiskLevel.HIGH
        and action.safety_decision == SafetyDecision.ALLOW
        and support is not None
        and set(support.evidence_ids).issubset(action.evidence_ids)
        and set(support.claim_keys).issubset(action.dependency_keys)
    )
    reasons: list[str] = []
    if not authorized:
        if not policy.movement_directive_source_keys:
            reasons.append("NO_SUPPORTED_LIVE_MOVEMENT_DIRECTIVE")
        if support is None:
            reasons.append("DESTINATION_OR_ROUTE_EVIDENCE_IS_NOT_CURRENT_AND_ELIGIBLE")
        if action is None or action.intent_id != SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER:
            reasons.append("ACTIVE_SAFETY_CORE_PLAN_DOES_NOT_ALLOW_EVACUATION")
    if authorized and support is not None:
        destination_projection = support.destination
        route_projection = support.route
        action_kind = SpatialActionKind.EVACUATE
        reasons = []
    else:
        route_projection = state.routes[-1] if state.routes else None
        destination_record = next(
            (item for item in state.destinations if route_projection and item.id == route_projection.destination_id),
            None,
        )
        if destination_record is None:
            destination_projection = None
        else:
            # A missing catalog publication timestamp must not be fabricated;
            # the projection still stays UNKNOWN/STALE and uses evaluation time
            # only to satisfy its bounded projection interval.
            checked_at = destination_record.source_published_at or now
            destination_projection = DestinationProjection(
                destination_id=destination_record.id,
                eligibility=DestinationEligibility.UNKNOWN,
                hazard_type=None,
                hazard_suitability=DestinationEligibility.UNKNOWN,
                freshness_status=FreshnessStatus.STALE,
                conflict=False,
                evidence_ids=(),
                current_open_status=DestinationOpenStatus.UNKNOWN,
                checked_at=checked_at,
                expires_at=checked_at + timedelta(seconds=policy.destination_ttl_seconds),
            )
        if route_projection is not None and now >= route_projection.expires_at:
            route_projection = route_projection.model_copy(
                update={"status": RoutePresentationStatus.EXPIRED, "freshness_status": FreshnessStatus.STALE}
            )
        action_kind = (
            SpatialActionKind.MONITOR
            if action is not None and action.intent_id != SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER
            else SpatialActionKind.UNKNOWN
        )
        if route_projection is not None and route_projection.status != RoutePresentationStatus.VERIFIED_USABLE:
            reasons.append("ROUTE_IS_PROVIDER_CANDIDATE_ONLY")
        if not reasons:
            reasons.append("NO_SPATIAL_ACTION_REQUIRED")
    return SpatialGuidanceProjection(
        current_action_kind=action_kind,
        movement_authorized=authorized,
        destination=destination_projection,
        route=route_projection,
        plan_id=plan.id if authorized and plan is not None else None,
        action_id=action.id if authorized and action is not None else None,
        evaluated_at=now,
        gate_reasons=tuple(dict.fromkeys(reasons))[:16],
    )
