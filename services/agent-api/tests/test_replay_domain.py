from datetime import timedelta

import pytest
from pydantic import ValidationError

from seventytwoh_contracts.models import (
    ClaimStateStatus,
    FreshnessStatus,
    Language,
    MobilityStatus,
    Plan,
    PlanAction,
    PlanActionCategory,
    PlanActionStatus,
    PlanEvaluationStatus,
    PlanStatus,
    RiskLevel,
    SafetyDecision,
    TrustStatus,
)
from agent_api.domain import append_plan, reduce_event, reduce_raw_event
from agent_api.planning import assess_action, evidence_projections
from agent_api.safety import DEFAULT_POLICY, expires_at_for, project_evidence
from agent_api.scenario import load_scenario


def _event_by_id(scenario, event_id):
    return next(event for event in scenario.events if event.id == event_id)


def _reduce_ids(state, *event_ids):
    scenario = load_scenario()
    for event_id in event_ids:
        state = reduce_event(state, _event_by_id(scenario, event_id))
    return state


def _replay_all(initial_state):
    state = initial_state
    for event in load_scenario().events:
        state = reduce_event(state, event)
    return state


def test_scenario_order_and_fixture_timestamps_are_stable():
    scenario = load_scenario()
    again = load_scenario()

    assert [event.id for event in scenario.events] == [event.id for event in again.events]
    assert [event.offset_seconds for event in scenario.events] == sorted(
        event.offset_seconds for event in scenario.events
    )
    assert all(event.occurred_at.utcoffset() is not None for event in scenario.events)
    assert any(event.event_type == "clock_tick" for event in scenario.events)
    assert [event.id for event in scenario.events[:3]] == [
        "evt-earthquake-001",
        "official-update-001",
        "transport-update-001",
    ]


def test_full_replay_is_golden_across_ten_runs_and_plans_are_state_driven(initial_state):
    first = _replay_all(initial_state)
    for _ in range(9):
        assert _replay_all(initial_state) == first

    assert first.situation.network_state == "ONLINE_VERIFIED"
    assert [event.id for event in first.events] == ["evt_evt-earthquake-001"]
    assert [item.id for item in first.evidence] == [
        "ev_official-update-001",
        "ev_transport-update-001",
        "ev_unverified-report-001",
        "ev_reconnect-official-update-001",
        "ev_reconnect-transport-update-001",
    ]
    assert [plan.id for plan in first.plans] == ["plan_v1", "plan_v2", "plan_v3", "plan_v4"]
    assert all(plan.status == PlanStatus.ACTIVE for plan in first.plans)
    assert first.situation.current_plan_id == "plan_v4"
    for plan in first.plans:
        assert {action.category for action in first.plan_actions if action.plan_id == plan.id} == {
            PlanActionCategory.NOW,
            PlanActionCategory.NEXT,
            PlanActionCategory.AVOID,
        }
    assert {item.status for item in first.plan_evaluations} >= {
        PlanEvaluationStatus.PARTIAL_INVALIDATION,
        PlanEvaluationStatus.EXPIRED,
    }
    assert len({action.id for action in first.plan_actions}) == len(first.plan_actions)
    assert all(item.is_synthetic and item.raw_reference.startswith("replay://") for item in first.evidence)
    assert all(not item.eligible_for_high_risk for item in first.evidence)


def test_plan_creation_and_replanning_follow_claim_changes_not_event_positions(initial_state):
    state = _reduce_ids(initial_state, "evt-earthquake-001", "official-update-001")
    assert [plan.id for plan in state.plans] == ["plan_v1"]
    original_plan = state.plans[0]
    original_actions = tuple(action for action in state.plan_actions if action.plan_id == original_plan.id)

    harmless = {
        "id": "clock-no-change-001",
        "event_type": "clock_tick",
        "occurred_at": "2026-10-04T17:43:05+09:00",
        "offset_seconds": 16,
        "label": "Clock check without a claim change",
    }
    state = reduce_raw_event(state, harmless)
    assert len(state.plans) == 1

    transport = _event_by_id(load_scenario(), "transport-update-001").model_dump(mode="json")
    transport["id"] = "transport-change-001"
    transport["occurred_at"] = "2026-10-04T17:47:00+09:00"
    transport["published_at"] = "2026-10-04T17:46:55+09:00"
    state = reduce_raw_event(state, transport)

    assert [plan.id for plan in state.plans] == ["plan_v1", "plan_v2"]
    assert state.plans[0] == original_plan
    assert tuple(action for action in state.plan_actions if action.plan_id == original_plan.id) == original_actions
    assert state.situation.current_plan_id == "plan_v2"
    assert state.plan_evaluations[-1].status == PlanEvaluationStatus.PARTIAL_INVALIDATION


def test_reconnect_waits_for_current_official_and_transport_claims(initial_state):
    state = _reduce_ids(
        initial_state,
        "evt-earthquake-001",
        "official-update-001",
        "transport-update-001",
        "unverified-report-001",
        "network-degraded-001",
        "network-lost-001",
        "offline-clock-tick-001",
    )
    pre_restore_official = {
        "id": "pre-restore-official-001",
        "event_type": "verified_update",
        "occurred_at": "2026-10-04T17:52:40+09:00",
        "offset_seconds": 164,
        "label": "Official update ordered before same-time reconnect",
        "source_key": "jma-replay",
            "published_at": "2026-10-04T17:52:39+09:00",
            "affected_areas": ["Tokyo"],
            "affected_area_ids": ["JP-13"],
            "disaster_assessments": [
                {"area_id": "JP-13", "event_type": "EARTHQUAKE", "status": "ACTIVE"}
            ],
            "claims": [{"key": "disaster.tokyo.status", "value": "ACTIVE"}],
        "summary": "A validated official state before the replay reconnect marker.",
    }
    pre_restore_transport = {
        "id": "pre-restore-transport-001",
        "event_type": "verified_update",
        "occurred_at": "2026-10-04T17:52:40+09:00",
        "offset_seconds": 164,
        "label": "Transport update ordered before same-time reconnect",
        "source_key": "transport-replay",
        "published_at": "2026-10-04T17:52:39+09:00",
            "origin": "Shibuya",
            "destination": "Asakusa",
            "origin_area_id": "JP-13-SHIBUYA",
            "destination_area_id": "JP-13-ASAKUSA",
        "mobility_status": "UNKNOWN",
        "claims": [{"key": "route.shibuya_asakusa.status", "value": "UNKNOWN"}],
        "summary": "A validated route state before the replay reconnect marker.",
    }
    state = reduce_raw_event(state, pre_restore_official)
    state = reduce_raw_event(state, pre_restore_transport)
    restored = _event_by_id(load_scenario(), "network-restored-001")
    state = reduce_event(state, restored)
    assert state.situation.network_state == "RECONNECTING"

    post_restore_official = {
        **pre_restore_official,
        "id": "post-restore-official-001",
        "label": "Official update ordered after same-time reconnect",
        "published_at": "2026-10-04T17:52:40+09:00",
    }
    state = reduce_raw_event(state, post_restore_official)
    assert state.situation.network_state == "RECONNECTING"
    post_restore_transport = {
        **pre_restore_transport,
        "id": "post-restore-transport-001",
        "label": "Transport update ordered after same-time reconnect",
        "published_at": "2026-10-04T17:52:40+09:00",
    }
    state = reduce_raw_event(state, post_restore_transport)
    assert state.situation.network_state == "ONLINE_VERIFIED"
    reconciliation = next(item for item in state.trace if item.event_type == "RECONCILIATION_COMPLETED")
    assert {ref for ref in reconciliation.output_refs} == {
        "ev_post-restore-official-001",
        "ev_post-restore-transport-001",
    }


def test_unverified_report_does_not_change_verified_claims_plans_or_last_verified_time(initial_state):
    state = _reduce_ids(initial_state, "evt-earthquake-001", "official-update-001", "transport-update-001")
    claims_before = {
        item.key: (item.status, item.value, item.evidence_ids)
        for item in state.situation.claim_states
        if item.key in {"disaster.tokyo.status", "route.shibuya_asakusa.status"}
    }
    plans_before = state.plans
    evaluations_before = state.plan_evaluations
    last_verified_at = state.situation.latest_evidence_at

    state = reduce_event(state, _event_by_id(load_scenario(), "unverified-report-001"))

    assert state.situation.latest_evidence_at == last_verified_at
    claims_after = {
        item.key: (item.status, item.value, item.evidence_ids)
        for item in state.situation.claim_states
        if item.key in {"disaster.tokyo.status", "route.shibuya_asakusa.status"}
    }
    assert claims_after == claims_before
    assert state.plans == plans_before
    assert state.plan_evaluations == evaluations_before
    assert state.evidence[-1].trust_status == TrustStatus.UNVERIFIED
    assert state.evidence[-1].eligible_for_high_risk is False
    assert state.trace[-1].status == "REJECTED"


@pytest.mark.parametrize(
    ("language", "expected_reason"),
    [
        (Language.ENGLISH, "An eligible verified official update is available; review its stated disaster status."),
        (Language.TRADITIONAL_CHINESE, "目前有符合資格的已驗證官方資訊，請查看其中所載的災害狀態。"),
        (Language.JAPANESE, "確認済みの公式情報があります。示されている災害状況を確認してください。"),
    ],
)
def test_resolved_disaster_never_gets_rendered_as_active(language, expected_reason, initial_state):
    state = initial_state
    state = type(state)(
        profile=state.profile.model_copy(update={"preferred_language": language}),
        situation=state.situation,
        current_time=state.current_time,
        scenario_key=state.scenario_key,
        area_catalog=state.area_catalog,
    )
    state = _reduce_ids(state, "evt-earthquake-001", "official-update-001", "transport-update-001")
    resolved = {
        "id": "official-resolved-001",
        "event_type": "verified_update",
        "occurred_at": "2026-10-04T17:48:00+09:00",
        "offset_seconds": 480,
        "label": "Verified resolved status",
        "source_key": "jma-replay",
        "published_at": "2026-10-04T17:47:55+09:00",
        "affected_areas": ["Tokyo"],
        "claims": [{"key": "disaster.tokyo.status", "value": "RESOLVED"}],
        "summary": "The synthetic official source reports that the event is resolved.",
    }

    state = reduce_raw_event(state, resolved)
    current_plan = next(plan for plan in state.plans if plan.id == state.situation.current_plan_id)
    now_action = next(
        action
        for action in state.plan_actions
        if action.plan_id == current_plan.id and action.category == PlanActionCategory.NOW
    )

    assert now_action.reason == expected_reason
    assert "active earthquake" not in now_action.reason.casefold()
    assert "東京發生地震" not in now_action.reason


@pytest.mark.parametrize(
    ("language", "expected_reason"),
    [
        (Language.ENGLISH, "No current verified official update is available."),
        (Language.TRADITIONAL_CHINESE, "目前沒有有效的已驗證官方資訊。"),
        (Language.JAPANESE, "現在有効な確認済み公式情報はありません。"),
    ],
)
def test_now_reason_stays_localized_when_official_evidence_expires(language, expected_reason, initial_state):
    state = initial_state
    state = type(state)(
        profile=state.profile.model_copy(update={"preferred_language": language}),
        situation=state.situation,
        current_time=state.current_time,
        scenario_key=state.scenario_key,
        area_catalog=state.area_catalog,
    )
    state = _reduce_ids(state, "evt-earthquake-001", "official-update-001")
    stale_tick = {
        "id": "official-ttl-clock-001",
        "event_type": "clock_tick",
        "occurred_at": "2026-10-04T18:00:00+09:00",
        "offset_seconds": 1200,
        "label": "Official evidence TTL elapsed",
    }

    state = reduce_raw_event(state, stale_tick)
    current_plan = next(plan for plan in state.plans if plan.id == state.situation.current_plan_id)
    now_action = next(
        action
        for action in state.plan_actions
        if action.plan_id == current_plan.id and action.category == PlanActionCategory.NOW
    )

    assert now_action.reason == expected_reason
    assert now_action.evidence_ids == ()
    assert now_action.safety_decision == SafetyDecision.ALLOW


def test_published_at_controls_ttl_and_delayed_evidence_is_stale_on_arrival(initial_state):
    delayed = _event_by_id(load_scenario(), "official-update-001").model_dump(mode="json")
    delayed["published_at"] = "2026-10-04T17:20:00+09:00"
    state = reduce_raw_event(initial_state, delayed)

    assert state.evidence[0].freshness_status == FreshnessStatus.STALE
    assert state.situation.latest_evidence_at is None
    assert next(item for item in state.situation.claim_states if item.key == "disaster.tokyo.status").status == ClaimStateStatus.UNKNOWN
    projection = evidence_projections(
        state.evidence,
        state.situation,
        state.current_time,
    )[0]
    assert projection.age_seconds == 23 * 60
    assert projection.freshness_status == FreshnessStatus.STALE
    assert projection.eligible_for_claims is False
    assert projection.expires_at == state.evidence[0].published_at + timedelta(seconds=DEFAULT_POLICY.official_disaster_ttl_seconds)

    explicit = state.evidence[0].model_copy(
        update={"expires_at": state.evidence[0].published_at + timedelta(seconds=60)}
    )
    assert expires_at_for(explicit, DEFAULT_POLICY) == explicit.expires_at
    assert project_evidence(explicit, state.current_time, DEFAULT_POLICY).freshness_status == FreshnessStatus.STALE


def test_future_or_backwards_timestamps_are_rejected_without_state_mutation(initial_state):
    valid = _event_by_id(load_scenario(), "official-update-001").model_dump(mode="json")
    future = {**valid, "published_at": "2026-10-04T17:43:01+09:00"}
    with pytest.raises(ValidationError, match="published_at"):
        reduce_raw_event(initial_state, future)

    state = reduce_event(initial_state, _event_by_id(load_scenario(), "evt-earthquake-001"))
    backwards = {
        "id": "clock-backwards-001",
        "event_type": "clock_tick",
        "occurred_at": "2026-10-04T17:41:00+09:00",
        "offset_seconds": 1,
        "label": "Invalid backwards virtual clock",
    }
    with pytest.raises(ValueError, match="cannot move virtual time backwards"):
        reduce_raw_event(state, backwards)
    assert state.current_time.isoformat() == "2026-10-04T17:42:00+09:00"
    assert len(state.trace) == 1


def test_conflict_projections_invalidate_plan_without_mutating_history(initial_state):
    state = _reduce_ids(initial_state, "evt-earthquake-001", "official-update-001")
    official = _event_by_id(load_scenario(), "official-update-001")
    original_plan = state.plans[0]
    original_actions = tuple(state.plan_actions)
    conflicting = official.model_dump(mode="json")
    conflicting.update(
        {
            "id": "official-conflict-001",
            "occurred_at": "2026-10-04T17:44:00+09:00",
            "published_at": "2026-10-04T17:42:50+09:00",
            "disaster_assessments": [
                {"area_id": "JP-13", "event_type": "EARTHQUAKE", "status": "RESOLVED"}
            ],
            "claims": [{"key": "disaster.tokyo.status", "value": "RESOLVED"}],
        }
    )
    state = reduce_raw_event(state, conflicting)

    claim = next(item for item in state.situation.claim_states if item.key == "disaster.tokyo.status")
    assert claim.status == ClaimStateStatus.CONFLICT
    assert "disaster.EARTHQUAKE.JP-13.status" in state.situation.conflict_flags
    projections = evidence_projections(state.evidence, state.situation, state.current_time)
    assert all(item.conflict and not item.eligible_for_claims for item in projections)
    assert state.plan_evaluations[-1].status in {
        PlanEvaluationStatus.PARTIAL_INVALIDATION,
        PlanEvaluationStatus.INVALIDATED,
    }
    assert state.plans[0] == original_plan
    assert state.plan_actions[: len(original_actions)] == original_actions
    assert state.situation.current_plan_id == "plan_v2"


def test_offline_expiry_uses_published_age_and_keeps_plan_history_immutable(initial_state):
    state = _reduce_ids(
        initial_state,
        "evt-earthquake-001",
        "official-update-001",
        "transport-update-001",
        "unverified-report-001",
        "network-degraded-001",
        "network-lost-001",
        "offline-clock-tick-001",
    )
    assert state.situation.network_state == "OFFLINE_STALE"
    route = next(item for item in state.situation.claim_states if item.key == "route.shibuya_asakusa.status")
    assert route.status == ClaimStateStatus.UNKNOWN
    evaluation = next(item for item in state.plan_evaluations if item.plan_id == "plan_v2")
    assert evaluation.status == PlanEvaluationStatus.EXPIRED
    assert state.plans[1].status == PlanStatus.ACTIVE
    assert state.situation.current_plan_id == "plan_v3"
    transport = next(item for item in state.evidence if item.id == "ev_transport-update-001")
    assert transport.published_at.isoformat() == "2026-10-04T17:46:55+09:00"
    assert transport.received_at.isoformat() == "2026-10-04T17:47:00+09:00"


def test_safety_assessment_fails_closed_for_high_risk_and_hallucinated_references(initial_state):
    state = _reduce_ids(initial_state, "evt-earthquake-001", "official-update-001")
    action = next(item for item in state.plan_actions if item.category == PlanActionCategory.NOW)
    evidence_by_id = {item.id: item for item in state.evidence}
    projections = {
        item.evidence_id: item
        for item in evidence_projections(state.evidence, state.situation, state.current_time)
    }

    high_risk = action.model_copy(update={"risk_level": RiskLevel.HIGH})
    blocked = assess_action(high_risk, evidence_by_id, projections)
    assert blocked.status == PlanActionStatus.BLOCKED
    assert blocked.safety_decision == SafetyDecision.BLOCK
    assert not evidence_by_id[action.evidence_ids[0]].eligible_for_high_risk

    hallucinated = action.model_copy(update={"evidence_ids": ("ev_not_real",)})
    with pytest.raises(ValueError, match="unknown evidence"):
        assess_action(hallucinated, evidence_by_id, projections)

    # All LLM wording is excluded from the contract: only typed server-owned intents are published.
    assert action.intent_id is not None

    transport = _event_by_id(load_scenario(), "transport-update-001").model_dump(mode="json")
    with pytest.raises(ValidationError):
        reduce_raw_event(initial_state, {**transport, "mobility_status": "SAFE"})


def test_plan_versions_append_without_mutating_previous_records(initial_state):
    state = reduce_event(initial_state, _event_by_id(load_scenario(), "official-update-001"))
    created = state.evidence[0].received_at
    plan_v1 = Plan(
        id="manual_plan_v1",
        situation_id=state.situation.id,
        version=1,
        status=PlanStatus.ACTIVE,
        created_at=created,
        expires_at=created + timedelta(minutes=15),
        invalidate_on_new_relevant_evidence=True,
        based_on_evidence_ids=(state.evidence[0].id,),
        language=state.profile.preferred_language,
    )
    action_v1 = PlanAction(
        id="manual_act_v1_001",
        plan_id=plan_v1.id,
        category=PlanActionCategory.NOW,
        text="Monitor synthetic replay updates.",
        reason="A synthetic earthquake event is present.",
        risk_level=RiskLevel.LOW,
        evidence_ids=(state.evidence[0].id,),
        status=PlanActionStatus.ACTIVE,
        safety_decision=SafetyDecision.ALLOW,
    )
    state_v1 = append_plan(state, plan_v1, (action_v1,))

    plan_v2 = Plan(
        id="manual_plan_v2",
        situation_id=state.situation.id,
        version=2,
        status=PlanStatus.ACTIVE,
        created_at=created + timedelta(seconds=1),
        expires_at=created + timedelta(minutes=15, seconds=1),
        invalidate_on_new_relevant_evidence=True,
        based_on_evidence_ids=(state.evidence[0].id,),
        previous_plan_id=plan_v1.id,
        language=state.profile.preferred_language,
    )
    state_v2 = append_plan(state_v1, plan_v2, ())

    assert state_v2.plans == (plan_v1, plan_v2)
    assert state_v2.plans[0].status == PlanStatus.ACTIVE
    assert state_v2.plan_actions == (action_v1,)
    assert state_v2.situation.current_plan_id == plan_v2.id
    with pytest.raises(ValidationError):
        plan_v1.version = 2
    with pytest.raises(ValueError, match="next plan version"):
        append_plan(state_v2, plan_v2.model_copy(update={"id": "manual_plan_v3", "version": 4}), ())


def test_plan_action_and_evidence_references_and_duplicate_ids_are_rejected(initial_state):
    state = reduce_event(initial_state, _event_by_id(load_scenario(), "official-update-001"))
    created = state.evidence[0].received_at
    plan = Plan(
        id="manual_plan_v1",
        situation_id=state.situation.id,
        version=1,
        status=PlanStatus.ACTIVE,
        created_at=created,
        expires_at=created + timedelta(minutes=5),
        invalidate_on_new_relevant_evidence=True,
        based_on_evidence_ids=(state.evidence[0].id,),
        language=state.profile.preferred_language,
    )
    action = PlanAction(
        id="manual_act_v1_001",
        plan_id=plan.id,
        category=PlanActionCategory.NEXT,
        text="Re-check verified information.",
        reason="Current synthetic replay information is available.",
        risk_level=RiskLevel.LOW,
        evidence_ids=(state.evidence[0].id,),
        status=PlanActionStatus.ACTIVE,
        safety_decision=SafetyDecision.ALLOW,
    )

    with pytest.raises(ValueError, match="unique within"):
        append_plan(state, plan, (action, action))
    unknown_evidence_action = action.model_copy(
        update={"id": "act_unknown", "evidence_ids": ("ev_does_not_exist",)}
    )
    with pytest.raises(ValueError, match="unknown evidence"):
        append_plan(state, plan, (unknown_evidence_action,))
    with pytest.raises(ValueError, match="unknown evidence"):
        append_plan(state, plan.model_copy(update={"based_on_evidence_ids": ("ev_does_not_exist",)}), ())


def test_malformed_or_unsafe_replay_payload_is_atomic(initial_state):
    valid = _event_by_id(load_scenario(), "transport-update-001").model_dump(mode="json")
    invalid = {**valid, "mobility_status": "SAFE"}

    with pytest.raises(ValidationError):
        reduce_raw_event(initial_state, invalid)

    assert initial_state.events == ()
    assert initial_state.evidence == ()
    assert initial_state.mobility == ()
    assert initial_state.trace == ()
    assert initial_state.situation.updated_at == initial_state.situation.created_at


def test_replay_event_cannot_claim_source_trust_or_accept_unknown_fields(initial_state):
    valid = _event_by_id(load_scenario(), "official-update-001").model_dump(mode="json")

    for key, value in (("trust_status", "VERIFIED_OFFICIAL"), ("made_up", True)):
        with pytest.raises(ValidationError):
            reduce_raw_event(initial_state, {**valid, key: value})
    with pytest.raises(ValidationError):
        reduce_raw_event(initial_state, {**valid, "source_key": "trusted-by-client"})
    assert initial_state.evidence == ()


def test_source_registry_rejects_cross_class_claims_atomically(initial_state):
    official = _event_by_id(load_scenario(), "official-update-001").model_dump(mode="json")
    transport = _event_by_id(load_scenario(), "transport-update-001").model_dump(mode="json")
    jma_transport_claim = {
        **official,
        "claims": [{"key": "route.shibuya_asakusa.status", "value": "AVAILABLE"}],
    }
    partner_disaster_claim = {
        **transport,
        "claims": [{"key": "disaster.tokyo.status", "value": "ACTIVE"}],
    }
    verified_jma_route = {
        "id": "verified-cross-source-001",
        "event_type": "verified_update",
        "occurred_at": "2026-10-04T17:43:00+09:00",
        "offset_seconds": 15,
        "label": "Unallowed JMA transport claim",
        "source_key": "jma-replay",
        "published_at": "2026-10-04T17:42:50+09:00",
        "affected_areas": ["Tokyo"],
        "claims": [{"key": "route.shibuya_asakusa.status", "value": "AVAILABLE"}],
        "summary": "This claim key does not belong to the official source registry entry.",
    }
    for payload in (jma_transport_claim, partner_disaster_claim, verified_jma_route):
        with pytest.raises(ValueError, match="source registry"):
            reduce_raw_event(initial_state, payload)
    assert initial_state.evidence == ()
    assert initial_state.mobility == ()
    assert initial_state.trace == ()


def test_timestamps_must_be_timezone_aware_and_claim_keys_unique(initial_state):
    valid = _event_by_id(load_scenario(), "official-update-001").model_dump(mode="json")
    invalid_time = {**valid, "occurred_at": "2026-10-04T17:43:00"}
    with pytest.raises(ValidationError):
        reduce_raw_event(initial_state, invalid_time)
    duplicate_claims = {
        **valid,
        "claims": [
            {"key": "disaster.tokyo.status", "value": "ACTIVE"},
            {"key": "disaster.tokyo.status", "value": "RESOLVED"},
        ],
    }
    with pytest.raises(ValidationError, match="claim keys must be unique"):
        reduce_raw_event(initial_state, duplicate_claims)
    assert initial_state.situation.updated_at == initial_state.situation.created_at
