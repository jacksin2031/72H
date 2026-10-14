from dataclasses import replace
from datetime import timedelta

from agent_api.distress import record_distress_report
from agent_api.planning import evaluate_and_replan
from agent_api.safety import DEFAULT_POLICY, disaster_claim_key
from seventytwoh_contracts.models import (
    DistressTag, FreshnessStatus, Language, PlanActionCategory, PlanActionStatus, PlanEvaluationStatus,
    RiskLevel, SafeIntentId, SafetyDecision, TsunamiWarningClass,
)
from tests.distress_fixtures import base_state, tsunami_evidence, with_claim
from tests.test_distress import NOW

Clock = type("Clock", (), {"id": "distress-test"})


def _now_action(state):
    plan_id = state.situation.current_plan_id
    return next(a for a in state.plan_actions if a.plan_id == plan_id and a.category == PlanActionCategory.NOW)


def test_user_report_creates_new_plan_version_with_vertical_shelter_allowed():
    before = base_state(NOW)
    after = record_distress_report(before, (DistressTag.WATER_RISING,), "BUTTON", NOW)
    planned = evaluate_and_replan(before, after, Clock(), DEFAULT_POLICY)
    action = _now_action(planned)
    assert action.intent_id == SafeIntentId.SHELTER_IN_PLACE_VERTICAL
    assert action.safety_decision == SafetyDecision.ALLOW
    assert action.status == PlanActionStatus.ACTIVE
    assert action.risk_level == RiskLevel.LOW
    assert action.evidence_ids == ()
    assert action.id == f"act_{action.plan_id}_now"
    assert len(planned.plans) == len(before.plans) + 1


def test_official_trigger_creates_tsunami_evacuate_now_bound_to_evidence():
    before = base_state(NOW)
    after = with_claim(tsunami_evidence(before, TsunamiWarningClass.MAJOR_WARNING, NOW + timedelta(minutes=20)))
    planned = evaluate_and_replan(before, after, Clock(), DEFAULT_POLICY)
    action = _now_action(planned)
    assert action.intent_id == SafeIntentId.TSUNAMI_EVACUATE_NOW
    assert action.evidence_ids == ("ev_jma-tsunami-test",)
    assert action.dependency_keys == (disaster_claim_key("JP-04", "TSUNAMI", "status"),)
    assert action.dependency_values == {disaster_claim_key("JP-04", "TSUNAMI", "status"): "ACTIVE"}
    assert action.risk_level == RiskLevel.HIGH
    # CURRENT, verified, non-synthetic official evidence passes assess_action.
    assert action.safety_decision == SafetyDecision.ALLOW
    assert action.status == PlanActionStatus.ACTIVE


def test_stale_official_warning_never_publishes_tsunami_evacuate_now():
    before = base_state(NOW)
    after = with_claim(tsunami_evidence(
        before, TsunamiWarningClass.MAJOR_WARNING, NOW + timedelta(minutes=20), freshness=FreshnessStatus.STALE,
    ))
    planned = evaluate_and_replan(before, after, Clock(), DEFAULT_POLICY)
    assert all(a.intent_id != SafeIntentId.TSUNAMI_EVACUATE_NOW for a in planned.plan_actions)


def test_report_expiry_supersedes_the_plan_and_keeps_history():
    before = base_state(NOW)
    reported = evaluate_and_replan(before, record_distress_report(before, (DistressTag.TRAPPED,), "BUTTON", NOW), Clock(), DEFAULT_POLICY)
    later = replace(reported, current_time=NOW + timedelta(seconds=DEFAULT_POLICY.distress_critical_report_ttl_seconds))
    expired = evaluate_and_replan(reported, later, Clock(), DEFAULT_POLICY)
    assert _now_action(expired).intent_id != SafeIntentId.SHELTER_IN_PLACE_VERTICAL
    assert len(expired.plans) > len(reported.plans)
    # Published actions are immutable history: the old record is kept as-is, and its
    # supersession is recorded as a PlanEvaluation instead of rewriting the record.
    old = next(a for a in expired.plan_actions if a.intent_id == SafeIntentId.SHELTER_IN_PLACE_VERTICAL)
    assert old.plan_id != expired.situation.current_plan_id
    assert old in reported.plan_actions
    assert any(
        e.plan_id == old.plan_id and old.id in e.invalid_action_ids and e.status != PlanEvaluationStatus.KEEP
        for e in expired.plan_evaluations
    )


def test_warning_cancellation_invalidates_tsunami_evacuate_now():
    before = base_state(NOW)
    warned = evaluate_and_replan(before, with_claim(tsunami_evidence(before, TsunamiWarningClass.WARNING, NOW + timedelta(minutes=20))), Clock(), DEFAULT_POLICY)
    cancelled_state = replace(warned, evidence=(), situation=warned.situation.model_copy(update={"claim_states": ()}))
    cancelled = evaluate_and_replan(warned, cancelled_state, Clock(), DEFAULT_POLICY)
    assert _now_action(cancelled).intent_id != SafeIntentId.TSUNAMI_EVACUATE_NOW
    assert len(cancelled.plans) == len(warned.plans) + 1


def test_unchanged_distress_does_not_churn_plan_versions():
    before = base_state(NOW)
    reported = evaluate_and_replan(before, record_distress_report(before, (DistressTag.WATER_RISING,), "BUTTON", NOW), Clock(), DEFAULT_POLICY)
    again = evaluate_and_replan(reported, replace(reported, current_time=NOW + timedelta(seconds=1)), Clock(), DEFAULT_POLICY)
    assert len(again.plans) == len(reported.plans)


def test_distress_text_follows_preferred_language_without_safety_guarantees():
    for language, needle in ((Language.JAPANESE, "高い場所"), (Language.ENGLISH, "higher ground"), (Language.TRADITIONAL_CHINESE, "高處")):
        before = base_state(NOW)
        before = replace(before, profile=before.profile.model_copy(update={"preferred_language": language}))
        planned = evaluate_and_replan(before, record_distress_report(before, (DistressTag.WATER_RISING,), "BUTTON", NOW), Clock(), DEFAULT_POLICY)
        action = _now_action(planned)
        assert needle in action.text or needle in action.reason
        for banned in ("保證安全", "guaranteed safe", "安全を保証"):
            assert banned not in action.text and banned not in action.reason


def _tick_plan_counts(state, ticks=6, step_seconds=10):
    counts = []
    for _ in range(ticks):
        later = replace(state, current_time=state.current_time + timedelta(seconds=step_seconds))
        state = evaluate_and_replan(state, later, Clock(), DEFAULT_POLICY)
        counts.append(len(state.plans))
    return counts


def test_tsunami_trigger_with_unknown_arrival_does_not_replan_every_tick():
    before = base_state(NOW)
    warned = evaluate_and_replan(before, with_claim(tsunami_evidence(before, TsunamiWarningClass.MAJOR_WARNING, None)), Clock(), DEFAULT_POLICY)
    assert _now_action(warned).intent_id == SafeIntentId.TSUNAMI_EVACUATE_NOW
    assert _tick_plan_counts(warned) == [len(warned.plans)] * 6


def test_tsunami_trigger_with_arrival_inside_margin_does_not_replan_every_tick():
    before = base_state(NOW)
    warned = evaluate_and_replan(before, with_claim(tsunami_evidence(before, TsunamiWarningClass.WARNING, NOW + timedelta(minutes=2))), Clock(), DEFAULT_POLICY)
    assert _now_action(warned).intent_id == SafeIntentId.TSUNAMI_EVACUATE_NOW
    assert _tick_plan_counts(warned) == [len(warned.plans)] * 6


def test_tsunami_cancellation_after_ticks_still_replans():
    before = base_state(NOW)
    warned = evaluate_and_replan(before, with_claim(tsunami_evidence(before, TsunamiWarningClass.WARNING, None)), Clock(), DEFAULT_POLICY)
    later = replace(warned, current_time=NOW + timedelta(seconds=30))
    ticked = evaluate_and_replan(warned, later, Clock(), DEFAULT_POLICY)
    cancelled_state = replace(ticked, evidence=(), situation=ticked.situation.model_copy(update={"claim_states": ()}))
    cancelled = evaluate_and_replan(ticked, cancelled_state, Clock(), DEFAULT_POLICY)
    assert len(cancelled.plans) == len(ticked.plans) + 1
    assert _now_action(cancelled).intent_id != SafeIntentId.TSUNAMI_EVACUATE_NOW


def test_synthetic_official_trigger_is_blocked_not_substituted():
    from agent_api.distress import resolve_distress
    from seventytwoh_contracts.models import DistressLevel
    before = base_state(NOW)
    state = tsunami_evidence(before, TsunamiWarningClass.MAJOR_WARNING, NOW + timedelta(minutes=20))
    synthetic = state.evidence[-1].model_copy(update={"is_synthetic": True})
    state = with_claim(replace(state, evidence=(*state.evidence[:-1], synthetic)))
    status = resolve_distress(state, NOW, DEFAULT_POLICY)
    assert status.level == DistressLevel.OFFICIAL_TSUNAMI and status.synthetic is True
    planned = evaluate_and_replan(before, state, Clock(), DEFAULT_POLICY)
    action = _now_action(planned)
    assert action.intent_id == SafeIntentId.TSUNAMI_EVACUATE_NOW
    assert action.safety_decision == SafetyDecision.BLOCK


def test_trapped_level_one_asks_for_help_and_moves_up_only_if_water_rises():
    for language, needle in ((Language.TRADITIONAL_CHINESE, "求救"), (Language.JAPANESE, "助けを求め"), (Language.ENGLISH, "Call for help")):
        before = base_state(NOW)
        before = replace(before, profile=before.profile.model_copy(update={"preferred_language": language}))
        trapped = _now_action(evaluate_and_replan(before, record_distress_report(before, (DistressTag.TRAPPED,), "BUTTON", NOW), Clock(), DEFAULT_POLICY))
        assert trapped.intent_id == SafeIntentId.SHELTER_IN_PLACE_VERTICAL and needle in trapped.text
        plain = _now_action(evaluate_and_replan(before, record_distress_report(before, (DistressTag.WATER_RISING,), "BUTTON", NOW), Clock(), DEFAULT_POLICY))
        assert needle not in plain.text
