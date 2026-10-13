"""C2: an official warning whose TTL expired degrades to OFFICIAL_STALE, never silently to NONE."""

import asyncio
from dataclasses import replace
from datetime import timedelta

from agent_api.distress import distress_signature, official_tsunami_trigger, resolve_distress
from agent_api.live_sources import JMA_TSUNAMI_SOURCE_KEY
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


# --- F1: a real JMA cancellation / withdrawal through the live conversion clears STALE ---

class _XmlTsunamiFeed:
    """Raw VTSE41 XML through the real JmaTsunamiSource parser and lifecycle state."""

    def __init__(self, start):
        from tests.test_live_sources import TSUNAMI_DETAIL_URL
        self.url = TSUNAMI_DETAIL_URL
        self.wall = [start]
        self.mono = [0.0]
        self.documents: list[tuple[str, bytes]] = []

    def publish(self, url, body):
        self.documents = [*self.documents, (url, body)]

    def fetch(self, url, headers):
        from agent_api.live_sources import JMA_FEED_URL, HttpPayload
        if url == JMA_FEED_URL:
            entries = "".join(
                f'<entry><title>津波警報・注意報・予報</title><updated>{self.wall[0].isoformat()}</updated>'
                f'<link type="application/xml" href="{item_url}"/></entry>'
                for item_url, _ in self.documents
            )
            return HttpPayload(200, f"<feed>{entries}</feed>".encode(), {})
        return HttpPayload(200, dict(self.documents)[url], {})

    def advance(self, delta):
        self.wall[0] += delta
        self.mono[0] += delta.total_seconds()


def _xml_bulletin(*, report_at, info_type="発表", event_id="20261006010000", areas=(("宮城県", "220", "53"),)):
    from tests.test_live_sources import _tsunami_detail
    body = _tsunami_detail(info_type=info_type, report_at=report_at.isoformat(),
                           origin="" if info_type == "取消" else "2026-10-06T00:58:00Z").decode()
    body = body.replace("<EventID>20261006010000</EventID>", f"<EventID>{event_id}</EventID>")
    if info_type != "取消":
        items = "".join(
            f"<Item><Area><Name>{name}</Name><Code>{code}</Code></Area>"
            f"<Category><Kind><Name>fixture warning</Name><Code>{kind}</Code></Kind></Category>"
            f"<FirstHeight><ArrivalTime>2026-10-06T01:20:00+09:00</ArrivalTime></FirstHeight>"
            f'<MaxHeight><jmx_eb:TsunamiHeight xmlns:jmx_eb="urn:jmaxml:element" unit="m" description="巨大">NaN</jmx_eb:TsunamiHeight></MaxHeight></Item>'
            for name, code, kind in areas
        )
        start, end = body.index("<Forecast>") + len("<Forecast>"), body.index("</Forecast>")
        body = body[:start] + items + body[end:]
    return body.encode()


def _live_stale_session():
    """Real live session: JMA MAJOR_WARNING for 宮城県, user-selected JP-04, then the JMA TTL passes."""
    from agent_api.live import LiveStore
    from agent_api.live_sources import JMA_EVIDENCE_TTL_SECONDS, JmaTsunamiSource
    from tests.test_live_tsunami import NOW as LIVE_NOW, _DestinationSource, _EarthquakeSource, _profile

    feed = _XmlTsunamiFeed(LIVE_NOW)
    feed.publish(feed.url, _xml_bulletin(report_at=LIVE_NOW))
    source = JmaTsunamiSource(feed.fetch, now=lambda: feed.wall[0], clock=lambda: feed.mono[0])
    store = LiveStore(jma_source=_EarthquakeSource(lambda: feed.wall[0]), tsunami_source=source,
                      destination_source=_DestinationSource(), now=lambda: feed.wall[0])
    sid = store.start({"language": "zh-TW", "profile": _profile()}).session_id
    selected = LiveLocationUpdateRequest(area_ids=("JP-04", "JP"), source=LocationSource.USER_SELECTED, observed_at=LIVE_NOW)
    assert asyncio.run(store.update_location(sid, selected)).distress.level == DistressLevel.OFFICIAL_TSUNAMI
    feed.advance(timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS + 60))
    assert store.refresh(sid).distress.level == DistressLevel.OFFICIAL_STALE
    return store, sid, feed


def _next_url(feed, n):
    return feed.url.replace("_010000.xml", f"_01{n:02d}00.xml")


def test_real_jma_cancellation_bulletin_clears_official_stale_to_none():
    store, sid, feed = _live_stale_session()
    feed.advance(timedelta(minutes=5))
    feed.publish(_next_url(feed, 1), _xml_bulletin(report_at=feed.wall[0], info_type="取消"))
    cancelled = store.refresh(sid)
    withdrawn = [a for e in cancelled.evidence if e.source_key == JMA_TSUNAMI_SOURCE_KEY
                 for a in e.disaster_assessments if a.area_id == "JP-04" and a.status == DisasterEventStatus.UNKNOWN]
    assert withdrawn and all(a.withdrawn for a in withdrawn)
    assert cancelled.distress.level == DistressLevel.NONE
    for minutes in (20, 120, 600):
        feed.advance(timedelta(minutes=minutes))
        assert store.refresh(sid).distress.level == DistressLevel.NONE


def test_newer_bulletin_that_omits_the_area_clears_official_stale_to_none():
    store, sid, feed = _live_stale_session()
    feed.advance(timedelta(minutes=5))
    feed.publish(_next_url(feed, 1), _xml_bulletin(report_at=feed.wall[0], areas=(("岩手県", "210", "51"),)))
    assert store.refresh(sid).distress.level == DistressLevel.NONE


def test_unrelated_unknown_does_not_clear_official_stale():
    # A different JMA event that only names another prefecture does not withdraw JP-04.
    store, sid, feed = _live_stale_session()
    feed.advance(timedelta(minutes=5))
    feed.publish(_next_url(feed, 1), _xml_bulletin(report_at=feed.wall[0], event_id="20261006020000",
                                                   areas=(("岩手県", "210", "51"),)))
    assert store.refresh(sid).distress.level == DistressLevel.OFFICIAL_STALE
    # The same event re-listing JP-04 with an unrecognised kind is UNKNOWN, not a cancellation.
    store, sid, feed = _live_stale_session()
    feed.advance(timedelta(minutes=5))
    feed.publish(_next_url(feed, 1), _xml_bulletin(report_at=feed.wall[0], areas=(("宮城県", "220", "99"),)))
    refreshed = store.refresh(sid)
    assert any(a.area_id == "JP-04" and a.status == DisasterEventStatus.UNKNOWN and not a.withdrawn
               for e in refreshed.evidence if e.source_key == JMA_TSUNAMI_SOURCE_KEY for a in e.disaster_assessments)
    assert refreshed.distress.level == DistressLevel.OFFICIAL_STALE


def test_plain_unknown_assessment_never_supersedes_but_withdrawn_unknown_does():
    base = _warned(source=LocationSource.USER_SELECTED)
    later = NOW + timedelta(minutes=10)
    unknown = tsunami_evidence(base, None, None, status=DisasterEventStatus.UNKNOWN,
                               evidence_id="ev_jma-tsunami-unknown", published_at=later, ttl=TTL)
    assert resolve_distress(unknown, NOW + timedelta(minutes=20), DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE
    last = unknown.evidence[-1]
    withdrawn = last.model_copy(update={"disaster_assessments": tuple(
        a.model_copy(update={"withdrawn": True}) for a in last.disaster_assessments)})
    state = replace(unknown, evidence=(*unknown.evidence[:-1], withdrawn))
    assert resolve_distress(state, NOW + timedelta(minutes=20), DEFAULT_POLICY).level == DistressLevel.NONE


# --- F2: CURRENT official evidence but a GPS fix older than 2 minutes -> OFFICIAL_STALE / LOCATION_STALE ---

def test_current_evidence_with_three_minute_old_gps_is_stale_location_not_none():
    at = NOW + timedelta(minutes=5)
    state = _gps_at(_warned(), at - timedelta(minutes=3))
    status = resolve_distress(state, at, DEFAULT_POLICY)
    assert status.level == DistressLevel.OFFICIAL_STALE
    assert status.stale_reason == "LOCATION_STALE"
    assert status.deadline_at is None  # never "go to a place"
    assert status.trigger_evidence_ids == ("ev_jma-tsunami-test",)
    assert status.warning_class == TsunamiWarningClass.MAJOR_WARNING
    assert status.last_official_at == NOW and status.trigger_expires_at == EXPIRES


def test_current_evidence_with_31_minute_old_gps_is_none():
    at = NOW + timedelta(minutes=10)
    state = _gps_at(_warned(), at - timedelta(minutes=31))
    status = resolve_distress(state, at, DEFAULT_POLICY)
    assert status.level == DistressLevel.NONE
    assert status.stale_reason is None


def test_stale_reason_is_evidence_expired_after_ttl_and_null_when_live():
    fresh = _gps_at(_warned(), NOW)
    assert resolve_distress(fresh, NOW + timedelta(minutes=1), DEFAULT_POLICY).stale_reason is None
    selected = _warned(source=LocationSource.USER_SELECTED)
    expired = resolve_distress(selected, EXPIRES + timedelta(minutes=1), DEFAULT_POLICY)
    assert (expired.level, expired.stale_reason) == (DistressLevel.OFFICIAL_STALE, "EVIDENCE_EXPIRED")


def test_location_stale_plan_is_low_risk_vertical_shelter():
    warned = evaluate_and_replan(base_state(NOW), _warned(), Clock(), DEFAULT_POLICY)
    assert _now_action(warned).intent_id == SafeIntentId.TSUNAMI_EVACUATE_NOW
    later = replace(warned, current_time=NOW + timedelta(minutes=3))
    stale = evaluate_and_replan(warned, later, Clock(), DEFAULT_POLICY)
    action = _now_action(stale)
    assert resolve_distress(stale, stale.current_time, DEFAULT_POLICY).stale_reason == "LOCATION_STALE"
    assert action.intent_id == SafeIntentId.SHELTER_IN_PLACE_VERTICAL
    assert action.risk_level == RiskLevel.LOW
    assert "位置" in action.reason or "location" in action.reason.casefold() or "位置情報" in action.reason


# --- F4: OFFICIAL_STALE / USER_REPORTED plans must not expire every 5 minutes ---

def _tick(state, until, step=timedelta(seconds=90)):
    while state.current_time + step <= until:
        state = evaluate_and_replan(state, replace(state, current_time=state.current_time + step), Clock(), DEFAULT_POLICY)
    return state


def test_three_hours_of_90s_ticks_at_official_stale_create_at_most_7_plan_versions():
    warned = evaluate_and_replan(base_state(NOW, source=LocationSource.USER_SELECTED),
                                 _warned(source=LocationSource.USER_SELECTED), Clock(), DEFAULT_POLICY)
    stale = evaluate_and_replan(warned, replace(warned, current_time=EXPIRES), Clock(), DEFAULT_POLICY)
    assert resolve_distress(stale, stale.current_time, DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE
    start = len(stale.plans)
    ticked = _tick(stale, EXPIRES + timedelta(hours=3))
    assert resolve_distress(ticked, ticked.current_time, DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE
    assert len(ticked.plans) - start + 1 <= 7
    current = ticked.plans[-1]
    assert current.expires_at - current.created_at <= timedelta(minutes=30)


def test_stale_plan_expiry_honours_the_30_minute_gps_horizon():
    at = EXPIRES + timedelta(minutes=1)
    state = _gps_at(_warned(), at - timedelta(minutes=20))
    planned = evaluate_and_replan(base_state(NOW), replace(state, current_time=at), Clock(), DEFAULT_POLICY)
    assert resolve_distress(planned, at, DEFAULT_POLICY).level == DistressLevel.OFFICIAL_STALE
    assert planned.plans[-1].expires_at == at - timedelta(minutes=20) + timedelta(minutes=30)


def test_user_reported_plan_expires_at_report_end_or_30_minutes_not_5():
    from agent_api.distress import record_distress_report
    from seventytwoh_contracts.models import DistressTag
    before = base_state(NOW, source=LocationSource.USER_SELECTED)
    reported = evaluate_and_replan(before, record_distress_report(before, (DistressTag.TRAPPED,), "BUTTON", NOW),
                                   Clock(), DEFAULT_POLICY)
    assert resolve_distress(reported, NOW, DEFAULT_POLICY).level == DistressLevel.USER_REPORTED
    assert reported.plans[-1].expires_at == NOW + timedelta(minutes=30)
    start = len(reported.plans)
    ticked = _tick(reported, NOW + timedelta(minutes=59))
    assert len(ticked.plans) - start <= 1
    water = evaluate_and_replan(before, record_distress_report(before, (DistressTag.WATER_RISING,), "BUTTON", NOW),
                                Clock(), DEFAULT_POLICY)
    assert water.plans[-1].expires_at == NOW + timedelta(seconds=DEFAULT_POLICY.user_report_ttl_seconds)
