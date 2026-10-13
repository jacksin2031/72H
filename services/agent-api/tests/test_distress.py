from datetime import datetime, timedelta, timezone

from agent_api.distress import (
    active_distress_reports, distress_signature, official_tsunami_trigger,
    record_ai_escalation, record_distress_report, resolve_distress,
)
from agent_api.safety import DEFAULT_POLICY
from seventytwoh_contracts.models import (
    ClaimStateStatus, DistressLevel, DistressTag, FreshnessStatus, LocationSource,
    TrustStatus, TsunamiWarningClass,
)
from tests.distress_fixtures import base_state, tsunami_evidence, with_claim

NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


def test_no_reports_and_no_warning_is_level_none():
    assert resolve_distress(base_state(NOW), NOW, DEFAULT_POLICY).level == DistressLevel.NONE


def test_user_report_raises_to_user_reported_and_expires_after_ttl():
    state = record_distress_report(base_state(NOW), (DistressTag.WATER_RISING,), "BUTTON", NOW)
    assert resolve_distress(state, NOW, DEFAULT_POLICY).level == DistressLevel.USER_REPORTED
    later = NOW + timedelta(seconds=DEFAULT_POLICY.user_report_ttl_seconds)
    assert active_distress_reports(state, later, DEFAULT_POLICY) == ()
    assert resolve_distress(state, later, DEFAULT_POLICY).level == DistressLevel.NONE


def test_official_major_warning_for_user_area_triggers_with_margin_deadline():
    arrival = NOW + timedelta(minutes=20)
    state = with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.MAJOR_WARNING, arrival))
    trigger = official_tsunami_trigger(state, NOW, DEFAULT_POLICY)
    assert trigger is not None
    assert trigger.deadline_at == arrival - timedelta(seconds=300)
    status = resolve_distress(state, NOW, DEFAULT_POLICY)
    assert status.level == DistressLevel.OFFICIAL_TSUNAMI
    assert status.trigger_evidence_ids == (trigger.evidence_id,)


def test_unknown_or_past_arrival_gives_zero_available_time():
    state = with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.WARNING, None))
    assert official_tsunami_trigger(state, NOW, DEFAULT_POLICY).deadline_at == NOW
    past = with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.WARNING, NOW - timedelta(minutes=1)))
    assert official_tsunami_trigger(past, NOW, DEFAULT_POLICY).deadline_at == NOW


def test_advisory_stale_conflict_unverified_or_other_area_never_trigger():
    arrival = NOW + timedelta(minutes=20)
    assert official_tsunami_trigger(with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.ADVISORY, arrival)), NOW, DEFAULT_POLICY) is None
    assert official_tsunami_trigger(with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.MAJOR_WARNING, arrival, freshness=FreshnessStatus.STALE)), NOW, DEFAULT_POLICY) is None
    assert official_tsunami_trigger(with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.MAJOR_WARNING, arrival), status=ClaimStateStatus.CONFLICT), NOW, DEFAULT_POLICY) is None
    assert official_tsunami_trigger(with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.MAJOR_WARNING, arrival, trust=TrustStatus.UNVERIFIED)), NOW, DEFAULT_POLICY) is None
    assert official_tsunami_trigger(with_claim(tsunami_evidence(base_state(NOW), TsunamiWarningClass.MAJOR_WARNING, arrival, area_id="JP-13")), NOW, DEFAULT_POLICY) is None


def test_stale_gps_location_cannot_trigger_but_user_selected_area_can():
    arrival = NOW + timedelta(minutes=20)
    state = with_claim(tsunami_evidence(base_state(NOW, gps_observed_at=NOW - timedelta(minutes=10)), TsunamiWarningClass.WARNING, arrival))
    assert official_tsunami_trigger(state, NOW, DEFAULT_POLICY) is None
    selected = with_claim(tsunami_evidence(base_state(NOW, source=LocationSource.USER_SELECTED), TsunamiWarningClass.WARNING, arrival))
    assert official_tsunami_trigger(selected, NOW, DEFAULT_POLICY) is not None


def test_ai_escalation_only_raises_none_to_user_reported_and_expires():
    state = record_ai_escalation(base_state(NOW), NOW)
    status = resolve_distress(state, NOW, DEFAULT_POLICY)
    assert status.level == DistressLevel.USER_REPORTED and status.ai_escalated is True
    later = NOW + timedelta(seconds=DEFAULT_POLICY.user_report_ttl_seconds)
    assert resolve_distress(state, later, DEFAULT_POLICY).level == DistressLevel.NONE


def test_signature_changes_when_level_changes_over_time():
    state = record_distress_report(base_state(NOW), (DistressTag.TRAPPED,), "BUTTON", NOW)
    later = NOW + timedelta(seconds=DEFAULT_POLICY.user_report_ttl_seconds)
    assert distress_signature(state, NOW, DEFAULT_POLICY) != distress_signature(state, later, DEFAULT_POLICY)


def test_report_history_is_bounded_and_preserved_in_order():
    state = base_state(NOW)
    for minute in range(20):
        state = record_distress_report(state, (DistressTag.INJURED,), "BUTTON", NOW + timedelta(minutes=minute))
    assert len(state.distress_reports) == 16
    assert state.distress_reports[-1].reported_at == NOW + timedelta(minutes=19)
