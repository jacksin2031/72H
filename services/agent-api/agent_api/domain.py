"""Pure deterministic state reducer for replay input."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from typing import Any

from pydantic import TypeAdapter
from seventytwoh_contracts.models import (
    AgentName,
    Claim,
    ClaimType,
    DisasterAssessment,
    DisasterAlertReplayEvent,
    DisasterEvent,
    DisasterEventStatus,
    DisasterEventType,
    Evidence,
    FreshnessStatus,
    IncidentStatus,
    MobilitySnapshot,
    MobilityStatus,
    NetworkDegradedReplayEvent,
    NetworkLostReplayEvent,
    NetworkRestoredReplayEvent,
    NetworkState,
    OfficialUpdateReplayEvent,
    Plan,
    PlanAction,
    PlanExpirationReplayEvent,
    ReplayEvent,
    Situation,
    SourceClass,
    TraceEvent,
    TraceStatus,
    TransportUpdateReplayEvent,
    TrustStatus,
    UnverifiedReportReplayEvent,
    UserProfile,
    VerifiedUpdateReplayEvent,
)

from .scenario import (
    ReplayEventAdapter,
    SIMULATION_SOURCE_REGISTRY,
    source_authorizes_area,
    source_authorizes_disaster_assessments,
    source_authorizes_transport,
)
from .live_sources import JMA_TSUNAMI_SOURCE_KEY
from .safety import (
    DEFAULT_POLICY,
    SafetyPolicy,
    claims_from_disaster_assessments,
    expires_at_for,
    route_claim_key,
)
from .state import CoreState

MAX_EVENTS = 64
MAX_EVIDENCE = 128
MAX_TRACE = 512
MAX_MOBILITY = 128
MAX_PLANS = 128
MAX_ACTIONS = 512


def _supersede_tsunami_revision(state: CoreState, event: DisasterEvent, evidence: Evidence) -> CoreState:
    """Retire older serials for one JMA tsunami event before evaluating the new revision."""
    if evidence.source_key != JMA_TSUNAMI_SOURCE_KEY or event.event_type != DisasterEventType.TSUNAMI:
        return state
    group, separator, _revision = event.id.partition("--")
    if not separator or not group.startswith("jma-tsunami-"):
        return state
    retired_ids = {
        item.id
        for item in state.events
        if item.event_type == DisasterEventType.TSUNAMI
        and item.id.startswith(f"{group}--")
        and item.id != event.id
    }
    if not retired_ids:
        return state
    events = tuple(
        item.model_copy(update={"status": DisasterEventStatus.RESOLVED})
        if item.id in retired_ids
        else item
        for item in state.events
    )
    evidence_items = tuple(
        item.model_copy(update={
            "trust_status": TrustStatus.STALE,
            "freshness_status": FreshnessStatus.STALE,
        })
        if item.source_key == JMA_TSUNAMI_SOURCE_KEY and item.id.removeprefix("ev_") in retired_ids
        else item
        for item in state.evidence
    )
    active_ids = tuple(item for item in state.situation.active_event_ids if item not in retired_ids)
    return replace(
        state,
        events=events,
        evidence=evidence_items,
        situation=state.situation.model_copy(update={"active_event_ids": active_ids}),
    )


def parse_replay_event(raw: Any) -> ReplayEvent:
    """Validate untrusted event data before it enters the reducer."""
    return ReplayEventAdapter.validate_python(raw)


def reduce_raw_event(state: CoreState, raw: Any) -> CoreState:
    """Validate then reduce atomically; a rejected payload leaves state untouched."""
    return reduce_event(state, parse_replay_event(raw))


def reduce_event(
    state: CoreState,
    event: ReplayEvent,
    policy: SafetyPolicy = DEFAULT_POLICY,
) -> CoreState:
    if event.occurred_at < state.current_time:
        raise ValueError("replay event occurred_at cannot move virtual time backwards")
    state_at_event = replace(state, current_time=event.occurred_at)
    reduced = _reduce_event_input(state_at_event, event, policy)
    from .planning import evaluate_and_replan

    return evaluate_and_replan(state, reduced, event, policy)


def apply_live_evidence_batch(
    state: CoreState,
    records: tuple[tuple[DisasterEvent, Evidence], ...],
    current_time,
    policy: SafetyPolicy = DEFAULT_POLICY,
    *,
    synthetic_mode: bool = False,
) -> CoreState:
    """Append server-normalized evidence; only an internal mock adapter may enable synthetic mode."""
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("live current_time must be timezone aware")
    if current_time < state.current_time:
        raise ValueError("live state time cannot move backwards")
    before = state
    reduced = replace(state, current_time=current_time)
    for event, evidence in records:
        if synthetic_mode:
            if not event.is_synthetic or not evidence.is_synthetic or evidence.eligible_for_high_risk:
                raise ValueError("mock-live requires synthetic, high-risk-ineligible evidence")
        elif event.is_synthetic or evidence.is_synthetic:
            raise ValueError("synthetic replay records cannot enter a live session")
        if event.source_class != SourceClass.OFFICIAL or evidence.trust_status != TrustStatus.VERIFIED_OFFICIAL:
            raise ValueError("live JMA records must use server-assigned official trust")
        if event.situation_id != reduced.situation.id or evidence.situation_id != reduced.situation.id:
            raise ValueError("live records must belong to the current situation")
        if any(item.id == event.id for item in reduced.events):
            continue
        reduced = _supersede_tsunami_revision(reduced, event, evidence)
        active_event_ids = reduced.situation.active_event_ids
        if event.event_type == DisasterEventType.TSUNAMI:
            active_event_ids = tuple(item for item in active_event_ids if item != event.id)
            if event.status in {DisasterEventStatus.ACTIVE, DisasterEventStatus.UNKNOWN}:
                active_event_ids = (*active_event_ids, event.id)
        else:
            active_event_ids = (*active_event_ids, event.id)
        situation = reduced.situation.model_copy(
            update={
                "incident_status": (
                    IncidentStatus.EVENT_DETECTED
                    if event.status in {DisasterEventStatus.ACTIVE, DisasterEventStatus.UNKNOWN}
                    else reduced.situation.incident_status
                ),
                "active_event_ids": tuple(dict.fromkeys(active_event_ids)),
                "updated_at": current_time,
            }
        )
        event_trace = TraceEvent(
            id=f"trace_live_event_{len(reduced.trace) + 1:03d}",
            situation_id=situation.id,
            timestamp=current_time,
            agent=AgentName.SOURCE_AGENT,
            event_type="MOCK_LIVE_EVENT_RECEIVED" if synthetic_mode else "LIVE_OFFICIAL_EVENT_RECEIVED",
            input_refs=(event.id,),
            output_refs=(event.id,),
            status=TraceStatus.SUCCESS,
            public_summary=(
                "MOCK LIVE: synthetic earthquake input exercised the Live reducer; not a JMA bulletin."
                if synthetic_mode else f"An official JMA {event.event_type.value.lower()} report entered the live evidence pipeline."
            ),
        )
        reduced = replace(
            reduced,
            situation=situation,
            events=(*reduced.events, event),
            trace=(*reduced.trace, event_trace),
        )
        reduced = _append_evidence(
            reduced,
            event.id,
            evidence,
            "MOCK_LIVE_EVIDENCE_ADDED" if synthetic_mode else "OFFICIAL_LIVE_EVIDENCE_ADDED",
            (event.id,),
        )
    from .planning import evaluate_and_replan

    clock_event = type("LiveRefreshEvent", (), {"id": f"live-refresh-{int(reduced.current_time.timestamp())}"})()
    return evaluate_and_replan(before, reduced, clock_event, policy)


async def reduce_event_with_planner(
    state: CoreState,
    event: ReplayEvent,
    planner,
    replay_id: str,
    policy: SafetyPolicy = DEFAULT_POLICY,
):
    """Run a deterministic preview, validate one optional candidate, then publish once."""
    if event.occurred_at < state.current_time:
        raise ValueError("replay event occurred_at cannot move virtual time backwards")
    state_at_event = replace(state, current_time=event.occurred_at)
    reduced = _reduce_event_input(state_at_event, event, policy)
    from .planning import (
        PlannerTrace,
        candidate_context_for_preview,
        evaluate_and_replan,
    )

    preview = evaluate_and_replan(state, reduced, event, policy)
    context = candidate_context_for_preview(state, preview, policy)
    if context is None:
        return preview, None

    outcome = await planner.select(replay_id, context)
    if outcome.mode == "DETERMINISTIC_REPLAY_ONLY":
        return preview, outcome.mode
    if outcome.mode == "GEMINI_ADK" and outcome.selection is None:
        outcome = type(outcome)(mode="GEMINI_ADK_FALLBACK", reason_code="INVALID_OUTPUT")
    if outcome.mode != "GEMINI_ADK" and outcome.selection is not None:
        outcome = type(outcome)(mode="GEMINI_ADK_FALLBACK", reason_code="INVALID_OUTPUT")

    published = evaluate_and_replan(
        state,
        reduced,
        event,
        policy,
        candidate_selection=outcome.selection,
        candidate_context=context,
        planner_trace=PlannerTrace(mode=outcome.mode, reason_code=outcome.reason_code),
    )
    return published, outcome.mode


async def apply_live_evidence_batch_with_planner(
    state: CoreState,
    records: tuple[tuple[DisasterEvent, Evidence], ...],
    current_time,
    planner,
    live_session_id: str,
    policy: SafetyPolicy = DEFAULT_POLICY,
    *,
    synthetic_mode: bool = False,
):
    """Publish official Live or isolated synthetic Mock Live evidence through identical planning."""
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("live current_time must be timezone aware")
    if current_time < state.current_time:
        raise ValueError("live state time cannot move backwards")
    before = state
    reduced = replace(state, current_time=current_time)
    for event, evidence in records:
        if synthetic_mode:
            if not event.is_synthetic or not evidence.is_synthetic or evidence.eligible_for_high_risk:
                raise ValueError("mock-live requires synthetic, high-risk-ineligible evidence")
        elif event.is_synthetic or evidence.is_synthetic:
            raise ValueError("synthetic replay records cannot enter a live session")
        if event.source_class != SourceClass.OFFICIAL or evidence.trust_status != TrustStatus.VERIFIED_OFFICIAL:
            raise ValueError("live JMA records must use server-assigned official trust")
        if event.situation_id != reduced.situation.id or evidence.situation_id != reduced.situation.id:
            raise ValueError("live records must belong to the current situation")
        if any(item.id == event.id for item in reduced.events):
            continue
        reduced = _supersede_tsunami_revision(reduced, event, evidence)
        active_event_ids = reduced.situation.active_event_ids
        if event.event_type == DisasterEventType.TSUNAMI:
            active_event_ids = tuple(item for item in active_event_ids if item != event.id)
            if event.status in {DisasterEventStatus.ACTIVE, DisasterEventStatus.UNKNOWN}:
                active_event_ids = (*active_event_ids, event.id)
        else:
            active_event_ids = (*active_event_ids, event.id)
        situation = reduced.situation.model_copy(
            update={
                "incident_status": (
                    IncidentStatus.EVENT_DETECTED
                    if event.status in {DisasterEventStatus.ACTIVE, DisasterEventStatus.UNKNOWN}
                    else reduced.situation.incident_status
                ),
                "active_event_ids": tuple(dict.fromkeys(active_event_ids)),
                "updated_at": current_time,
            }
        )
        event_trace = TraceEvent(
            id=f"trace_live_event_{len(reduced.trace) + 1:03d}",
            situation_id=situation.id,
            timestamp=current_time,
            agent=AgentName.SOURCE_AGENT,
            event_type="MOCK_LIVE_EVENT_RECEIVED" if synthetic_mode else "LIVE_OFFICIAL_EVENT_RECEIVED",
            input_refs=(event.id,),
            output_refs=(event.id,),
            status=TraceStatus.SUCCESS,
            public_summary=(
                "MOCK LIVE: synthetic earthquake input exercised the Live reducer; not a JMA bulletin."
                if synthetic_mode else f"An official JMA {event.event_type.value.lower()} report entered the live evidence pipeline."
            ),
        )
        reduced = replace(
            reduced,
            situation=situation,
            events=(*reduced.events, event),
            trace=(*reduced.trace, event_trace),
        )
        reduced = _append_evidence(
            reduced,
            event.id,
            evidence,
            "MOCK_LIVE_EVIDENCE_ADDED" if synthetic_mode else "OFFICIAL_LIVE_EVIDENCE_ADDED",
            (event.id,),
        )
    return await replan_live_transition_with_planner(
        before, reduced, planner, live_session_id, policy,
    )


async def replan_live_transition_with_planner(
    before: CoreState,
    reduced: CoreState,
    planner,
    live_session_id: str,
    policy: SafetyPolicy = DEFAULT_POLICY,
    *,
    event_id: str | None = None,
    allow_network_reconciliation: bool = True,
):
    """Evaluate a prepared live transition and optionally apply one bounded candidate."""
    from .planning import (
        PlannerTrace,
        candidate_context_for_preview,
        evaluate_and_replan,
    )

    if reduced.current_time < before.current_time:
        raise ValueError("live state time cannot move backwards")
    clock_event = type("LiveRefreshEvent", (), {
        "id": event_id or f"live-refresh-{int(reduced.current_time.timestamp())}"
    })()
    preview = evaluate_and_replan(
        before,
        reduced,
        clock_event,
        policy,
        allow_network_reconciliation=allow_network_reconciliation,
    )
    context = candidate_context_for_preview(before, preview, policy)
    if context is None:
        return preview, None
    outcome = await planner.select(live_session_id, context)
    if outcome.mode == "DETERMINISTIC_REPLAY_ONLY":
        return preview, outcome.mode
    if outcome.mode == "GEMINI_ADK" and outcome.selection is None:
        outcome = type(outcome)(mode="GEMINI_ADK_FALLBACK", reason_code="INVALID_OUTPUT")
    if outcome.mode != "GEMINI_ADK" and outcome.selection is not None:
        outcome = type(outcome)(mode="GEMINI_ADK_FALLBACK", reason_code="INVALID_OUTPUT")
    published = evaluate_and_replan(
        before,
        reduced,
        clock_event,
        policy,
        candidate_selection=outcome.selection,
        candidate_context=context,
        planner_trace=PlannerTrace(mode=outcome.mode, reason_code=outcome.reason_code),
        allow_network_reconciliation=allow_network_reconciliation,
    )
    return published, outcome.mode


def _reduce_event_input(state: CoreState, event: ReplayEvent, policy: SafetyPolicy) -> CoreState:
    if event.event_type == "disaster_alert" and isinstance(event, DisasterAlertReplayEvent):
        source = SIMULATION_SOURCE_REGISTRY[event.source_key]
        _validate_area_authority(state, event.source_key, event.affected_area_ids)
        disaster = DisasterEvent(
            id=f"evt_{event.id}",
            situation_id=state.situation.id,
            event_type=event.disaster_type,
            occurred_at=event.occurred_at,
            received_at=event.occurred_at,
            affected_areas=event.affected_areas,
            affected_area_ids=event.affected_area_ids,
            source_name=source.source_name,
            source_class=source.source_class,
            severity_raw=event.severity_raw,
            status=DisasterEventStatus.ACTIVE,
            raw_reference=f"replay://{state.scenario_key}/{event.id}",
            is_synthetic=True,
        )
        situation = state.situation.model_copy(
            update={
                "incident_status": IncidentStatus.EVENT_DETECTED,
                "active_event_ids": (*state.situation.active_event_ids, disaster.id),
                "updated_at": event.occurred_at,
            }
        )
        trace = _trace(
            state,
            event.id,
            "DISASTER_EVENT_RECEIVED",
            event.occurred_at,
            (disaster.id,),
            "A synthetic replay earthquake event was received.",
            TraceStatus.SUCCESS,
        )
        return _bounded(replace(state, situation=situation, events=(*state.events, disaster), trace=(*state.trace, trace)))

    if event.event_type == "official_update" and isinstance(event, OfficialUpdateReplayEvent):
        evidence = _evidence(
            state,
            event.id,
            event.source_key,
            TrustStatus.VERIFIED_OFFICIAL,
            event.published_at,
            event.occurred_at,
            event.affected_areas,
            ClaimType.DISASTER_STATUS,
            event.claims,
            event.summary,
            policy,
            affected_area_ids=event.affected_area_ids,
            disaster_assessments=event.disaster_assessments,
        )
        return _append_evidence(state, event.id, evidence, "OFFICIAL_REPLAY_EVIDENCE_ADDED")

    if event.event_type == "transport_update" and isinstance(event, TransportUpdateReplayEvent):
        evidence = _evidence(
            state,
            event.id,
            event.source_key,
            TrustStatus.VERIFIED_PARTNER,
            event.published_at,
            event.occurred_at,
            (event.origin, event.destination),
            ClaimType.TRANSPORT_STATUS,
            event.claims,
            event.summary,
            policy,
            affected_area_ids=tuple(
                value for value in (event.origin_area_id, event.destination_area_id) if value
            ),
            route_area_ids=(event.origin_area_id, event.destination_area_id)
            if event.origin_area_id and event.destination_area_id
            else None,
            mobility_status=event.mobility_status,
        )
        mobility = MobilitySnapshot(
            id=f"mob_{event.id}",
            situation_id=state.situation.id,
            origin=event.origin,
            destination=event.destination,
            origin_area_id=event.origin_area_id,
            destination_area_id=event.destination_area_id,
            status=event.mobility_status,
            evidence_ids=(evidence.id,),
            checked_at=event.occurred_at,
        )
        state = replace(state, mobility=(*state.mobility, mobility))
        return _append_evidence(state, event.id, evidence, "TRANSPORT_REPLAY_EVIDENCE_ADDED", (mobility.id,))

    if event.event_type == "unverified_report" and isinstance(event, UnverifiedReportReplayEvent):
        evidence = _evidence(
            state,
            event.id,
            event.source_key,
            TrustStatus.UNVERIFIED,
            event.published_at,
            event.occurred_at,
            event.affected_areas,
            ClaimType.USER_REPORT,
            (Claim(key="unverified.content", value=event.content),),
            event.summary,
            policy,
            affected_area_ids=event.affected_area_ids,
        )
        state = _append_evidence(state, event.id, evidence, "UNVERIFIED_SOURCE_REJECTED")
        return state

    if event.event_type == "network_degraded" and isinstance(event, NetworkDegradedReplayEvent):
        return _network_transition(
            state,
            event.id,
            event.occurred_at,
            NetworkState.ONLINE_DEGRADED,
            "NETWORK_DEGRADED",
            "The synthetic replay network entered degraded mode.",
        )

    if event.event_type == "network_lost" and isinstance(event, NetworkLostReplayEvent):
        situation = state.situation.model_copy(
            update={
                "network_state": NetworkState.OFFLINE_RECENT,
                "incident_status": IncidentStatus.OFFLINE_CONTINUITY,
                "updated_at": event.occurred_at,
            }
        )
        trace = _trace(
            state,
            event.id,
            "OFFLINE_MODE_ENTERED",
            event.occurred_at,
            (),
            "The synthetic replay entered offline continuity mode.",
            TraceStatus.SUCCESS,
        )
        return _bounded(replace(state, situation=situation, trace=(*state.trace, trace)))

    if event.event_type == "network_restored" and isinstance(event, NetworkRestoredReplayEvent):
        return _network_transition(
            state,
            event.id,
            event.occurred_at,
            NetworkState.RECONNECTING,
            "NETWORK_RESTORED",
            "Connectivity returned in replay; fresh evidence is required before reconciliation completes.",
        )

    if event.event_type == "verified_update" and isinstance(event, VerifiedUpdateReplayEvent):
        source = SIMULATION_SOURCE_REGISTRY[event.source_key]
        has_route_context = any(
            value is not None
            for value in (
                event.origin,
                event.destination,
                event.origin_area_id,
                event.destination_area_id,
                event.mobility_status,
            )
        )
        if has_route_context and not source_authorizes_transport(source):
            raise ValueError(
                "source registry does not authorize verified route context or generated route claims"
            )
        if event.disaster_assessments and not source_authorizes_disaster_assessments(source):
            raise ValueError(
                "source registry does not authorize verified disaster assessments or generated disaster claims"
            )
        expected_trust = source.trust_status
        claim_type = (
            ClaimType.DISASTER_STATUS
            if source.source_class == SourceClass.OFFICIAL
            else ClaimType.TRANSPORT_STATUS
        )
        areas = event.affected_areas or tuple(
            value for value in (event.origin, event.destination) if value is not None
        )
        route_area_ids = (
            (event.origin_area_id, event.destination_area_id)
            if event.origin_area_id and event.destination_area_id
            else None
        )
        evidence = _evidence(
            state,
            event.id,
            event.source_key,
            expected_trust,
            event.published_at,
            event.occurred_at,
            areas,
            claim_type,
            event.claims,
            event.summary,
            policy,
            affected_area_ids=tuple(
                dict.fromkeys(
                    (*event.affected_area_ids, *(item for item in route_area_ids or () if item))
                )
            ),
            disaster_assessments=event.disaster_assessments,
            route_area_ids=route_area_ids,
            mobility_status=event.mobility_status,
        )
        state = _append_evidence(state, event.id, evidence, "VERIFIED_REPLAY_EVIDENCE_ADDED")
        return _bounded(state)

    if event.event_type == "plan_expiration" and isinstance(event, PlanExpirationReplayEvent):
        trace = _trace(
            state,
            event.id,
            "PLAN_EXPIRATION_TRIGGERED",
            event.occurred_at,
            (event.plan_id,),
            "A plan expiration event was evaluated against virtual replay time.",
            TraceStatus.SUCCESS,
        )
        return _bounded(replace(state, trace=(*state.trace, trace)))

    if event.event_type == "clock_tick":
        stale_refs: set[str] = set()
        current_plan = next(
            (plan for plan in state.plans if plan.id == state.situation.current_plan_id),
            None,
        )
        if current_plan is not None:
            stale_refs = {
                evidence_id
                for evidence_id in current_plan.based_on_evidence_ids
                for item in state.evidence
                if item.id == evidence_id
                and item.trust_status in {TrustStatus.VERIFIED_OFFICIAL, TrustStatus.VERIFIED_PARTNER}
                and event.occurred_at >= expires_at_for(item, policy)
            }
        if state.situation.network_state == NetworkState.OFFLINE_RECENT and stale_refs:
            situation = state.situation.model_copy(
                update={"network_state": NetworkState.OFFLINE_STALE, "updated_at": event.occurred_at}
            )
            trace = _trace(
                state,
                event.id,
                "OFFLINE_EVIDENCE_STALE",
                event.occurred_at,
                tuple(sorted(stale_refs)),
                "Cached evidence supporting the current plan expired during offline replay.",
                TraceStatus.SUCCESS,
            )
            return _bounded(replace(state, situation=situation, trace=(*state.trace, trace)))

    trace = _trace(
        state,
        event.id,
        "REPLAY_CLOCK_ADVANCED",
        event.occurred_at,
        (),
        "The synthetic replay clock advanced.",
        TraceStatus.SUCCESS,
    )
    return _bounded(replace(state, trace=(*state.trace, trace)))


def append_plan(state: CoreState, plan: Plan, actions: tuple[PlanAction, ...]) -> CoreState:
    """Append a plan version without mutating earlier plan or action records."""
    if plan.situation_id != state.situation.id:
        raise ValueError("plan belongs to another situation")
    if any(existing.id == plan.id for existing in state.plans):
        raise ValueError("published plan IDs are immutable and unique")
    previous_versions = [existing.version for existing in state.plans]
    expected_version = max(previous_versions, default=0) + 1
    if plan.version != expected_version:
        raise ValueError(f"next plan version must be {expected_version}")
    if plan.previous_plan_id != (state.plans[-1].id if state.plans else None):
        raise ValueError("previous_plan_id must reference the latest published version")
    known_evidence = {item.id for item in state.evidence}
    if not set(plan.based_on_evidence_ids).issubset(known_evidence):
        raise ValueError("plan references unknown evidence")
    existing_action_ids = {action.id for action in state.plan_actions}
    if any(action.id in existing_action_ids for action in actions):
        raise ValueError("published plan action IDs are immutable and unique")
    appended_action_ids = [action.id for action in actions]
    if len(appended_action_ids) != len(set(appended_action_ids)):
        raise ValueError("action IDs must be unique within a published plan")
    if any(action.plan_id != plan.id for action in actions):
        raise ValueError("every action must reference the appended plan")
    if any(not set(action.evidence_ids).issubset(known_evidence) for action in actions):
        raise ValueError("plan action references unknown evidence")
    if len(state.plans) >= MAX_PLANS or len(state.plan_actions) + len(actions) > MAX_ACTIONS:
        raise ValueError("plan history limit reached")
    situation = state.situation.model_copy(update={"current_plan_id": plan.id, "updated_at": plan.created_at})
    return replace(
        state,
        situation=situation,
        plans=(*state.plans, plan),
        plan_actions=(*state.plan_actions, *actions),
    )


def _append_evidence(
    state: CoreState,
    event_id: str,
    evidence: Evidence,
    trace_type: str,
    extra_refs: tuple[str, ...] = (),
) -> CoreState:
    if any(existing.id == evidence.id for existing in state.evidence):
        raise ValueError("evidence IDs must be unique")
    situation_updates = {
        "incident_status": IncidentStatus.ASSESSING,
        "updated_at": evidence.received_at,
        "uncertainty_flags": (
            (*state.situation.uncertainty_flags, "UNVERIFIED_SOURCE_PRESENT")
            if evidence.trust_status == TrustStatus.UNVERIFIED
            else state.situation.uncertainty_flags
        ),
    }
    situation = state.situation.model_copy(update=situation_updates)
    summary = (
        "An unverified synthetic report was retained for display and excluded from action evidence."
        if evidence.trust_status == TrustStatus.UNVERIFIED
        else (
            "Synthetic replay evidence was normalized and stored with server-assigned source trust."
            if evidence.is_synthetic
            else "Official live evidence was normalized with server-assigned source trust and scope."
        )
    )
    trace = _trace(
        state,
        event_id,
        trace_type,
        evidence.received_at,
        (event_id,),
        summary,
        TraceStatus.REJECTED if evidence.trust_status == TrustStatus.UNVERIFIED else TraceStatus.SUCCESS,
        (evidence.id, *extra_refs),
        agent=AgentName.REPLAY_ENGINE if evidence.is_synthetic else AgentName.SOURCE_AGENT,
    )
    return _bounded(replace(state, situation=situation, evidence=(*state.evidence, evidence), trace=(*state.trace, trace)))


def _evidence(
    state: CoreState,
    event_id: str,
    source_key: str,
    trust_status: TrustStatus,
    published_at,
    received_at,
    areas: tuple[str, ...],
    claim_type: ClaimType,
    claims: tuple[Claim, ...],
    summary: str,
    policy: SafetyPolicy,
    *,
    affected_area_ids: tuple[str, ...] = (),
    disaster_assessments: tuple[DisasterAssessment, ...] = (),
    route_area_ids: tuple[str, str] | None = None,
    mobility_status: MobilityStatus | None = None,
) -> Evidence:
    source = SIMULATION_SOURCE_REGISTRY[source_key]
    if trust_status != source.trust_status:
        raise ValueError("source trust does not match the server-side simulation registry")
    if claim_type != source.allowed_claim_type:
        raise ValueError("source registry does not authorize this claim type")
    if any(
        claim.key not in source.allowed_claim_values
        or (
            source.allowed_claim_values[claim.key] is not None
            and claim.value not in source.allowed_claim_values[claim.key]
        )
        for claim in claims
    ):
        raise ValueError("source registry does not authorize one or more claim keys or values")
    normalized_assessments = _normalize_legacy_disaster_assessments(
        source_key,
        disaster_assessments,
        claims,
    )
    if normalized_assessments and not source_authorizes_disaster_assessments(source):
        raise ValueError(
            "source registry does not authorize generated disaster assessment claims"
        )
    if (route_area_ids is not None or mobility_status is not None) and not source_authorizes_transport(
        source
    ):
        raise ValueError("source registry does not authorize generated route claims")
    if route_area_ids is not None and mobility_status is None:
        raise ValueError("route area IDs require an authorized mobility status")
    all_area_ids = tuple(
        dict.fromkeys(
            (
                *affected_area_ids,
                *(assessment.area_id for assessment in normalized_assessments),
                *(route_area_ids or ()),
            )
        )
    )
    _validate_area_authority(state, source_key, all_area_ids)
    normalized_claims = [*claims, *claims_from_disaster_assessments(normalized_assessments)]
    if route_area_ids is not None and mobility_status is not None:
        normalized_claims.append(
            Claim(key=route_claim_key(*route_area_ids), value=mobility_status.value)
        )
    claim_keys = [claim.key for claim in normalized_claims]
    if len(claim_keys) != len(set(claim_keys)):
        raise ValueError("normalized evidence contains duplicate claim keys")
    expires_at = published_at + timedelta(seconds=policy.ttl_for_claim_type(claim_type.value))
    freshness_status = (
        FreshnessStatus.CURRENT
        if received_at < expires_at
        else FreshnessStatus.STALE
    )
    return Evidence(
        id=f"ev_{event_id}",
        situation_id=state.situation.id,
        source_key=source_key,
        source_name=source.source_name,
        source_class=source.source_class,
        trust_status=source.trust_status,
        freshness_status=freshness_status,
        published_at=published_at,
        received_at=received_at,
        relevant_areas=areas,
        affected_area_ids=all_area_ids,
        disaster_assessments=normalized_assessments,
        claim_type=claim_type,
        claims=tuple(normalized_claims),
        summary=summary,
        expires_at=expires_at,
        raw_reference=f"replay://{state.scenario_key}/{event_id}",
        is_synthetic=True,
    )


def _validate_area_authority(
    state: CoreState,
    source_key: str,
    area_ids: tuple[str, ...] | set[str],
) -> None:
    source = SIMULATION_SOURCE_REGISTRY[source_key]
    catalog = {area.id: area for area in state.area_catalog}
    for area_id in area_ids:
        if area_id not in catalog:
            raise ValueError("evidence references an area outside the scenario catalog")
        if source.trust_status in {TrustStatus.VERIFIED_OFFICIAL, TrustStatus.VERIFIED_PARTNER} and not source_authorizes_area(
            source, area_id, catalog
        ):
            raise ValueError(f"source registry does not authorize area {area_id}")


def _normalize_legacy_disaster_assessments(
    source_key: str,
    assessments: tuple[DisasterAssessment, ...],
    claims: tuple[Claim, ...],
) -> tuple[DisasterAssessment, ...]:
    """Normalize legacy Tokyo keys only at their explicitly registered source adapter."""
    legacy_area = SIMULATION_SOURCE_REGISTRY[source_key].legacy_disaster_area_id
    if legacy_area is None:
        return assessments

    status_key = "disaster.tokyo.status"
    level_key = "disaster.tokyo.severity"
    legacy_status = next((item.value for item in claims if item.key == status_key), None)
    legacy_level = next((item.value for item in claims if item.key == level_key), None)
    if legacy_status is None and legacy_level is None:
        return assessments

    existing = next(
        (
            item
            for item in assessments
            if item.area_id == legacy_area and item.event_type == DisasterEventType.EARTHQUAKE
        ),
        None,
    )
    if existing is not None and (
        (legacy_status is not None and existing.status.value != legacy_status)
        or (
            legacy_level is not None
            and existing.level is not None
            and existing.level.value != legacy_level
        )
    ):
        raise ValueError("typed disaster assessment conflicts with legacy Tokyo claim")
    remaining = tuple(item for item in assessments if item is not existing)
    status = (
        DisasterEventStatus(legacy_status)
        if legacy_status is not None
        else existing.status if existing is not None else DisasterEventStatus.UNKNOWN
    )
    level = legacy_level if legacy_level is not None else existing.level if existing is not None else None
    normalized = DisasterAssessment(
        area_id=legacy_area,
        event_type=DisasterEventType.EARTHQUAKE,
        level=level,
        status=status,
    )
    return (*remaining, normalized)


def _network_transition(
    state: CoreState,
    event_id: str,
    timestamp,
    target: NetworkState,
    trace_type: str,
    summary: str,
) -> CoreState:
    situation = state.situation.model_copy(
        update={"network_state": target, "updated_at": timestamp}
    )
    trace = _trace(state, event_id, trace_type, timestamp, (), summary, TraceStatus.SUCCESS)
    reconnect_evidence_count = (
        len(state.evidence)
        if target == NetworkState.RECONNECTING
        else state.reconnect_evidence_count
    )
    last_reconnect_at = (
        timestamp
        if target == NetworkState.RECONNECTING
        else state.last_reconnect_at
    )
    return _bounded(
        replace(
            state,
            situation=situation,
            trace=(*state.trace, trace),
            reconnect_evidence_count=reconnect_evidence_count,
            last_reconnect_at=last_reconnect_at,
        )
    )


def _trace(
    state: CoreState,
    event_id: str,
    event_type: str,
    timestamp,
    input_refs: tuple[str, ...],
    summary: str,
    status: TraceStatus,
    output_refs: tuple[str, ...] = (),
    *,
    agent: AgentName = AgentName.REPLAY_ENGINE,
) -> TraceEvent:
    return TraceEvent(
        id=f"trace_{event_id}",
        situation_id=state.situation.id,
        timestamp=timestamp,
        agent=agent,
        event_type=event_type,
        input_refs=input_refs,
        output_refs=output_refs,
        status=status,
        public_summary=summary,
    )


def _bounded(state: CoreState) -> CoreState:
    if len(state.events) > MAX_EVENTS:
        raise ValueError("replay disaster event limit reached")
    if len(state.evidence) > MAX_EVIDENCE:
        raise ValueError("replay evidence limit reached")
    if len(state.trace) > MAX_TRACE:
        raise ValueError("replay trace limit reached")
    if len(state.mobility) > MAX_MOBILITY:
        raise ValueError("replay mobility limit reached")
    return state
