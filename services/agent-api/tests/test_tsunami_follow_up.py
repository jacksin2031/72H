"""NEXT / AVOID follow the official tsunami level, in Live and replay alike (deterministic planning)."""
from dataclasses import replace
from datetime import timedelta

from agent_api.planning import evaluate_and_replan
from agent_api.safety import DEFAULT_POLICY, disaster_claim_key
from seventytwoh_contracts.models import (
    PlanActionCategory, RiskLevel, SafeIntentId, SafetyDecision, TsunamiWarningClass,
)
from tests.distress_fixtures import base_state, tsunami_evidence, with_claim
from tests.test_distress import NOW

Clock = type("Clock", (), {"id": "follow-up-test"})
FOLLOW_UP = {SafeIntentId.STAY_HIGH_UNTIL_OFFICIAL_CLEAR, SafeIntentId.AVOID_COAST_AND_RIVERS}


def _current(state, category):
    plan_id = state.situation.current_plan_id
    return next(a for a in state.plan_actions if a.plan_id == plan_id and a.category == category)


def test_official_tsunami_plan_has_tsunami_next_and_avoid_even_with_a_trip_context():
    before = base_state(NOW)
    assert before.profile.current_destination is not None  # the replay profile has a planned return trip
    warned = evaluate_and_replan(before, with_claim(tsunami_evidence(before, TsunamiWarningClass.MAJOR_WARNING, None)),
                                 Clock(), DEFAULT_POLICY)
    key = disaster_claim_key("JP-04", "TSUNAMI", "status")
    for category, intent in ((PlanActionCategory.NEXT, SafeIntentId.STAY_HIGH_UNTIL_OFFICIAL_CLEAR),
                             (PlanActionCategory.AVOID, SafeIntentId.AVOID_COAST_AND_RIVERS)):
        action = _current(warned, category)
        assert action.intent_id == intent
        assert action.risk_level == RiskLevel.LOW and action.safety_decision == SafetyDecision.ALLOW
        assert action.evidence_ids == ("ev_jma-tsunami-test",)
        assert action.dependency_values == {key: "ACTIVE"}
        assert "返程" not in action.text and "交通" not in action.text


def test_follow_up_returns_to_the_trip_template_when_the_warning_ends():
    before = base_state(NOW)
    warned = evaluate_and_replan(before, with_claim(tsunami_evidence(before, TsunamiWarningClass.WARNING, None)),
                                 Clock(), DEFAULT_POLICY)
    cleared_state = replace(warned, evidence=(), situation=warned.situation.model_copy(update={"claim_states": ()}))
    cleared = evaluate_and_replan(warned, cleared_state, Clock(), DEFAULT_POLICY)
    assert _current(cleared, PlanActionCategory.NEXT).intent_id not in FOLLOW_UP
    assert _current(cleared, PlanActionCategory.AVOID).intent_id not in FOLLOW_UP
    # History is preserved: the tsunami follow-up actions remain on the earlier plan version.
    assert any(a.intent_id in FOLLOW_UP and a.plan_id != cleared.situation.current_plan_id for a in cleared.plan_actions)


def test_expired_official_warning_keeps_tsunami_follow_up_without_current_evidence():
    before = base_state(NOW)
    warned = evaluate_and_replan(
        before,
        with_claim(tsunami_evidence(before, TsunamiWarningClass.MAJOR_WARNING, None, ttl=timedelta(minutes=10))),
        Clock(), DEFAULT_POLICY,
    )
    later = replace(warned, current_time=NOW + timedelta(minutes=11))
    expired = evaluate_and_replan(warned, later, Clock(), DEFAULT_POLICY)
    action = _current(expired, PlanActionCategory.NEXT)
    assert action.intent_id == SafeIntentId.STAY_HIGH_UNTIL_OFFICIAL_CLEAR
    assert action.evidence_ids == ()  # stale evidence is never cited as current support


def test_no_trip_context_never_shows_return_trip_text():
    before = base_state(NOW)
    no_trip = replace(before, profile=before.profile.model_copy(update={"current_destination": None}))
    from agent_api.distress import record_distress_report
    from seventytwoh_contracts.models import DistressTag
    planned = evaluate_and_replan(no_trip, record_distress_report(no_trip, (DistressTag.INJURED,), "BUTTON", NOW),
                                  Clock(), DEFAULT_POLICY)
    for category in (PlanActionCategory.NEXT, PlanActionCategory.AVOID):
        text = _current(planned, category).text
        for needle in ("返程", "交通", "帰路", "return", "transport"):
            assert needle not in text, (needle, text)
