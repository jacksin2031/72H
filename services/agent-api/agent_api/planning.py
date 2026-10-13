"""Deterministic plan evaluation and conservative replay planning."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta

from seventytwoh_contracts.models import (
    AgentName,
    ClaimStateStatus,
    CandidateActionSelection,
    CandidatePlanSelection,
    DependencyExpectation,
    DisasterEvent,
    DisasterEventType,
    DisasterEventStatus,
    DistressLevel,
    DistressStatus,
    DistressTag,
    Evidence,
    EvidenceProjection,
    FreshnessStatus,
    NetworkState,
    Plan,
    PlanAction,
    PlanActionCategory,
    PlanActionStatus,
    PlanEvaluation,
    PlanEvaluationStatus,
    PlanStatus,
    RiskLevel,
    SafetyDecision,
    SafeIntentId,
    Situation,
    SituationClaim,
    TraceEvent,
    TraceStatus,
    TrustStatus,
)

from .distress import distress_signature, official_tsunami_trigger, resolve_distress
from .domain import append_plan
from .live_sources import JMA_SOURCE_KEY, JMA_TSUNAMI_SOURCE_KEY
from .safety import (
    DEFAULT_POLICY,
    SafetyPolicy,
    current_claim_value,
    derive_claim_states,
    expires_at_for,
    project_evidence,
    disaster_claim_key,
    route_claim_key,
)
from .state import CoreState
from .official_events import official_event_group
from .spatial import MovementSupport, resolve_movement_support

TRUSTED_STATUSES = {TrustStatus.VERIFIED_OFFICIAL, TrustStatus.VERIFIED_PARTNER}


def disaster_status_claim_keys(state: CoreState) -> tuple[str, ...]:
    area_ids = state.profile.current_location.area_ids
    if not area_ids:
        return ()
    event_types = {
        event.event_type for event in state.events
    } | {
        assessment.event_type
        for evidence in state.evidence
        for assessment in evidence.disaster_assessments
    }
    # Keep both supported official hazard claims in every plan dependency set.
    # This lets a later live tsunami bulletin invalidate a plan that was created
    # while tsunami status was unknown, without treating an empty poll as evidence.
    event_types.update({DisasterEventType.EARTHQUAKE, DisasterEventType.TSUNAMI})
    return tuple(
        disaster_claim_key(area_id, event_type.value, "status")
        for event_type in sorted(event_types, key=lambda item: item.value)
        for area_id in area_ids
    )


def route_status_claim_key(state: CoreState) -> str | None:
    current = state.profile.current_location.area_ids
    destination = (
        state.profile.current_destination.area_ids
        if state.profile.current_destination is not None
        else ()
    )
    if not current or not destination:
        return None
    return route_claim_key(current[0], destination[0])


INTENT_DESCRIPTIONS = {
    SafeIntentId.PROTECT_AND_MONITOR: "Prioritize personal safety and monitor verified updates.",
    SafeIntentId.REVIEW_OFFICIAL_GUIDANCE: "Review verified official guidance and follow local instructions.",
    SafeIntentId.WAIT_FOR_TRANSPORT_UPDATE: "Wait for verified transport updates before reconsidering travel.",
    SafeIntentId.RECHECK_TRANSPORT_STATUS: "Recheck verified transport status before reconsidering travel.",
    SafeIntentId.AVOID_DISRUPTED_ROUTE: "Avoid relying on a route with a verified disruption.",
    SafeIntentId.DO_NOT_ASSUME_ROUTE_SAFETY: "Do not infer route or personal safety from transport status.",
}
PUBLIC_PLANNER_REASON_CODES = frozenset(
    {
        "MISSING_ADC",
        "TIMEOUT",
        "INVALID_OUTPUT",
        "SESSION_CALL_LIMIT",
        "GLOBAL_RATE_LIMIT",
        "GLOBAL_CALL_LIMIT",
        "INPUT_LIMIT",
        "SDK_ERROR",
        "CONFIG_ERROR",
        "PROVIDER_ERROR",
    }
)


def evidence_projections(
    evidence: tuple[Evidence, ...],
    situation: Situation,
    current_time,
    policy: SafetyPolicy = DEFAULT_POLICY,
    *,
    events: tuple[DisasterEvent, ...] = (),
) -> tuple[EvidenceProjection, ...]:
    claims, _, conflict_evidence_ids = derive_claim_states(
        situation,
        evidence,
        current_time,
        policy,
        events=events,
    )
    del claims
    conflict_ids = set(conflict_evidence_ids)
    return tuple(
        project_evidence(item, current_time, policy, conflict=item.id in conflict_ids)
        for item in evidence
    )


def candidate_context_for_preview(
    before: CoreState,
    preview: CoreState,
    policy: SafetyPolicy = DEFAULT_POLICY,
) -> dict[str, object] | None:
    """Build a prompt from bounded trusted state and catalog IDs, never report prose."""
    previous_plan_ids = {plan.id for plan in before.plans}
    generated_plan = next((plan for plan in reversed(preview.plans) if plan.id not in previous_plan_ids), None)
    if generated_plan is None:
        return None
    actions = _actions_for_plan(preview, generated_plan.id)
    changed_ids = set(generated_plan.changed_action_ids)
    target_actions = [action for action in actions if action.id in changed_ids]
    if any(action.intent_id == SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER for action in target_actions):
        return None
    projections = {
        item.evidence_id: item
        for item in evidence_projections(
            preview.evidence,
            preview.situation,
            preview.current_time,
            policy,
            events=preview.events,
        )
    }
    claims = {item.key: item for item in preview.situation.claim_states}
    route_key = route_status_claim_key(preview)
    route_value = current_claim_value(claims.get(route_key)) if route_key else ClaimStateStatus.UNKNOWN.value
    choices: list[dict[str, object]] = []
    for action in target_actions:
        key = next(
            (dependency for dependency in action.dependency_keys if dependency.startswith("disaster.")),
            None,
        ) if action.category == PlanActionCategory.NOW else route_key
        eligible_ids = _eligible_ids_for_claim(claims.get(key), projections)
        options = [
            {
                "intent_id": intent.value,
                "description": INTENT_DESCRIPTIONS[intent],
                "eligible_evidence_ids": list(eligible_ids),
            }
            for intent in _intent_options(action.category, route_value)
        ]
        choices.append({"category": action.category.value, "options": options})
    return {
        "language": preview.profile.preferred_language.value,
        "verified_claims": [
            {"key": key, "status": claims[key].status.value, "value": claims[key].value}
            for key in sorted(
                {
                    *disaster_status_claim_keys(preview),
                    *((route_key,) if route_key else ()),
                }
            )
            if key in claims
        ],
        "choices": choices,
    }


def validate_candidate_selection(
    selection: CandidatePlanSelection,
    context: dict[str, object],
) -> CandidatePlanSelection:
    """Validate model selections again at the domain boundary before plan append."""
    expected_choices = {
        str(item["category"]): item["options"]
        for item in context["choices"]  # type: ignore[index]
    }
    received = {choice.category.value: choice for choice in selection.choices}
    if set(received) != set(expected_choices):
        raise ValueError("OUTPUT_REJECTED: candidate categories do not match requested plan actions")
    for category, choice in received.items():
        options = expected_choices[category]
        option = next(
            (item for item in options if item["intent_id"] == choice.intent_id.value),
            None,
        )
        if option is None:
            raise ValueError("OUTPUT_REJECTED: unknown or unsafe intent for category")
        allowed_ids = tuple(option["eligible_evidence_ids"])
        if len(choice.evidence_ids) != len(set(choice.evidence_ids)):
            raise ValueError("OUTPUT_REJECTED: candidate evidence references must be unique")
        if any(reference not in allowed_ids for reference in choice.evidence_ids):
            raise ValueError("OUTPUT_REJECTED: candidate references ineligible or mismatched evidence")
        if allowed_ids and not choice.evidence_ids:
            raise ValueError("OUTPUT_REJECTED: candidate omitted required eligible evidence references")
        if not allowed_ids and choice.evidence_ids:
            raise ValueError("OUTPUT_REJECTED: no eligible evidence supports this intent")
    return selection


def _intent_options(
    category: PlanActionCategory,
    route_value: object,
) -> tuple[SafeIntentId, ...]:
    if category == PlanActionCategory.NOW:
        return (SafeIntentId.PROTECT_AND_MONITOR, SafeIntentId.REVIEW_OFFICIAL_GUIDANCE)
    if category == PlanActionCategory.NEXT:
        return (SafeIntentId.WAIT_FOR_TRANSPORT_UPDATE, SafeIntentId.RECHECK_TRANSPORT_STATUS)
    if route_value == "DISRUPTED":
        return (SafeIntentId.AVOID_DISRUPTED_ROUTE, SafeIntentId.DO_NOT_ASSUME_ROUTE_SAFETY)
    return (SafeIntentId.DO_NOT_ASSUME_ROUTE_SAFETY,)


def _default_intent(category: PlanActionCategory, route_value: object) -> SafeIntentId:
    if category == PlanActionCategory.NOW:
        return SafeIntentId.PROTECT_AND_MONITOR
    if category == PlanActionCategory.NEXT:
        return SafeIntentId.WAIT_FOR_TRANSPORT_UPDATE
    if route_value == "DISRUPTED":
        return SafeIntentId.AVOID_DISRUPTED_ROUTE
    return SafeIntentId.DO_NOT_ASSUME_ROUTE_SAFETY


def evaluate_and_replan(
    before: CoreState,
    after: CoreState,
    event,
    policy: SafetyPolicy = DEFAULT_POLICY,
    *,
    allow_network_reconciliation: bool = True,
) -> CoreState:
    """Rebuild current projections, evaluate plan dependencies, and append new versions."""
    claim_states, conflict_keys, conflict_evidence_ids = derive_claim_states(
        after.situation,
        after.evidence,
        after.current_time,
        policy,
        events=after.events,
    )
    conflict_ids = set(conflict_evidence_ids)
    projections = tuple(
        project_evidence(item, after.current_time, policy, conflict=item.id in conflict_ids)
        for item in after.evidence
    )
    projection_by_id = {item.evidence_id: item for item in projections}
    claim_by_key = {item.key: item for item in claim_states}
    uncertainty_flags = [
        f"UNKNOWN_CLAIM:{item.key}"
        for item in claim_states
        if item.status == ClaimStateStatus.UNKNOWN
    ]
    uncertainty_flags.extend(f"CONFLICTING_CLAIM:{key}" for key in conflict_keys)
    if any(
        projection.freshness_status == FreshnessStatus.STALE
        and evidence.trust_status in TRUSTED_STATUSES
        for evidence, projection in zip(after.evidence, projections)
    ):
        uncertainty_flags.append("STALE_TRUSTED_EVIDENCE_PRESENT")
    if any(evidence.trust_status == TrustStatus.UNVERIFIED for evidence in after.evidence):
        uncertainty_flags.append("UNVERIFIED_SOURCE_PRESENT")

    situation = after.situation.model_copy(
        update={
            "claim_states": claim_states,
            "conflict_flags": conflict_keys,
            "uncertainty_flags": tuple(uncertainty_flags),
        }
    )
    after = replace(after, situation=situation)

    new_ids = {item.id for item in after.evidence} - {item.id for item in before.evidence}
    newly_verified = [
        item
        for item in after.evidence
        if item.id in new_ids
        and item.trust_status in TRUSTED_STATUSES
        and projection_by_id[item.id].eligible_for_claims
    ]
    if newly_verified:
        latest = max(item.received_at for item in newly_verified)
        situation = after.situation.model_copy(
            update={"latest_evidence_at": max(
                (at for at in (after.situation.latest_evidence_at, latest) if at is not None),
            )}
        )
        after = replace(after, situation=situation)

    if allow_network_reconciliation:
        after = _reconcile_network_if_ready(after, projection_by_id, event)

    old_claims = {item.key: item for item in before.situation.claim_states}
    changed_keys = {
        key
        for key in set(old_claims) | set(claim_by_key)
        if current_claim_value(old_claims.get(key)) != current_claim_value(claim_by_key.get(key))
        or _claim_status(old_claims.get(key)) != _claim_status(claim_by_key.get(key))
    }
    current_plan = next(
        (plan for plan in after.plans if plan.id == after.situation.current_plan_id),
        None,
    )
    current_actions = _actions_for_plan(after, current_plan.id) if current_plan else ()
    # Only an area-scope or source change re-evaluates the plan. A same-area GPS refresh
    # (new observed_at / lat / lng) must not invalidate HIGH actions or append plan
    # versions; spatial dependencies that need coordinates are checked separately below.
    location_changed = _location_scope_changed(
        before.profile.current_location, after.profile.current_location
    )
    profile_context_changed = any(
        getattr(before.profile, field) != getattr(after.profile, field)
        for field in (
            "accommodation_location",
            "party_size",
            "self_reported_safety_status",
            "accessibility_constraints",
        )
    )
    # `after.situation.claim_states` was refreshed above from current evidence, so the
    # after-signature sees the same claim states that _generate_plan will use.
    distress_changed = distress_signature(before, before.current_time, policy) != distress_signature(
        after, after.current_time, policy
    )
    distress_now = resolve_distress(after, after.current_time, policy)
    dependency_keys = {
        key for action in current_actions for key in action.dependency_keys
    }
    changed_dependencies = changed_keys & dependency_keys
    new_relevant_keys = {
        claim.key
        for item in newly_verified
        for claim in item.claims
        if claim.key in dependency_keys
    }
    expired_current = bool(
        current_plan and after.current_time >= current_plan.expires_at
    )
    movement_support = resolve_movement_support(after, after.current_time, policy)
    spatial_dependency_changed = _spatial_dependency_changed(after, current_actions, policy)
    verified_disaster = next(
        (
            claim_by_key[key]
            for key in disaster_status_claim_keys(after)
            if key in claim_by_key
            and claim_by_key[key].status == ClaimStateStatus.VERIFIED
            and claim_by_key[key].value == "ACTIVE"
        ),
        None,
    )
    can_start_initial_plan = bool(
        current_plan is None
        and (
            (after.situation.active_event_ids and verified_disaster is not None)
            or distress_now.level != DistressLevel.NONE
        )
    )
    should_review = bool(
        changed_dependencies
        or new_relevant_keys
        or expired_current
        or spatial_dependency_changed
        or location_changed
        or profile_context_changed
        or can_start_initial_plan
        or distress_changed
    )

    if current_plan and should_review:
        evaluation = _evaluate_plan(
            current_plan,
            current_actions,
            claim_by_key,
            projection_by_id,
            after.current_time,
            changed_dependencies,
            after,
            policy,
            location_changed,
            distress_changed,
        )
        after = _append_evaluation(after, evaluation, event)
        if evaluation.status in {
            PlanEvaluationStatus.PARTIAL_INVALIDATION,
            PlanEvaluationStatus.INVALIDATED,
            PlanEvaluationStatus.EXPIRED,
        }:
            after = _emit_trace(
                after,
                event,
                "PLAN_INVALIDATED",
                TraceStatus.SUCCESS,
                evaluation.invalid_action_ids,
                evaluation.reason,
                agent=AgentName.SAFETY_CORE,
            )
            after = replace(
                after,
                situation=after.situation.model_copy(update={"current_plan_id": None}),
            )
            after = _generate_plan(
                after,
                current_plan,
                set(evaluation.invalid_action_ids),
                projection_by_id,
                policy,
                event,
            )
        else:
            after = _emit_trace(
                after,
                event,
                "PLAN_EVALUATED",
                TraceStatus.SUCCESS,
                (current_plan.id,),
                evaluation.reason,
                agent=AgentName.SAFETY_CORE,
            )
    elif can_start_initial_plan or (current_plan is None and movement_support is not None):
        after = _generate_plan(
            after,
            None,
            set(),
            projection_by_id,
            policy,
            event,
        )

    after = _expire_historical_plans(after, event)
    if len(after.plan_evaluations) > 512:
        raise ValueError("plan evaluation history limit reached")
    return after


# High-risk intents that may be allowed only when the caller passes deterministic
# authorization evidence (movement support or an official tsunami trigger).
_AUTHORIZABLE_HIGH_RISK_INTENTS = frozenset({
    SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER,
    SafeIntentId.TSUNAMI_EVACUATE_NOW,
})


def assess_action(
    action: PlanAction,
    evidence_by_id: dict[str, Evidence],
    projection_by_id: dict[str, EvidenceProjection],
    *,
    authorized_movement_evidence_ids: tuple[str, ...] = (),
) -> PlanAction:
    """Apply deterministic structural checks; generated wording is server-owned."""
    if any(reference not in evidence_by_id for reference in action.evidence_ids):
        raise ValueError("OUTPUT_REJECTED: action references unknown evidence")

    eligible = [
        reference
        for reference in action.evidence_ids
        if projection_by_id.get(reference) is not None
        and projection_by_id[reference].eligible_for_claims
    ]
    if action.risk_level == RiskLevel.HIGH:
        if not any(projection_by_id[reference].eligible_for_high_risk for reference in eligible):
            return action.model_copy(
                update={
                    "status": PlanActionStatus.BLOCKED,
                    "safety_decision": SafetyDecision.BLOCK,
                    "text": "This high-risk action is blocked because live verified support is unavailable.",
                    "reason": "Synthetic replay, stale, conflicting, unverified, or missing evidence cannot authorize it.",
                    "evidence_ids": tuple(eligible),
                    "confidence_class": "UNKNOWN",
                }
            )
        if (
            action.intent_id in _AUTHORIZABLE_HIGH_RISK_INTENTS
            and authorized_movement_evidence_ids
            and set(authorized_movement_evidence_ids).issubset(action.evidence_ids)
            and all(
                reference in eligible
                and projection_by_id[reference].eligible_for_high_risk
                for reference in authorized_movement_evidence_ids
            )
        ):
            return action.model_copy(
                update={
                    "status": PlanActionStatus.ACTIVE,
                    "safety_decision": SafetyDecision.ALLOW,
                    "confidence_class": "HIGH",
                }
            )
        # No other high-risk action has a deterministic allowlist.
        return action.model_copy(
            update={
                "status": PlanActionStatus.BLOCKED,
                "safety_decision": SafetyDecision.BLOCK,
                "text": "This high-risk action is blocked pending a deterministic policy rule.",
                "reason": "The Phase 2 policy does not allow unclassified high-risk actions.",
                "evidence_ids": tuple(eligible),
                "confidence_class": "UNKNOWN",
            }
        )
    if action.risk_level == RiskLevel.MEDIUM and not eligible:
        return action.model_copy(
            update={
                "status": PlanActionStatus.ACTIVE,
                "safety_decision": SafetyDecision.WAIT_FOR_EVIDENCE,
                "evidence_ids": (),
                "confidence_class": "UNKNOWN",
            }
        )
    if action.risk_level == RiskLevel.MEDIUM:
        return action.model_copy(update={"confidence_class": "LOW"})
    return action.model_copy(update={"confidence_class": "LOW"})


def _jma_official_group(event_identity: str) -> str | None:
    return official_event_group(event_identity)


def _reconcile_network_if_ready(
    state: CoreState,
    projections: dict[str, EvidenceProjection],
    event,
) -> CoreState:
    if state.situation.network_state != NetworkState.RECONNECTING or not state.official_recovery_ready:
        return state
    reconnect = next(
        (item for item in reversed(state.trace) if item.event_type == "NETWORK_RESTORED"),
        None,
    )
    if reconnect is None:
        return state

    official_keys = set(disaster_status_claim_keys(state))
    route_key = route_status_claim_key(state)
    evidence_after_reconnect = state.evidence[
        state.reconnect_evidence_count or 0 :
    ]

    source_key_by_type = {
        DisasterEventType.EARTHQUAKE: JMA_SOURCE_KEY,
        DisasterEventType.TSUNAMI: JMA_TSUNAMI_SOURCE_KEY,
    }
    active_ids = set(state.situation.active_event_ids)
    active_events = [item for item in state.events if item.id in active_ids]
    if active_ids and not active_events:
        # A dangling active event cannot be reconciled by unrelated source data.
        return state

    active_events_by_type: dict[DisasterEventType, list] = {}
    for active_event in active_events:
        active_events_by_type.setdefault(active_event.event_type, []).append(active_event)

    typed_keys_by_type = {
        event_type: {
            key for key in official_keys
            if key.startswith(f"disaster.{event_type.value}.")
        }
        for event_type in source_key_by_type
    }

    def post_restore_verified(evidence_item: Evidence) -> bool:
        projection = projections.get(evidence_item.id)
        return (
            evidence_item.source_class.value == "OFFICIAL"
            and evidence_item.trust_status in TRUSTED_STATUSES
            and evidence_item.received_at >= reconnect.timestamp
            and evidence_item.published_at >= reconnect.timestamp
            and projection is not None
            and projection.eligible_for_claims
        )

    # A verified post-restore cancellation is itself required source evidence,
    # even though applying it has already removed that event from active IDs.
    resolved_requirements: set[
        tuple[DisasterEventType, str | None, str | None, frozenset[str]]
    ] = set()
    for evidence_item in evidence_after_reconnect:
        if not post_restore_verified(evidence_item):
            continue
        for assessment in evidence_item.disaster_assessments:
            if assessment.status != DisasterEventStatus.RESOLVED:
                continue
            expected_source_key = source_key_by_type.get(assessment.event_type)
            if expected_source_key is None or not typed_keys_by_type.get(assessment.event_type):
                continue
            if not evidence_item.is_synthetic and evidence_item.source_key != expected_source_key:
                continue
            matching_keys = typed_keys_by_type[assessment.event_type].intersection(
                claim.key for claim in evidence_item.claims
            )
            if matching_keys:
                group = (
                    _jma_official_group(evidence_item.id.removeprefix("ev_"))
                    if assessment.event_type == DisasterEventType.TSUNAMI
                    and not evidence_item.is_synthetic
                    else None
                )
                if assessment.event_type == DisasterEventType.TSUNAMI and not evidence_item.is_synthetic and group is None:
                    continue
                resolved_requirements.add((
                    assessment.event_type,
                    None if evidence_item.is_synthetic else expected_source_key,
                    group,
                    frozenset(matching_keys),
                ))

    # Real JMA requirements are grouped by information unit. A cancellation for
    # one group cannot satisfy another group's still-active reconnect requirement.
    required_evidence: dict[
        tuple[str, str | None, DisasterEventType | None, str | None], set[str]
    ] = {}
    for event_type, matching_active in active_events_by_type.items():
        expected_source_key = source_key_by_type.get(event_type)
        claim_keys = typed_keys_by_type.get(event_type, set())
        if not claim_keys or expected_source_key is None:
            return state
        if event_type == DisasterEventType.TSUNAMI or (
            event_type == DisasterEventType.EARTHQUAKE
            and all(item.is_synthetic or _jma_official_group(item.id) is not None for item in matching_active)
        ):
            real_groups: dict[str, DisasterEvent] = {}
            synthetic_active = False
            evidence_by_id = {item.id: item for item in state.evidence}
            for active_event in matching_active:
                if active_event.is_synthetic:
                    synthetic_active = True
                    continue
                group = _jma_official_group(active_event.id)
                if group is None:
                    return state
                existing_event = real_groups.get(group)
                existing_evidence = (
                    evidence_by_id.get(f"ev_{existing_event.id}")
                    if existing_event is not None
                    else None
                )
                candidate_evidence = evidence_by_id.get(f"ev_{active_event.id}")
                if candidate_evidence is None or candidate_evidence.source_key != expected_source_key:
                    return state
                if existing_event is None or existing_evidence is None or (
                    candidate_evidence.published_at,
                    candidate_evidence.received_at,
                    candidate_evidence.id,
                ) > (
                    existing_evidence.published_at,
                    existing_evidence.received_at,
                    existing_evidence.id,
                ):
                    real_groups[group] = active_event
            for group, active_event in real_groups.items():
                relevant_keys = {
                    disaster_claim_key(area_id, event_type.value, "status")
                    for area_id in active_event.affected_area_ids
                }.intersection(claim_keys)
                if relevant_keys:
                    required_evidence[("OFFICIAL", expected_source_key, event_type, group)] = relevant_keys
            if synthetic_active:
                required_evidence[("OFFICIAL", None, event_type, None)] = claim_keys
        elif any(not item.is_synthetic for item in matching_active):
            required_evidence[("OFFICIAL", expected_source_key, event_type, None)] = claim_keys
        else:
            required_evidence[("OFFICIAL", None, event_type, None)] = claim_keys

    for event_type, source_key, group, claim_keys in resolved_requirements:
        if not typed_keys_by_type.get(event_type):
            continue
        required_evidence.setdefault(
            ("OFFICIAL", source_key, event_type, group), set()
        ).update(claim_keys)

    if not required_evidence:
        return state

    needs_partner = bool(active_ids and route_key is not None)
    if needs_partner:
        required_evidence[("PARTNER", None, None, None)] = {route_key}
    fresh_after_reconnect: dict[
        tuple[str, str | None, DisasterEventType | None, str | None], list[Evidence]
    ] = {key: [] for key in required_evidence}
    for evidence in evidence_after_reconnect:
        source_class = evidence.source_class.value
        projection = projections.get(evidence.id)
        if (
            evidence.trust_status not in TRUSTED_STATUSES
            or evidence.received_at < reconnect.timestamp
            or evidence.published_at < reconnect.timestamp
            or projection is None
            or not projection.eligible_for_claims
        ):
            continue
        claim_set = {claim.key for claim in evidence.claims}
        for requirement, claim_keys in required_evidence.items():
            required_class, required_source_key, _event_type, required_group = requirement
            if source_class != required_class:
                continue
            if required_source_key is not None and evidence.source_key != required_source_key:
                continue
            if required_group is not None and _jma_official_group(evidence.id.removeprefix("ev_")) != required_group:
                continue
            if claim_keys.intersection(claim_set):
                fresh_after_reconnect[requirement].append(evidence)

    if any(not items for items in fresh_after_reconnect.values()):
        return state
    reconciled_ids = tuple(
        max(items, key=lambda item: (item.received_at, item.id)).id
        for _, items in sorted(fresh_after_reconnect.items(), key=lambda item: str(item[0]))
    )
    situation = state.situation.model_copy(
        update={
            "network_state": NetworkState.ONLINE_VERIFIED,
            "updated_at": state.current_time,
        }
    )
    state = replace(state, situation=situation, reconnect_evidence_count=None)
    return _emit_trace(
        state,
        event,
        "RECONCILIATION_COMPLETED",
        TraceStatus.SUCCESS,
        reconciled_ids,
        "Fresh official and transport evidence were validated and reconciled after reconnect.",
        agent=AgentName.SYNC_ENGINE,
    )


def _evaluate_plan(
    plan: Plan,
    actions: tuple[PlanAction, ...],
    claims: dict[str, SituationClaim],
    projections: dict[str, EvidenceProjection],
    current_time,
    changed_dependencies: set[str],
    state: CoreState,
    policy: SafetyPolicy,
    location_changed: bool = False,
    distress_changed: bool = False,
) -> PlanEvaluation:
    if current_time >= plan.expires_at:
        return PlanEvaluation(
            plan_id=plan.id,
            status=PlanEvaluationStatus.EXPIRED,
            evaluated_at=current_time,
            reason="The plan reached its deterministic expiration time.",
            invalid_action_ids=tuple(action.id for action in actions),
        )

    invalid: list[str] = []
    reasons: list[str] = []
    for action in actions:
        action_invalid = False
        if location_changed and action.risk_level == RiskLevel.HIGH:
            action_invalid = True
            reasons.append("the current location changed; the previous high-risk action is no longer current")
        if distress_changed and action.category == PlanActionCategory.NOW:
            action_invalid = True
            reasons.append("the distress level changed; the NOW action must be re-evaluated")
        expected_values = action.dependency_values
        for key in action.dependency_keys:
            if key not in expected_values:
                continue
            actual = current_claim_value(claims.get(key))
            if key in changed_dependencies or actual != expected_values[key]:
                action_invalid = True
                reasons.append(f"{key} changed")
        for reference in action.evidence_ids:
            projection = projections.get(reference)
            if projection is None or not projection.eligible_for_claims:
                action_invalid = True
                reasons.append(f"evidence {reference} is no longer current and eligible")
        if _spatial_action_dependencies_invalid(action, state, policy):
            action_invalid = True
            reasons.append("the spatial route, destination, or directive dependency changed or expired")
        if action_invalid:
            invalid.append(action.id)

    if not invalid:
        status = PlanEvaluationStatus.KEEP
        reason = "The current evidence still matches every active plan dependency."
    elif len(invalid) >= len(actions):
        status = PlanEvaluationStatus.INVALIDATED
        reason = "Every plan action lost a dependency or current evidence."
    else:
        status = PlanEvaluationStatus.PARTIAL_INVALIDATION
        reason = "One or more plan actions lost a dependency or current evidence."
    if changed_dependencies:
        reason = f"{reason} Changed dependencies: {', '.join(sorted(changed_dependencies))}."
    elif reasons and status != PlanEvaluationStatus.KEEP:
        reason = f"{reason} {reasons[0]}."
    return PlanEvaluation(
        plan_id=plan.id,
        status=status,
        evaluated_at=current_time,
        reason=reason[:240],
        invalid_action_ids=tuple(sorted(set(invalid))),
    )


def _location_scope_changed(before, after) -> bool:
    return before.area_ids != after.area_ids or before.source != after.source


def _spatial_dependency_changed(
    state: CoreState,
    actions: tuple[PlanAction, ...],
    policy: SafetyPolicy,
) -> bool:
    support = resolve_movement_support(state, state.current_time, policy)
    if support is not None and not any(
        action.category == PlanActionCategory.NOW
        and action.intent_id == SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER
        for action in actions
    ):
        return True
    return any(_spatial_action_dependencies_invalid(action, state, policy) for action in actions)


def _spatial_action_dependencies_invalid(
    action: PlanAction,
    state: CoreState,
    policy: SafetyPolicy,
) -> bool:
    support = resolve_movement_support(state, state.current_time, policy)
    if action.intent_id != SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER:
        return action.category == PlanActionCategory.NOW and support is not None
    if support is None:
        return True
    latest_route = state.routes[-1] if state.routes else None
    if latest_route is None or latest_route.id != support.route.id:
        return True
    if not set(support.evidence_ids).issubset(action.evidence_ids):
        return True
    if not set(support.claim_keys).issubset(action.dependency_keys):
        return True
    return not any(item.id == support.destination_id for item in state.destinations)


def _generate_plan(
    state: CoreState,
    previous_plan: Plan | None,
    invalid_action_ids: set[str],
    projections: dict[str, EvidenceProjection],
    policy: SafetyPolicy,
    event,
) -> CoreState:
    version = len(state.plans) + 1
    plan_id = f"plan_v{version}"
    previous_actions = (
        _actions_for_plan(state, previous_plan.id)
        if previous_plan is not None
        else ()
    )
    previous_by_category = {item.category: item for item in previous_actions}
    evidence_by_id = {item.id: item for item in state.evidence}
    current_claims = {item.key: item for item in state.situation.claim_states}
    movement_support = resolve_movement_support(state, state.current_time, policy)
    distress = resolve_distress(state, state.current_time, policy)

    def authorized_ids(intent_id: SafeIntentId | None) -> tuple[str, ...]:
        if intent_id == SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER and movement_support is not None:
            return movement_support.evidence_ids
        if intent_id == SafeIntentId.TSUNAMI_EVACUATE_NOW and distress.level == DistressLevel.OFFICIAL_TSUNAMI:
            return distress.trigger_evidence_ids
        return ()

    actions: list[PlanAction] = []
    changed_action_ids: list[str] = []
    for category in (
        PlanActionCategory.NOW,
        PlanActionCategory.NEXT,
        PlanActionCategory.AVOID,
    ):
        old = previous_by_category.get(category)
        if old is not None and old.id not in invalid_action_ids:
            preserved = old.model_copy(
                update={
                    "id": f"act_v{version}_{category.value.casefold()}",
                    "plan_id": plan_id,
                }
            )
            assessed = assess_action(
                preserved,
                evidence_by_id,
                projections,
                authorized_movement_evidence_ids=authorized_ids(preserved.intent_id),
            )
            if assessed.status == PlanActionStatus.ACTIVE:
                actions.append(assessed)
                continue
        if category == PlanActionCategory.NOW and movement_support is not None:
            action = _new_movement_action(state, plan_id, current_claims, movement_support)
            assessed = assess_action(
                action,
                evidence_by_id,
                projections,
                authorized_movement_evidence_ids=movement_support.evidence_ids,
            )
        else:
            action = _new_action(
                state,
                plan_id,
                category,
                current_claims,
                projections,
                evidence_by_id,
                distress,
                policy,
            )
            assessed = assess_action(
                action,
                evidence_by_id,
                projections,
                authorized_movement_evidence_ids=authorized_ids(action.intent_id),
            )
        actions.append(assessed)
        changed_action_ids.append(action.id)

    referenced_evidence = tuple(
        sorted(
            {
                reference
                for action in actions
                for reference in action.evidence_ids
            }
        )
    )
    future_expiries = [
        projections[reference].expires_at
        for reference in referenced_evidence
        if reference in projections
        and projections[reference].freshness_status == FreshnessStatus.CURRENT
    ]
    if movement_support is not None:
        future_expiries.append(movement_support.expires_at)
    if future_expiries:
        expires_at = min(
            min(future_expiries),
            state.current_time + timedelta(seconds=policy.official_disaster_ttl_seconds),
        )
    else:
        expires_at = state.current_time + timedelta(seconds=policy.transport_ttl_seconds)
    if expires_at <= state.current_time:
        expires_at = state.current_time + timedelta(seconds=min(policy.transport_ttl_seconds, 60))

    plan = Plan(
        id=plan_id,
        situation_id=state.situation.id,
        version=version,
        status=PlanStatus.ACTIVE,
        created_at=state.current_time,
        expires_at=expires_at,
        invalidate_on_new_relevant_evidence=True,
        based_on_evidence_ids=referenced_evidence,
        previous_plan_id=previous_plan.id if previous_plan else None,
        changed_action_ids=tuple(changed_action_ids),
        language=state.profile.preferred_language,
    )
    state = append_plan(state, plan, tuple(actions))
    if previous_plan is None:
        state = _emit_trace(
            state,
            event,
            "PLAN_GENERATED",
            TraceStatus.SUCCESS,
            (plan.id, *referenced_evidence),
            "A conservative plan was generated from current verified state.",
            agent=AgentName.SAFETY_CORE,
        )
    else:
        state = _emit_trace(
            state,
            event,
            "REPLAN_TRIGGERED",
            TraceStatus.SUCCESS,
            (previous_plan.id, *referenced_evidence),
            "A dependency changed; a new plan version preserves unaffected guidance.",
            agent=AgentName.SAFETY_CORE,
        )
        state = _emit_trace(
            state,
            event,
            "PLAN_GENERATED",
            TraceStatus.SUCCESS,
            (plan.id, *referenced_evidence),
            "A new conservative plan version was appended.",
            agent=AgentName.SAFETY_CORE,
        )
    return state


def _new_movement_action(
    state: CoreState,
    plan_id: str,
    claims: dict[str, SituationClaim],
    support: MovementSupport,
) -> PlanAction:
    language = state.profile.preferred_language.value
    destination = next(item for item in state.destinations if item.id == support.destination_id)
    instruction = {
        "ja": f"確認済みの避難指示に従い、開設と適合性を確認した指定避難先「{destination.name}」へ、確認済みの経路で移動してください。",
        "en": f"Follow the verified evacuation directive to designated shelter “{destination.name}” using the currently verified route.",
        "zh-TW": f"依照已驗證的避難指示，沿目前已驗證的路線前往已確認開放且適合的指定避難處「{destination.name}」。",
    }[language]
    reason = {
        "ja": "現在有來源受控的避難指示、開設中で災害に適合する目的地，以及新鮮で競合のない経路証拠。",
        "en": "A source-controlled evacuation directive, a currently open hazard-suitable destination, and fresh non-conflicting route evidence are all present.",
        "zh-TW": "目前具備來源受控的避難指示、已確認開放且適合此災害的目的地，以及新鮮且無衝突的路線證據。",
    }[language]
    expectations = tuple(
        DependencyExpectation(key=key, expected_value=current_claim_value(claims.get(key)))
        for key in support.claim_keys
    )
    return PlanAction(
        id=f"act_{plan_id}_now",
        plan_id=plan_id,
        category=PlanActionCategory.NOW,
        intent_id=SafeIntentId.EVACUATE_TO_DESIGNATED_SHELTER,
        text=instruction,
        reason=reason,
        risk_level=RiskLevel.HIGH,
        confidence_class="HIGH",
        evidence_ids=support.evidence_ids,
        dependency_keys=support.claim_keys,
        dependency_expectations=expectations,
        status=PlanActionStatus.ACTIVE,
        safety_decision=SafetyDecision.ALLOW,
    )


def _new_action(
    state: CoreState,
    plan_id: str,
    category: PlanActionCategory,
    claims: dict[str, SituationClaim],
    projections: dict[str, EvidenceProjection],
    evidence_by_id: dict[str, Evidence],
    distress: DistressStatus | None = None,
    policy: SafetyPolicy = DEFAULT_POLICY,
) -> PlanAction:
    if category == PlanActionCategory.NOW and distress is not None:
        if distress.level == DistressLevel.OFFICIAL_TSUNAMI:
            return _distress_action(state, plan_id, distress, SafeIntentId.TSUNAMI_EVACUATE_NOW, evidence_by_id, policy)
        if distress.level in {DistressLevel.USER_REPORTED, DistressLevel.OFFICIAL_STALE}:
            return _distress_action(state, plan_id, distress, SafeIntentId.SHELTER_IN_PLACE_VERTICAL, evidence_by_id, policy)
    route_key = route_status_claim_key(state)
    route_state = claims.get(route_key) if route_key else None
    route_value = current_claim_value(route_state)
    disaster_keys = disaster_status_claim_keys(state)
    official_ids = tuple(
        sorted(
            {
                evidence_id
                for key in disaster_keys
                for evidence_id in _eligible_ids_for_claim(claims.get(key), projections)
            }
        )
    )
    route_dependencies = (route_key,) if route_key else ()
    route_ids = _eligible_ids_for_claim(route_state, projections)
    intent_id = _default_intent(category, route_value)
    if category == PlanActionCategory.NOW:
        if intent_id == SafeIntentId.REVIEW_OFFICIAL_GUIDANCE:
            words = {
                "ja": "確認済みの公式情報を確認し、現場の指示に従いながら自身の安全を優先してください。",
                "en": "Review verified official guidance and follow on-site instructions while protecting your personal safety.",
                "zh-TW": "查看已驗證的官方指引，遵循現場指示並優先保護自身安全。",
            }
            text = words[state.profile.preferred_language.value]
            reason = _now_reason(state.profile.preferred_language.value, bool(official_ids))
            risk, dependencies, evidence_ids = RiskLevel.LOW, disaster_keys, official_ids
        else:
            text, reason, risk, dependencies, evidence_ids = _now_content(
                state.profile.preferred_language,
                official_ids,
                disaster_keys,
            )
    elif category == PlanActionCategory.NEXT:
        if intent_id == SafeIntentId.RECHECK_TRANSPORT_STATUS:
            words = {
                "ja": "予定している帰路を再検討する前に、確認済みの交通情報をもう一度確認してください。",
                "en": "Check current verified transport updates again before reconsidering the planned return.",
                "zh-TW": "重新考慮原定返程前，再確認一次已驗證的交通資訊。",
            }
            text = words[state.profile.preferred_language.value]
            _, reason, risk, dependencies, _ = _next_content(
                state.profile.preferred_language, route_value, route_ids, route_dependencies
            )
            evidence_ids = route_ids
        else:
            text, reason, risk, dependencies, evidence_ids = _next_content(
                state.profile.preferred_language,
                route_value,
                route_ids,
                route_dependencies,
            )
    else:
        if intent_id == SafeIntentId.DO_NOT_ASSUME_ROUTE_SAFETY:
            words = {
                "ja": "交通状況だけで、経路や自身の安全を判断しないでください。",
                "en": "Do not treat transport status alone as an assessment of personal or route safety.",
                "zh-TW": "不要只根據交通狀態判斷路線或自身安全。",
            }
            text = words[state.profile.preferred_language.value]
            _, reason, risk, dependencies, _ = _avoid_content(
                state.profile.preferred_language, route_value, route_ids, route_dependencies
            )
            evidence_ids = route_ids
        else:
            text, reason, risk, dependencies, evidence_ids = _avoid_content(
                state.profile.preferred_language,
                route_value,
                route_ids,
                route_dependencies,
            )
    dependency_expectations = tuple(
        DependencyExpectation(
            key=key,
            expected_value=current_claim_value(claims.get(key)),
        )
        for key in dependencies
    )
    action_id = f"act_{plan_id}_{category.value.casefold()}"
    return PlanAction(
        id=action_id,
        plan_id=plan_id,
        category=category,
        intent_id=intent_id,
        text=text,
        reason=reason,
        risk_level=risk,
        confidence_class="LOW" if evidence_ids else "UNKNOWN",
        evidence_ids=tuple(reference for reference in evidence_ids if reference in evidence_by_id),
        dependency_keys=dependencies,
        dependency_expectations=dependency_expectations,
        status=PlanActionStatus.ACTIVE,
        safety_decision=SafetyDecision.ALLOW,
    )


_DISTRESS_WORDS = {
    SafeIntentId.SHELTER_IN_PLACE_VERTICAL: {
        "ja": (
            "今すぐ建物の上の階か高い場所へ移動し、水辺から離れてください。",
            "危険が報告されました。今すぐ建物の上の階か高い場所へ移動し、水辺から離れてください。",
        ),
        "en": (
            "Move to an upper floor or higher ground now and keep away from water.",
            "You reported danger. Move to an upper floor or higher ground now and keep away from water.",
        ),
        "zh-TW": (
            "立刻往建築物上層或高處移動，遠離水邊。",
            "你回報了危險。立刻往建築物上層或高處移動，遠離水邊。",
        ),
    },
    SafeIntentId.TSUNAMI_EVACUATE_NOW: {
        "ja": (
            "今すぐ公式に指定された津波避難場所へ向かってください。間に合わない場合は、頑丈な建物の3階以上か高い場所へ今すぐ移動してください。",
            "公式の津波警報があなたの地域に出ています。今すぐ公式に指定された津波避難場所へ向かってください。間に合わない場合は、頑丈な建物の3階以上か高い場所へ今すぐ移動してください。",
        ),
        "en": (
            "Go now to an officially designated tsunami site, or if you cannot reach one in time, move to the 3rd floor or higher of a solid building or to high ground.",
            "An official tsunami warning covers your area. Go now to an officially designated tsunami site, or if you cannot reach one in time, move to the 3rd floor or higher of a solid building or to high ground.",
        ),
        "zh-TW": (
            "立刻前往官方指定的海嘯避難場所；如果來不及，立刻往堅固建築物的 3 樓以上或高處移動。",
            "官方海嘯警報涵蓋你所在的地區。立刻前往官方指定的海嘯避難場所；如果來不及，立刻往堅固建築物的 3 樓以上或高處移動。",
        ),
    },
}


# OFFICIAL_STALE: the official warning expired without a cancellation. Same protective
# vertical-shelter intent, never "go to a place"; the reason states the data age.
_STALE_WORDS = {
    "ja": (
        "今すぐ建物の上の階か高い場所へ移動し、水辺から離れてください。",
        "公式の津波警報の情報が有効時間を過ぎました（取り消しは確認されていません）。今すぐ建物の上の階か高い場所へ移動し、水辺から離れてください。",
    ),
    "en": (
        "Move to an upper floor or higher ground now and keep away from water.",
        "The official tsunami warning data has expired (no cancellation was received). Move to an upper floor or higher ground now and keep away from water.",
    ),
    "zh-TW": (
        "立刻往建築物上層或高處移動，遠離水邊。",
        "官方海嘯警報資料已超過有效時間（未收到解除）。立刻往建築物上層或高處移動，遠離水邊。",
    ),
}


# OFFICIAL_STALE / LOCATION_STALE: the warning is current but the location fix is too old.
_LOCATION_STALE_WORDS = {
    "ja": (
        "今すぐ建物の上の階か高い場所へ移動し、水辺から離れてください。",
        "位置情報が古く、公式の津波警報の地域内にいるか確認できません。今すぐ建物の上の階か高い場所へ移動し、水辺から離れてください。",
    ),
    "en": (
        "Move to an upper floor or higher ground now and keep away from water.",
        "Your location fix is too old to confirm you are inside the official tsunami warning area. Move to an upper floor or higher ground now and keep away from water.",
    ),
    "zh-TW": (
        "立刻往建築物上層或高處移動，遠離水邊。",
        "位置資料過舊，無法確認你仍在官方海嘯警報地區內。立刻往建築物上層或高處移動，遠離水邊。",
    ),
}
_LOCATION_STALE_PREFIX = {
    "ja": "位置情報が古く、公式の津波警報の地域内にいるか確認できません。",
    "en": "Your location fix is too old to confirm you are inside the official tsunami warning area.",
    "zh-TW": "位置資料過舊，無法確認你仍在官方海嘯警報地區內。",
}


_STALE_PREFIX = {
    "ja": "公式の津波警報の情報が有効時間を過ぎました（取り消しは確認されていません）。",
    "en": "The official tsunami warning data has expired (no cancellation was received).",
    "zh-TW": "官方海嘯警報資料已超過有效時間（未收到解除）。",
}
# Level-1 vertical guidance for a person who reported TRAPPED: they may not be able to move.
_TRAPPED_WORDS = {
    "ja": (
        "助けを求め、身を守れる場所にとどまってください。水が上がってきたら高い所へ移動してください。",
        "閉じ込められていると報告されました。助けを求め、身を守れる場所にとどまってください。水が上がってきたら高い所へ移動してください。",
    ),
    "en": (
        "Call for help and stay where you can protect yourself. If water is rising, move higher.",
        "You reported being trapped. Call for help and stay where you can protect yourself. If water is rising, move higher.",
    ),
    "zh-TW": (
        "請求救，留在可以保護自己的地方；如果水在上升，就往高處移動。",
        "你回報受困。請求救，留在可以保護自己的地方；如果水在上升，就往高處移動。",
    ),
}


def _distress_action(
    state: CoreState,
    plan_id: str,
    distress: DistressStatus,
    intent: SafeIntentId,
    evidence_by_id: dict[str, Evidence],
    policy: SafetyPolicy,
) -> PlanAction:
    """Deterministic NOW action for a resolved distress level; it still passes assess_action."""
    official = intent == SafeIntentId.TSUNAMI_EVACUATE_NOW
    key = None
    if official:
        trigger = official_tsunami_trigger(state, state.current_time, policy)
        if trigger is None:  # pragma: no cover - resolve_distress already found one
            raise ValueError("OFFICIAL_TSUNAMI distress requires a current official trigger")
        key = disaster_claim_key(trigger.area_id, "TSUNAMI", "status")
    language = state.profile.preferred_language.value
    trapped = any(DistressTag.TRAPPED in report.tags for report in distress.reports)
    if not official and trapped:
        text, reason = _TRAPPED_WORDS[language]
        if distress.level == DistressLevel.OFFICIAL_STALE:
            prefix = _LOCATION_STALE_PREFIX if distress.stale_reason == "LOCATION_STALE" else _STALE_PREFIX
            reason = prefix[language] + (" " if language == "en" else "") + reason
    elif distress.level == DistressLevel.OFFICIAL_STALE and not official:
        words = _LOCATION_STALE_WORDS if distress.stale_reason == "LOCATION_STALE" else _STALE_WORDS
        text, reason = words[language]
    else:
        text, reason = _DISTRESS_WORDS[intent][language]
    evidence_ids = (
        tuple(reference for reference in distress.trigger_evidence_ids if reference in evidence_by_id)
        if official
        else ()
    )
    return PlanAction(
        id=f"act_{plan_id}_{PlanActionCategory.NOW.value.casefold()}",
        plan_id=plan_id,
        category=PlanActionCategory.NOW,
        intent_id=intent,
        text=text,
        reason=reason,
        risk_level=RiskLevel.HIGH if official else RiskLevel.LOW,
        confidence_class="HIGH" if official else "UNKNOWN",
        evidence_ids=evidence_ids,
        dependency_keys=(key,) if key else (),
        dependency_expectations=(DependencyExpectation(key=key, expected_value="ACTIVE"),) if key else (),
        status=PlanActionStatus.ACTIVE,
        safety_decision=SafetyDecision.ALLOW,
    )


def _now_content(language, evidence_ids, dependencies):
    words = {
        "ja": (
            "自身の安全に注意し、現場や公式の指示に従いながら、確認済みの更新を確認してください。",
            "確認済みの公式情報があります。示されている災害状況を確認してください。",
        ),
        "en": (
            "Protect your personal safety, follow on-site and official instructions, and monitor verified updates.",
            "An eligible verified official update is available; review its stated disaster status.",
        ),
        "zh-TW": (
            "先注意自身安全，遵循現場人員與官方指示，並留意已驗證的最新資訊。",
            "目前有符合資格的已驗證官方資訊，請查看其中所載的災害狀態。",
        ),
    }
    text, reason = words[language.value]
    return (
        text,
        reason if evidence_ids else _now_reason(language.value, False),
        RiskLevel.LOW,
        dependencies,
        evidence_ids,
    )


def _now_reason(language: str, evidence_available: bool) -> str:
    if evidence_available:
        return {
            "ja": "確認済みの公式情報があります。示されている災害状況を確認してください。",
            "en": "An eligible verified official update is available; review its stated disaster status.",
            "zh-TW": "目前有符合資格的已驗證官方資訊，請查看其中所載的災害狀態。",
        }[language]
    return {
        "ja": "現在有効な確認済み公式情報はありません。",
        "en": "No current verified official update is available.",
        "zh-TW": "目前沒有有效的已驗證官方資訊。",
    }[language]


def _next_content(language, route_value, evidence_ids, dependencies):
    if route_value == "DISRUPTED":
        words = {
            "ja": (
                "帰路を決める前に、新しい交通情報を待ってください。",
                "確認済みの交通情報で、予定している経路の運行乱れが示されています。",
            ),
            "en": (
                "Wait for updated transport information before revisiting the return trip.",
                "Verified transport information reports disruption on the planned route.",
            ),
            "zh-TW": (
                "重新考慮返程前，先等候更新的交通資訊。",
                "已驗證的交通資訊顯示原定路線受到影響。",
            ),
        }
    elif route_value == "CONFLICT":
        words = {
            "ja": (
                "交通情報の食い違いが解消するまで、新しい確認済み情報を待ってください。",
                "確認済み情報の間で交通状況に食い違いがあります。",
            ),
            "en": (
                "Wait for verified transport information to resolve the conflicting reports.",
                "Current verified sources disagree about the transport status.",
            ),
            "zh-TW": (
                "先等候新的已驗證交通資訊，以釐清來源間的差異。",
                "目前已驗證來源對交通狀況的說法不一致。",
            ),
        }
    elif route_value == "AVAILABLE":
        words = {
            "ja": (
                "移動を始める前に、交通状況をもう一度確認してください。",
                "運行状況が利用可能でも、災害時の安全性を示すものではありません。",
            ),
            "en": (
                "Re-check transport before beginning the planned return.",
                "Availability information does not establish that a route is safe.",
            ),
            "zh-TW": (
                "開始原定返程前，再確認一次交通狀況。",
                "路線可用資訊不代表災害期間的路線安全。",
            ),
        }
    else:
        words = {
            "ja": (
                "帰路を始める前に、確認済みの交通情報を待ってください。",
                "現在の交通状況は確認できていません。",
            ),
            "en": (
                "Wait for verified transport information before starting the planned return.",
                "Current transport status is unknown.",
            ),
            "zh-TW": (
                "開始原定返程前，先等候已驗證的交通資訊。",
                "目前沒有已驗證的交通狀況。",
            ),
        }
    text, reason = words[language.value]
    return (
        text,
        reason,
        RiskLevel.MEDIUM,
        dependencies,
        evidence_ids,
    )


def _avoid_content(language, route_value, evidence_ids, dependencies):
    if route_value == "DISRUPTED":
        words = {
            "ja": (
                "運行乱れが確認された経路を使って帰らないでください。",
                "確認済みの交通情報が予定経路の乱れを示しています。",
            ),
            "en": (
                "Do not rely on the disrupted route for the planned return.",
                "Verified transport information reports a disruption on that route.",
            ),
            "zh-TW": (
                "不要依賴已確認受影響的路線返程。",
                "已驗證的交通資訊顯示該路線受到影響。",
            ),
        }
    elif route_value == "AVAILABLE":
        words = {
            "ja": (
                "運行可能の表示を災害時の安全確認と混同しないでください。",
                "交通の運行可能性は災害時の安全判断ではありません。",
            ),
            "en": (
                "Do not treat route availability as a disaster safety assessment.",
                "Transport availability does not establish route safety.",
            ),
            "zh-TW": (
                "不要把路線可用狀態當成災害安全評估。",
                "交通可用資訊不等於路線安全判斷。",
            ),
        }
    elif route_value == "CONFLICT":
        words = {
            "ja": (
                "食い違う交通情報に基づいて移動を決めないでください。",
                "確認済み情報の間に未解決の食い違いがあります。",
            ),
            "en": (
                "Do not make a movement decision from conflicting transport reports.",
                "The current verified sources contain an unresolved conflict.",
            ),
            "zh-TW": (
                "不要根據互相矛盾的交通資訊決定移動。",
                "已驗證來源之間仍有未解決的差異。",
            ),
        }
    else:
        words = {
            "ja": (
                "確認済みの状況が分かるまで、経路が利用可能だと決めつけないでください。",
                "現在の交通状況を示す確認済み情報はありません。",
            ),
            "en": (
                "Do not assume the planned route is available.",
                "No current verified transport status supports route availability.",
            ),
            "zh-TW": (
                "不要假設原定路線仍可使用。",
                "目前沒有已驗證的交通資訊可確認路線狀況。",
            ),
        }
    text, reason = words[language.value]
    return (
        text,
        reason,
        RiskLevel.MEDIUM,
        dependencies,
        evidence_ids,
    )


def _eligible_ids_for_claim(
    claim: SituationClaim | None,
    projections: dict[str, EvidenceProjection],
) -> tuple[str, ...]:
    if claim is None:
        return ()
    return tuple(
        reference
        for reference in claim.evidence_ids
        if projections.get(reference) is not None
        and projections[reference].eligible_for_claims
    )


def _actions_for_plan(state: CoreState, plan_id: str) -> tuple[PlanAction, ...]:
    return tuple(action for action in state.plan_actions if action.plan_id == plan_id)


def _append_evaluation(
    state: CoreState,
    evaluation: PlanEvaluation,
    event,
) -> CoreState:
    state = replace(state, plan_evaluations=(*state.plan_evaluations, evaluation))
    return _emit_trace(
        state,
        event,
        "PLAN_EVALUATED",
        TraceStatus.SUCCESS,
        (evaluation.plan_id, *evaluation.invalid_action_ids),
        evaluation.reason,
        agent=AgentName.SAFETY_CORE,
    )


def _expire_historical_plans(state: CoreState, event) -> CoreState:
    evaluated_expired = {
        item.plan_id
        for item in state.plan_evaluations
        if item.status == PlanEvaluationStatus.EXPIRED
    }
    expired = [
        plan
        for plan in state.plans
        if state.current_time >= plan.expires_at
        and plan.id not in evaluated_expired
    ]
    for plan in expired:
        actions = _actions_for_plan(state, plan.id)
        evaluation = PlanEvaluation(
            plan_id=plan.id,
            status=PlanEvaluationStatus.EXPIRED,
            evaluated_at=state.current_time,
            reason="The plan reached its deterministic expiration time.",
            invalid_action_ids=tuple(action.id for action in actions),
        )
        state = _append_evaluation(state, evaluation, event)
    return state


def _emit_trace(
    state: CoreState,
    event,
    event_type: str,
    status: TraceStatus,
    refs: tuple[str, ...],
    summary: str,
    *,
    agent: AgentName,
) -> CoreState:
    trace = TraceEvent(
        id=f"trace_{len(state.trace) + 1:03d}",
        situation_id=state.situation.id,
        timestamp=state.current_time,
        agent=agent,
        event_type=event_type,
        input_refs=(event.id,),
        output_refs=refs,
        status=status,
        public_summary=summary[:240],
    )
    return replace(state, trace=(*state.trace, trace))


def _claim_status(claim: SituationClaim | None):
    return claim.status if claim is not None else ClaimStateStatus.UNKNOWN
