from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from agent_api.live import LiveStore
from agent_api.domain import parse_replay_event
from agent_api.live_sources import (
    JMA_EVIDENCE_TTL_SECONDS,
    JMA_SOURCE_NAME,
    JMA_TSUNAMI_SOURCE_KEY,
    JMA_TSUNAMI_SOURCE_NAME,
    JmaEarthquakeReport,
    JmaFetchResult,
    JmaPrefObservation,
    JmaTsunamiArea,
    JmaTsunamiBulletin,
    JmaTsunamiFetchResult,
    TOKYO_SHELTER_SOURCE_KEY,
    TOKYO_SHELTER_SOURCE_NAME,
    TOKYO_SHELTER_URL,
    tsunami_reference_from_result,
)
from agent_api.main import create_app
from seventytwoh_contracts.models import (
    AgentName,
    DisasterEventStatus,
    DisasterEventType,
    LiveSourceStatus,
    NetworkState,
    TsunamiAreaStatus,
    TsunamiHeightExpression,
    TsunamiMaxHeight,
    TsunamiOperation,
    TsunamiReferenceForecastArea,
    TsunamiReferenceResponse,
    TsunamiWarningClass,
    TraceEvent,
    TraceStatus,
)

NOW = datetime(2026, 10, 6, 1, 0, tzinfo=timezone.utc)


class _EarthquakeSource:
    def __init__(self, now):
        self.now = now
        self.report = JmaEarthquakeReport(
            report_id="quake-only-fixture",
            title="JMA earthquake test report",
            published_at=NOW - timedelta(seconds=5),
            occurred_at=NOW - timedelta(seconds=10),
            reference_url="https://www.data.jma.go.jp/developer/xml/data/quake-fixture.xml",
            observations=(JmaPrefObservation(code="04", name="宮城県", max_intensity="3"),),
        )

    def fetch_latest(self):
        return JmaFetchResult(
            status=LiveSourceStatus.FRESH,
            retrieved_at=self.now(),
            last_published_at=self.report.published_at,
            next_retry_at=None,
            reports=(self.report,),
            detail="test fixture; not a live source",
        )


class _TsunamiSource:
    def __init__(self, result):
        self.result = result
        self.calls = 0

    def fetch_latest(self):
        self.calls += 1
        return self.result


class _DestinationSource:
    def fetch_latest(self):
        return LiveSourceStatus.UNSUPPORTED, (), None, None


def _tsunami_result(now, *, operation=TsunamiOperation.ISSUE, serial="1", status=TsunamiAreaStatus.ACTIVE):
    published = now - timedelta(seconds=5)
    warning = TsunamiWarningClass.MAJOR_WARNING if status == TsunamiAreaStatus.ACTIVE else TsunamiWarningClass.NONE
    area = JmaTsunamiArea(
        code="220",
        name="宮城県",
        status=status,
        warning_class=warning,
        max_height=TsunamiMaxHeight(expression=TsunamiHeightExpression.HUGE, description="巨大"),
        arrival_at=now + timedelta(minutes=10) if status == TsunamiAreaStatus.ACTIVE else None,
    )
    bulletin = JmaTsunamiBulletin(
        event_id="20261006010000",
        serial=serial,
        info_type={
            TsunamiOperation.ISSUE: "発表",
            TsunamiOperation.UPDATE: "発表",
            TsunamiOperation.CORRECTION: "訂正",
            # These fixtures model official area warning解除, not withdrawal of
            # an erroneous information unit (InfoType取消).
            TsunamiOperation.CANCEL: "発表",
            TsunamiOperation.UNKNOWN: "発表",
        }[operation],
        operation=operation,
        published_at=published,
        occurred_at=NOW - timedelta(minutes=2),
        reference_url=f"https://www.data.jma.go.jp/developer/xml/data/tsunami-{serial}.xml",
        forecast_areas=(area,),
    )
    public_area = TsunamiReferenceForecastArea(
        area_code=area.code,
        area_name=area.name,
        status=area.status,
        warning_class=area.warning_class,
        max_height=area.max_height,
        arrival_at=area.arrival_at,
    )
    return JmaTsunamiFetchResult(
        status=LiveSourceStatus.FRESH,
        retrieved_at=now,
        last_published_at=published,
        next_retry_at=None,
        operation=operation,
        serial=serial,
        bulletins=(bulletin,),
        forecast_areas=(public_area,),
        conflict=False,
        detail="test fixture; not a live source",
    )


def _empty_tsunami_result(now):
    return JmaTsunamiFetchResult(
        status=LiveSourceStatus.UNSUPPORTED,
        retrieved_at=now,
        last_published_at=None,
        next_retry_at=None,
        operation=TsunamiOperation.UNKNOWN,
        serial=None,
        bulletins=(),
        forecast_areas=(),
        conflict=False,
        detail="no tsunami bulletin in the test fixture",
    )


def _profile():
    return {
        "current_location": {"label": "石巻市", "area_ids": ["JP-04", "JP"]},
        "accommodation_location": {"label": "石巻市", "area_ids": ["JP-04", "JP"]},
    }


def _store(now, tsunami_source):
    return LiveStore(
        jma_source=_EarthquakeSource(lambda: now[0]),
        tsunami_source=tsunami_source,
        destination_source=_DestinationSource(),
        now=lambda: now[0],
    )


def _begin_reconnect(store, snapshot, reconnect_at):
    session = store._get_aggregate(snapshot.session_id)
    prior = session.state
    reconnect_trace = TraceEvent(
        id=f"trace_{len(prior.trace) + 1:03d}",
        situation_id=prior.situation.id,
        timestamp=reconnect_at,
        agent=AgentName.SYNC_ENGINE,
        event_type="NETWORK_RESTORED",
        input_refs=(),
        output_refs=(),
        status=TraceStatus.SUCCESS,
        public_summary="Connectivity was restored; current official evidence is still required.",
    )
    session.state = replace(
        prior,
        current_time=reconnect_at,
        situation=prior.situation.model_copy(
            update={"network_state": NetworkState.RECONNECTING, "updated_at": reconnect_at}
        ),
        reconnect_evidence_count=len(prior.evidence),
        last_reconnect_at=reconnect_at,
        trace=(*prior.trace, reconnect_trace),
    )


def test_empty_tsunami_poll_and_reference_get_do_not_mutate_an_earthquake_only_plan():
    now = [NOW]
    tsunami = _TsunamiSource(_empty_tsunami_result(NOW))
    store = _store(now, tsunami)
    snapshot = store.start({"language": "zh-TW", "profile": _profile()})
    before = store.get(snapshot.session_id)
    assert {event.event_type for event in before.events} == {DisasterEventType.EARTHQUAKE}
    assert before.plans
    assert all(action.intent_id is None or action.intent_id.value != "evacuate_to_designated_shelter" for action in before.plan_actions)

    client = TestClient(create_app(live_store=store))
    response = client.get("/api/reference/tsunami")
    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "LIVE_REFERENCE"
    assert response.json()["event_type"] == "TSUNAMI"
    assert response.json()["status"] == "UNKNOWN"
    assert response.json()["safety_authority"] == "NONE"
    after_reference = store.get(snapshot.session_id)
    assert after_reference.events == before.events
    assert after_reference.plans == before.plans
    assert after_reference.plan_evaluations == before.plan_evaluations

    store.refresh(snapshot.session_id)
    after_empty_poll = store.get(snapshot.session_id)
    assert after_empty_poll.events == before.events
    assert after_empty_poll.plans == before.plans
    assert after_empty_poll.plan_evaluations == before.plan_evaluations
    assert tsunami.calls >= 2
    assert all(event.source_name != JMA_TSUNAMI_SOURCE_NAME for event in after_empty_poll.events)


def test_injected_earthquake_source_never_constructs_default_live_tsunami_adapter(monkeypatch):
    import agent_api.live as live_module

    def unexpected_live_adapter():
        raise AssertionError("synthetic-source test attempted to construct real JMA tsunami adapter")

    monkeypatch.setattr(live_module, "JmaTsunamiSource", unexpected_live_adapter)
    store = LiveStore(
        jma_source=_EarthquakeSource(lambda: NOW),
        destination_source=_DestinationSource(),
        now=lambda: NOW,
    )
    snapshot = store.start({"language": "zh-TW", "profile": _profile()})
    assert snapshot.situation.network_state == NetworkState.ONLINE_VERIFIED
    reference = store.get_tsunami_reference()
    assert reference.status.value == "UNKNOWN"
    assert reference.source_status.value == "UNKNOWN"


@pytest.mark.parametrize("top_status", ["CANCELLED", "UNKNOWN"])
def test_tsunami_reference_rejects_non_active_top_status_with_active_area(top_status):
    response = tsunami_reference_from_result(_tsunami_result(NOW))
    payload = response.model_dump(mode="json")
    payload["status"] = top_status

    with pytest.raises(ValidationError, match="non-active tsunami reference"):
        TsunamiReferenceResponse.model_validate(payload)


def test_legacy_earthquake_replay_alert_still_parses_but_tsunami_cannot_use_l0_l4():
    legacy_earthquake = parse_replay_event({
        "id": "legacy-earthquake-alert",
        "event_type": "disaster_alert",
        "source_key": "jma-replay",
        "disaster_type": "EARTHQUAKE",
        "occurred_at": NOW,
        "offset_seconds": 0,
        "label": "legacy earthquake alert",
        "affected_areas": ["東京"],
        "affected_area_ids": ["JP-13"],
        "severity_raw": "L3",
        "summary": "Existing earthquake replay fixture.",
    })
    assert legacy_earthquake.disaster_type == DisasterEventType.EARTHQUAKE
    assert legacy_earthquake.severity_raw == "L3"
    invalid_tsunami = {
        **legacy_earthquake.model_dump(mode="json"),
        "id": "invalid-tsunami-level",
        "disaster_type": "TSUNAMI",
    }
    try:
        parse_replay_event(invalid_tsunami)
    except ValueError as exc:
        assert "earthquake L0-L4" in str(exc)
    else:
        raise AssertionError("tsunami replay accepted an earthquake-only L0-L4 level")


def test_live_tsunami_update_uses_existing_dependency_evaluation_and_cancel_retires_its_event():
    now = [NOW]
    tsunami = _TsunamiSource(_empty_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    original_plan_ids = tuple(plan.id for plan in started.plans)
    assert started.source.status == LiveSourceStatus.FRESH
    assert started.plans and started.events[0].event_type == DisasterEventType.EARTHQUAKE

    now[0] = NOW + timedelta(seconds=10)
    tsunami.result = _tsunami_result(now[0])
    issued = store.refresh(started.session_id)
    tsunami_events = [event for event in issued.events if event.event_type == DisasterEventType.TSUNAMI]
    assert len(tsunami_events) == 1
    assert tsunami_events[0].status == DisasterEventStatus.ACTIVE
    assert any(event.event_type == DisasterEventType.EARTHQUAKE for event in issued.events)
    tsunami_evidence = next(item for item in issued.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assert all(item.level is None for item in tsunami_evidence.disaster_assessments)
    assert tsunami_evidence.disaster_assessments[0].event_type == DisasterEventType.TSUNAMI
    assert any(item.status.value in {"PARTIAL_INVALIDATION", "INVALIDATED"} for item in issued.plan_evaluations)
    assert tuple(plan.id for plan in issued.plans) != original_plan_ids
    assert len(issued.plans) >= len(original_plan_ids) + 1  # append-only plan history
    assert all(
        action.intent_id is None or action.intent_id.value != "evacuate_to_designated_shelter"
        for action in issued.plan_actions
        if action.plan_id == issued.situation.current_plan_id
    )

    old_tsunami_id = tsunami_events[0].id
    now[0] = NOW + timedelta(seconds=30)
    tsunami.result = _tsunami_result(now[0], operation=TsunamiOperation.CORRECTION, serial="2")
    corrected = store.refresh(started.session_id)
    current_tsunami_events = [event for event in corrected.events if event.event_type == DisasterEventType.TSUNAMI]
    assert len(current_tsunami_events) == 2
    assert next(item for item in current_tsunami_events if item.id == old_tsunami_id).status == DisasterEventStatus.UNKNOWN
    assert next(item for item in current_tsunami_events if item.id != old_tsunami_id).status == DisasterEventStatus.ACTIVE
    assert len(corrected.plans) >= len(issued.plans)

    now[0] = NOW + timedelta(seconds=60)
    tsunami.result = _tsunami_result(now[0], operation=TsunamiOperation.CANCEL, serial="3", status=TsunamiAreaStatus.CANCELLED)
    cancelled = store.refresh(started.session_id)
    latest_tsunami = max(
        (item for item in cancelled.events if item.event_type == DisasterEventType.TSUNAMI),
        key=lambda item: item.received_at,
    )
    assert latest_tsunami.status == DisasterEventStatus.RESOLVED
    assert all(item not in cancelled.situation.active_event_ids for item in (
        event.id for event in cancelled.events if event.event_type == DisasterEventType.TSUNAMI
    ))
    latest_tsunami_evidence = max(
        (item for item in cancelled.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY),
        key=lambda item: item.published_at,
    )
    assert latest_tsunami_evidence.disaster_assessments[0].status == DisasterEventStatus.RESOLVED
    assert latest_tsunami_evidence.disaster_assessments[0].level is None
    assert JMA_SOURCE_NAME != JMA_TSUNAMI_SOURCE_NAME
    assert any(item.status.value in {"PARTIAL_INVALIDATION", "INVALIDATED"} for item in cancelled.plan_evaluations)


def test_stale_or_unavailable_tsunami_after_an_active_bulletin_marks_evidence_unknown_and_degrades():
    now = [NOW]
    tsunami = _TsunamiSource(_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    assert any(event.event_type == DisasterEventType.TSUNAMI for event in started.events)

    now[0] += timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
    tsunami.result = _empty_tsunami_result(now[0]).__class__(
        status=LiveSourceStatus.BACKOFF,
        retrieved_at=NOW,
        last_published_at=NOW - timedelta(seconds=5),
        next_retry_at=now[0] + timedelta(seconds=5),
        operation=TsunamiOperation.ISSUE,
        serial="1",
        bulletins=_tsunami_result(NOW).bulletins,
        forecast_areas=tuple(
            item.model_copy(update={"status": TsunamiAreaStatus.UNKNOWN})
            for item in _tsunami_result(NOW).forecast_areas
        ),
        conflict=False,
        detail="test fixture source failure",
    )
    degraded = store.refresh(started.session_id)
    assert degraded.situation.network_state.value == "ONLINE_DEGRADED"
    assert any(event.status == DisasterEventStatus.UNKNOWN for event in degraded.events if event.event_type == DisasterEventType.TSUNAMI)
    tsunami_evidence = next(item for item in degraded.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assert tsunami_evidence.freshness_status.value == "STALE"
    assert tsunami_evidence.trust_status.value == "STALE"
    assert all(item.status.value == "UNKNOWN" for item in degraded.situation.claim_states if item.key.startswith("disaster.TSUNAMI."))


def test_conflicting_tsunami_source_marks_only_tsunami_claims_unknown_and_degrades_active_session():
    now = [NOW]
    tsunami = _TsunamiSource(_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    tsunami.result = replace(_tsunami_result(NOW + timedelta(seconds=10)), conflict=True)
    now[0] += timedelta(seconds=10)

    conflicted = store.refresh(started.session_id)
    tsunami_evidence = next(item for item in conflicted.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assert tsunami_evidence.conflict is True
    assert tsunami_evidence.trust_status.value == "CONFLICTING"
    assert conflicted.situation.network_state == NetworkState.ONLINE_DEGRADED
    assert all(
        item.status.value == "UNKNOWN"
        for item in conflicted.situation.claim_states
        if item.key.startswith("disaster.TSUNAMI.")
    )
    assert any(
        item.status.value == "VERIFIED" and item.key.startswith("disaster.EARTHQUAKE.")
        for item in conflicted.situation.claim_states
    )


def test_reconnect_requires_post_restore_tsunami_publication_before_online_verified():
    now = [NOW]
    tsunami = _TsunamiSource(_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    session = store._get_aggregate(started.session_id)
    reconnect_at = NOW + timedelta(seconds=20)
    prior = session.state
    reconnect_trace = TraceEvent(
        id=f"trace_{len(prior.trace) + 1:03d}",
        situation_id=prior.situation.id,
        timestamp=reconnect_at,
        agent=AgentName.SYNC_ENGINE,
        event_type="NETWORK_RESTORED",
        input_refs=(),
        output_refs=(),
        status=TraceStatus.SUCCESS,
        public_summary="Connectivity was restored; current official evidence is still required.",
    )
    session.state = replace(
        prior,
        current_time=reconnect_at,
        situation=prior.situation.model_copy(
            update={"network_state": NetworkState.RECONNECTING, "updated_at": reconnect_at}
        ),
        reconnect_evidence_count=len(prior.evidence),
        last_reconnect_at=reconnect_at,
        trace=(*prior.trace, reconnect_trace),
    )
    now[0] = reconnect_at

    still_waiting = store.refresh(started.session_id)
    assert still_waiting.situation.network_state == NetworkState.RECONNECTING
    assert not any(
        item.source_key == JMA_TSUNAMI_SOURCE_KEY and item.published_at >= reconnect_at
        for item in still_waiting.evidence
    )

    # A new post-restore earthquake report is not a substitute for a tsunami
    # publication while a tsunami event remains active.
    now[0] = NOW + timedelta(seconds=30)
    store._jma.report = replace(
        store._jma.report,
        report_id="quake-post-restore-1",
        published_at=NOW + timedelta(seconds=25),
        occurred_at=NOW + timedelta(seconds=24),
    )
    earthquake_only = store.refresh(started.session_id)
    assert earthquake_only.situation.network_state == NetworkState.RECONNECTING
    assert any(
        item.source_key == "jma-live-eqvol" and item.published_at >= reconnect_at
        for item in earthquake_only.evidence
    )
    assert not any(
        item.source_key == JMA_TSUNAMI_SOURCE_KEY and item.published_at >= reconnect_at
        for item in earthquake_only.evidence
    )

    now[0] = NOW + timedelta(seconds=40)
    tsunami.result = _tsunami_result(
        now[0], operation=TsunamiOperation.UPDATE, serial="2"
    )
    restored = store.refresh(started.session_id)
    post_restore = [
        item for item in restored.evidence
        if item.source_key == JMA_TSUNAMI_SOURCE_KEY and item.published_at >= reconnect_at
    ]
    assert post_restore
    assert restored.situation.network_state == NetworkState.ONLINE_VERIFIED
    assert any(item.event_type == "RECONCILIATION_COMPLETED" for item in restored.trace)


def test_verified_tsunami_cancellation_resolves_hazard_and_can_complete_reconnect():
    now = [NOW]
    tsunami = _TsunamiSource(_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    session = store._get_aggregate(started.session_id)
    reconnect_at = NOW + timedelta(seconds=20)
    prior = session.state
    reconnect_trace = TraceEvent(
        id=f"trace_{len(prior.trace) + 1:03d}",
        situation_id=prior.situation.id,
        timestamp=reconnect_at,
        agent=AgentName.SYNC_ENGINE,
        event_type="NETWORK_RESTORED",
        input_refs=(),
        output_refs=(),
        status=TraceStatus.SUCCESS,
        public_summary="Connectivity was restored; current official evidence is still required.",
    )
    session.state = replace(
        prior,
        current_time=reconnect_at,
        situation=prior.situation.model_copy(
            update={"network_state": NetworkState.RECONNECTING, "updated_at": reconnect_at}
        ),
        reconnect_evidence_count=len(prior.evidence),
        last_reconnect_at=reconnect_at,
        trace=(*prior.trace, reconnect_trace),
    )

    now[0] = NOW + timedelta(seconds=35)
    store._jma.report = replace(
        store._jma.report,
        report_id="quake-post-restore-before-tsunami-cancel",
        published_at=NOW + timedelta(seconds=30),
        occurred_at=NOW + timedelta(seconds=29),
    )
    tsunami.result = _tsunami_result(
        now[0], operation=TsunamiOperation.CANCEL, serial="2", status=TsunamiAreaStatus.CANCELLED
    )
    restored = store.refresh(started.session_id)

    assert restored.situation.network_state == NetworkState.ONLINE_VERIFIED
    assert not any(
        event.id in restored.situation.active_event_ids
        for event in restored.events
        if event.event_type == DisasterEventType.TSUNAMI
        and event.status in {DisasterEventStatus.ACTIVE, DisasterEventStatus.UNKNOWN}
    )
    cancellation = max(
        (
            item for item in restored.evidence
            if item.source_key == JMA_TSUNAMI_SOURCE_KEY and item.published_at >= reconnect_at
        ),
        key=lambda item: item.published_at,
    )
    assert cancellation.disaster_assessments[0].status == DisasterEventStatus.RESOLVED
    reconciliation = next(item for item in restored.trace if item.event_type == "RECONCILIATION_COMPLETED")
    assert {item.source_key for item in restored.evidence if item.id in reconciliation.output_refs} == {
        "jma-live-eqvol", JMA_TSUNAMI_SOURCE_KEY
    }


def test_distinct_tsunami_event_ids_in_the_same_area_remain_active_together():
    now = [NOW]
    tsunami = _TsunamiSource(_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    before = [
        event for event in started.events
        if event.event_type == DisasterEventType.TSUNAMI and event.status == DisasterEventStatus.ACTIVE
    ]
    assert len(before) == 1

    now[0] += timedelta(seconds=30)
    newer = _tsunami_result(now[0], operation=TsunamiOperation.ISSUE, serial="1")
    distinct_bulletin = replace(
        newer.bulletins[0],
        event_id="20261006010100",
        published_at=now[0] - timedelta(seconds=5),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/20261006010100_VTSE41_010000.xml",
    )
    tsunami.result = replace(newer, bulletins=(distinct_bulletin,))
    after = store.refresh(started.session_id)

    active_tsunami = [
        event for event in after.events
        if event.event_type == DisasterEventType.TSUNAMI and event.status == DisasterEventStatus.ACTIVE
    ]
    assert len(active_tsunami) == 2
    assert {event.id for event in active_tsunami}.issubset(set(after.situation.active_event_ids))


def test_reconnect_requires_each_active_tsunami_event_group_and_cancel_cannot_clear_other_group():
    now = [NOW]
    initial = _tsunami_result(NOW)
    second = replace(
        initial.bulletins[0],
        event_id="20261006010100",
        published_at=NOW - timedelta(seconds=4),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/20261006010100_VTSE41_010000.xml",
    )
    tsunami = _TsunamiSource(replace(initial, bulletins=(*initial.bulletins, second)))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    active_before = [
        item for item in started.events
        if item.event_type == DisasterEventType.TSUNAMI
        and item.id in started.situation.active_event_ids
    ]
    assert len(active_before) == 2
    group_a = next(
        item.id.partition("--")[0]
        for item in active_before
        if item.raw_reference == initial.bulletins[0].reference_url
    )
    group_b = next(item.id.partition("--")[0] for item in active_before if item.id.partition("--")[0] != group_a)
    reconnect_at = NOW + timedelta(seconds=20)
    _begin_reconnect(store, started, reconnect_at)
    now[0] = NOW + timedelta(seconds=30)

    # Only A is cancelled after restore; a new earthquake report must not
    # satisfy the missing post-restore proof for still-active group B.
    store._jma.report = replace(
        store._jma.report,
        report_id="quake-post-restore-with-tsunami-group-b-still-active",
        published_at=NOW + timedelta(seconds=25),
        occurred_at=NOW + timedelta(seconds=24),
    )
    tsunami.result = _tsunami_result(
        now[0], operation=TsunamiOperation.CANCEL, serial="2", status=TsunamiAreaStatus.CANCELLED
    )
    partial = store.refresh(started.session_id)

    assert partial.situation.network_state == NetworkState.RECONNECTING
    assert store._get_aggregate(started.session_id).state.reconnect_evidence_count == len(started.evidence)
    still_active = [
        item for item in partial.events
        if item.event_type == DisasterEventType.TSUNAMI
        and item.id in partial.situation.active_event_ids
    ]
    assert len(still_active) == 1
    assert still_active[0].id.partition("--")[0] == group_b
    assert group_a != group_b
    area_claim = next(
        item for item in partial.situation.claim_states
        if item.key == "disaster.TSUNAMI.JP-04.status"
    )
    assert area_claim.status.value == "VERIFIED"
    assert area_claim.value == DisasterEventStatus.ACTIVE.value
    assert area_claim.evidence_ids == (f"ev_{still_active[0].id}",)
    assert not any(item.event_type == "RECONCILIATION_COMPLETED" for item in partial.trace)


def test_reconnect_conflict_does_not_clear_barrier_until_fresh_publication_for_active_group():
    now = [NOW]
    tsunami = _TsunamiSource(_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    reconnect_at = NOW + timedelta(seconds=20)
    _begin_reconnect(store, started, reconnect_at)

    now[0] = NOW + timedelta(seconds=25)
    old_bulletin_result = replace(_tsunami_result(NOW), retrieved_at=now[0], conflict=True)
    tsunami.result = old_bulletin_result
    conflicted = store.refresh(started.session_id)
    assert conflicted.situation.network_state == NetworkState.RECONNECTING
    assert store._get_aggregate(started.session_id).state.reconnect_evidence_count == len(started.evidence)
    assert any(item.conflict for item in conflicted.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assert not any(item.event_type == "RECONCILIATION_COMPLETED" for item in conflicted.trace)

    # Clearing the source conflict flag while only re-fetching the old
    # publication is not new official evidence and cannot release the barrier.
    now[0] = NOW + timedelta(seconds=35)
    tsunami.result = replace(_tsunami_result(NOW), retrieved_at=now[0], conflict=False)
    still_waiting = store.refresh(started.session_id)
    assert still_waiting.situation.network_state == NetworkState.RECONNECTING
    assert store._get_aggregate(started.session_id).state.reconnect_evidence_count == len(started.evidence)
    assert any(item.conflict for item in still_waiting.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assert not any(item.event_type == "RECONCILIATION_COMPLETED" for item in still_waiting.trace)

    # A new publication for the same EventID group plus new EQ evidence is the
    # only step that supplies the missing current-source proofs.
    now[0] = NOW + timedelta(seconds=50)
    store._jma.report = replace(
        store._jma.report,
        report_id="quake-post-conflict-reconciliation",
        published_at=NOW + timedelta(seconds=45),
        occurred_at=NOW + timedelta(seconds=44),
    )
    tsunami.result = _tsunami_result(
        now[0], operation=TsunamiOperation.UPDATE, serial="2"
    )
    restored = store.refresh(started.session_id)
    assert restored.situation.network_state == NetworkState.ONLINE_VERIFIED
    assert store._get_aggregate(started.session_id).state.reconnect_evidence_count is None
    assert len([item for item in restored.trace if item.event_type == "RECONCILIATION_COMPLETED"]) == 1


def _multi_area_result(now, areas, *, info_type="発表", operation=TsunamiOperation.ISSUE):
    published = now - timedelta(seconds=5)
    forecast_areas = tuple(
        JmaTsunamiArea(
            code="220",
            name=name,
            status=TsunamiAreaStatus.ACTIVE,
            warning_class=warning,
            max_height=TsunamiMaxHeight(expression=TsunamiHeightExpression.HUGE, description="巨大"),
            arrival_at=arrival,
        )
        for name, warning, arrival in areas
    )
    bulletin = JmaTsunamiBulletin(
        event_id="20261006010000",
        serial="1",
        info_type=info_type,
        operation=operation,
        published_at=published,
        occurred_at=NOW - timedelta(minutes=2),
        reference_url="https://www.data.jma.go.jp/developer/xml/data/tsunami-1.xml",
        forecast_areas=forecast_areas,
    )
    return JmaTsunamiFetchResult(
        status=LiveSourceStatus.FRESH,
        retrieved_at=now,
        last_published_at=published,
        next_retry_at=None,
        operation=operation,
        serial="1",
        bulletins=(bulletin,),
        forecast_areas=(),
        conflict=False,
        detail="test fixture; not a live source",
    )


def _refresh_with(result_factory):
    now = [NOW]
    tsunami = _TsunamiSource(_empty_tsunami_result(NOW))
    store = _store(now, tsunami)
    started = store.start({"language": "zh-TW", "profile": _profile()})
    now[0] = NOW + timedelta(seconds=10)
    tsunami.result = result_factory(now[0])
    return store.refresh(started.session_id)


def test_tsunami_assessment_keeps_strongest_class_and_earliest_arrival():
    early = NOW + timedelta(minutes=20)
    late = NOW + timedelta(minutes=30)
    state = _refresh_with(lambda t: _multi_area_result(t, [
        ("宮城県", TsunamiWarningClass.WARNING, late),
        ("宮城県", TsunamiWarningClass.MAJOR_WARNING, early),
    ]))
    evidence = next(item for item in state.evidence if item.source_key == JMA_TSUNAMI_SOURCE_KEY)
    assessment = next(a for a in evidence.disaster_assessments if a.area_id == "JP-04")
    assert assessment.tsunami_warning_class == TsunamiWarningClass.MAJOR_WARNING
    assert assessment.arrival_at == early


def test_cancelled_bulletin_clears_warning_class():
    state = _refresh_with(lambda t: _multi_area_result(
        t,
        [("宮城県", TsunamiWarningClass.NONE, None)],
        info_type="取消",
        operation=TsunamiOperation.CANCEL,
    ))
    checked = 0
    for evidence in state.evidence:
        if evidence.source_key != JMA_TSUNAMI_SOURCE_KEY:
            continue
        for assessment in evidence.disaster_assessments:
            checked += 1
            assert assessment.tsunami_warning_class in (None, TsunamiWarningClass.NONE)
            assert assessment.arrival_at is None
    assert checked
