"""C2: an official warning whose TTL expired degrades to OFFICIAL_STALE, never silently to NONE."""

import asyncio
from dataclasses import replace
from datetime import timedelta

from agent_api.distress import distress_signature, official_tsunami_trigger, resolve_distress
from agent_api.planning import evaluate_and_replan
from agent_api.safety import DEFAULT_POLICY
from seventytwoh_contracts.models import (
    DisasterEventStatus, DistressLevel, FreshnessStatus, LiveLocationUpdateRequest, LocationSource,
    PlanActionCategory, RiskLevel, SafeIntentId, SafetyDecision, TrustStatus, TsunamiWarningClass,
)
from tests.distress_fixtures import base_state, tsunami_evidence, with_claim
from tests.test_distress import NOW

TTL = timedelta(minutes=15)
EXPIRES = NOW + TTL
Clock = type("Clock", (), {"id": "stale-test"})


def _warned(warning=TsunamiWarningClass.MAJOR_WARNING, **kwargs):
    return with_claim(tsunami_evidence(base_state(NOW, **kwargs), warning, NOW + timedelta(minutes=40), ttl=TTL))


def _gps_at(state, observed_at):
    location = state.profile.current_location.model_copy(update={"observed_at": observed_at})
    return replace(state, profile=state.profile.model_copy(update={"current_location": location}))


def _cancelled(state, at):
    cancelled = tsunami_evidence(state, TsunamiWarningClass.NONE, None, status=DisasterEventStatus.RESOLVED,
                                 evidence_id="ev_jma-tsunami-cancel", published_at=at, ttl=TTL)
    return cancelled


def test_now_equal_expires_at_is_the_stale_boundary():
    state = _gps_at(_warned(), EXPIRES - timedelta(minutes=1))
    just_before = EXPIRES - timedelta(microseconds=1)
    live = resolve_distress(state, just_before, DEFAULT_POLICY)
    assert live.level == DistressLevel.OFFICIAL_TSUNAMI
    assert live.trigger_expires_at == EXPIRES
    assert live.last_official_at == NOW
    assert live.warning_class == TsunamiWarningClass.MAJOR_WARNING
    assert official_tsunami_trigger(state, EXPIRES, DEFAULT_POLICY) is None
    stale = resolve_distress(state, EXPIRES, DEFAULT_POLICY)
    assert stale.level == DistressLevel.OFFICIAL_STALE
    assert stale.trigger_evidence_ids == ("ev_jma-tsunami-test",)
    assert stale.deadline_at is None
    assert stale.last_official_at == NOW
    assert stale.trigger_expires_at == EXPIRES
    assert stale.warning_class == TsunamiWarningClass.MAJOR_WARNING


def test_stale_evidence_marked_stale_by_the_source_still_degrades_to_official_stale():
    state = with_claim(tsunami_evidence(base_state(NOW, source=LocationSource.USER_SELECTED), TsunamiWarningClass.WARNING,
                                        None, ttl=TTL, freshness=FreshnessStatus.STALE, trust=TrustStatus.STALE))
    assert resolve_distress(state, NOW + timedelta(minutes=16), DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE


def test_stale_check_accepts_gps_up_to_30_minutes_old_or_user_selected():
    at = EXPIRES + timedelta(minutes=1)
    assert resolve_distress(_gps_at(_warned(), at - timedelta(minutes=30)), at, DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE
    assert resolve_distress(_gps_at(_warned(), at - timedelta(minutes=31)), at, DEFAULT_POLICY).level == DistressLevel.NONE
    selected = _warned(source=LocationSource.USER_SELECTED)
    assert resolve_distress(selected, NOW + timedelta(hours=5), DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE


def test_newer_cancellation_supersedes_an_older_warning_to_none_not_stale():
    state = _cancelled(_warned(source=LocationSource.USER_SELECTED), NOW + timedelta(minutes=10))
    assert resolve_distress(state, NOW + timedelta(minutes=20), DEFAULT_POLICY).level == DistressLevel.NONE
    # Also after the cancellation's own TTL: an expired cancellation still supersedes.
    assert resolve_distress(state, NOW + timedelta(hours=2), DEFAULT_POLICY).level == DistressLevel.NONE


def test_older_cancellation_does_not_hide_a_newer_warning():
    base = base_state(NOW, source=LocationSource.USER_SELECTED)
    cancelled = tsunami_evidence(base, TsunamiWarningClass.NONE, None, status=DisasterEventStatus.RESOLVED,
                                 evidence_id="ev_jma-tsunami-cancel", published_at=NOW - timedelta(minutes=30), ttl=TTL)
    state = with_claim(tsunami_evidence(cancelled, TsunamiWarningClass.WARNING, None, ttl=TTL))
    assert resolve_distress(state, NOW + timedelta(minutes=20), DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE


def test_advisory_or_other_area_or_unverified_never_becomes_stale():
    at = NOW + timedelta(minutes=20)
    selected = base_state(NOW, source=LocationSource.USER_SELECTED)
    advisory = with_claim(tsunami_evidence(selected, TsunamiWarningClass.ADVISORY, None, ttl=TTL))
    other = with_claim(tsunami_evidence(selected, TsunamiWarningClass.WARNING, None, ttl=TTL, area_id="JP-13"))
    unverified = with_claim(tsunami_evidence(selected, TsunamiWarningClass.WARNING, None, ttl=TTL, trust=TrustStatus.UNVERIFIED))
    for state in (advisory, other, unverified):
        assert resolve_distress(state, at, DEFAULT_POLICY).level == DistressLevel.NONE


def test_official_stale_plans_low_risk_vertical_shelter_and_stale_to_none_on_cancel():
    before = _warned(source=LocationSource.USER_SELECTED)
    warned = evaluate_and_replan(base_state(NOW, source=LocationSource.USER_SELECTED), before, Clock(), DEFAULT_POLICY)
    now_action = _now_action(warned)
    assert now_action.intent_id == SafeIntentId.TSUNAMI_EVACUATE_NOW

    later = replace(warned, current_time=EXPIRES + timedelta(minutes=1))
    stale = evaluate_and_replan(warned, later, Clock(), DEFAULT_POLICY)
    action = _now_action(stale)
    assert resolve_distress(stale, stale.current_time, DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE
    assert action.intent_id == SafeIntentId.SHELTER_IN_PLACE_VERTICAL
    assert action.risk_level == RiskLevel.LOW
    assert action.safety_decision == SafetyDecision.ALLOW
    assert len(stale.plans) == len(warned.plans) + 1
    # Stable: further ticks (inside the plan's own expiry) do not churn plan versions.
    ticked = evaluate_and_replan(stale, replace(stale, current_time=stale.current_time + timedelta(minutes=1)), Clock(), DEFAULT_POLICY)
    assert len(ticked.plans) == len(stale.plans)

    cancelled_state = _cancelled(ticked, ticked.current_time)
    cancelled = evaluate_and_replan(ticked, cancelled_state, Clock(), DEFAULT_POLICY)
    assert resolve_distress(cancelled, cancelled.current_time, DEFAULT_POLICY).level == DistressLevel.NONE
    assert _now_action(cancelled).intent_id != SafeIntentId.SHELTER_IN_PLACE_VERTICAL
    assert len(cancelled.plans) == len(ticked.plans) + 1


def test_signature_distinguishes_stale_from_live_and_none():
    state = _warned(source=LocationSource.USER_SELECTED)
    live = distress_signature(state, NOW, DEFAULT_POLICY)
    stale = distress_signature(state, EXPIRES, DEFAULT_POLICY)
    assert live != stale
    assert stale == distress_signature(state, EXPIRES + timedelta(minutes=10), DEFAULT_POLICY)


def _now_action(state):
    plan_id = state.situation.current_plan_id
    return next(a for a in state.plan_actions if a.plan_id == plan_id and a.category == PlanActionCategory.NOW)


def test_live_warning_degrades_to_official_stale_after_jma_ttl_instead_of_none():
    from agent_api.live_sources import JMA_EVIDENCE_TTL_SECONDS
    from tests.test_live_tsunami import NOW as LIVE_NOW, _TsunamiSource, _profile, _store, _tsunami_result

    now = [LIVE_NOW]
    store = _store(now, _TsunamiSource(_tsunami_result(LIVE_NOW)))
    sid = store.start({"language": "zh-TW", "profile": _profile()}).session_id
    selected = LiveLocationUpdateRequest(area_ids=("JP-04", "JP"), source=LocationSource.USER_SELECTED, observed_at=LIVE_NOW)
    warned = asyncio.run(store.update_location(sid, selected))
    assert warned.distress.level == DistressLevel.OFFICIAL_TSUNAMI
    assert warned.distress.warning_class == TsunamiWarningClass.MAJOR_WARNING
    assert warned.distress.last_official_at is not None and warned.distress.trigger_expires_at is not None

    now[0] = LIVE_NOW + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS - 60)
    assert store.refresh(sid).distress.level == DistressLevel.OFFICIAL_TSUNAMI
    now[0] = LIVE_NOW + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS + 60)
    stale = store.refresh(sid)
    assert stale.distress.level == DistressLevel.OFFICIAL_STALE
    assert stale.distress.last_official_at == warned.distress.last_official_at
    current = [a for a in stale.plan_actions if a.plan_id == stale.situation.current_plan_id and a.category == "NOW"]
    assert current[0].intent_id == SafeIntentId.SHELTER_IN_PLACE_VERTICAL
