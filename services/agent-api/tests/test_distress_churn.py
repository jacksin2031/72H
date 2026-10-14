"""C1: a same-area GPS refresh must not churn plan versions during an official tsunami trigger."""

import asyncio
from datetime import datetime, timedelta, timezone

from agent_api.mock_live import MockLiveDrillStore
from agent_api.planner import PlannerOutcome
from seventytwoh_contracts.models import DistressLevel, LiveLocationUpdateRequest, LocationSource
from tests.test_live_tsunami import NOW, _TsunamiSource, _profile, _store, _tsunami_result


def _gps(at, area_ids=("JP-04", "JP")):
    return LiveLocationUpdateRequest(area_ids=area_ids, source=LocationSource.GPS, observed_at=at)


def test_200_same_area_gps_refreshes_keep_plan_count_constant_under_official_tsunami():
    now = [NOW]
    store = _store(now, _TsunamiSource(_tsunami_result(NOW)))
    started = store.start({"language": "zh-TW", "profile": _profile()})
    sid = started.session_id

    now[0] = NOW + timedelta(seconds=1)
    first = asyncio.run(store.update_location(sid, _gps(now[0])))
    assert first.distress.level == DistressLevel.OFFICIAL_TSUNAMI
    plans, evaluations = len(first.plans), len(first.plan_evaluations)

    snapshot = first
    for step in range(2, 202):
        now[0] = NOW + timedelta(seconds=step)
        snapshot = asyncio.run(store.update_location(sid, _gps(now[0])))
    assert snapshot.distress.level == DistressLevel.OFFICIAL_TSUNAMI
    assert len(snapshot.plans) == plans
    assert len(snapshot.plan_evaluations) == evaluations
    # F3: a refresh that produces no plan evaluation replaces the previous
    # PROFILE_LOCATION_REFRESHED trace in place; at most one is added.
    assert len(snapshot.trace) <= len(first.trace) + 1
    assert snapshot.trace[-1].event_type == "PROFILE_LOCATION_REFRESHED"


def test_500_same_area_refreshes_keep_trace_bounded_and_endpoints_never_422_or_409():
    from fastapi.testclient import TestClient

    from agent_api.main import create_app

    now = [NOW]
    store = _store(now, _TsunamiSource(_tsunami_result(NOW)))
    client = TestClient(create_app(live_store=store))
    sid = client.post("/api/live/start", json={"language": "zh-TW", "profile": _profile()}).json()["session_id"]

    def refresh(step):
        now[0] = NOW + timedelta(milliseconds=200 * step)
        body = {"area_ids": ["JP-04", "JP"], "source": "GPS", "observed_at": now[0].isoformat()}
        return client.post(f"/api/live/{sid}/location", json=body)

    first = refresh(1)
    assert first.status_code == 200, first.text
    baseline = len(first.json()["trace"])
    for step in range(2, 502):
        response = refresh(step)
        assert response.status_code == 200, (step, response.text)
    snapshot = response.json()
    assert len(snapshot["trace"]) <= baseline + 1
    ids = [t["id"] for t in snapshot["trace"]]
    assert len(ids) == len(set(ids))
    assert snapshot["distress"]["level"] == "OFFICIAL_TSUNAMI"
    reported = client.post(f"/api/live/{sid}/distress", json={"tags": ["WATER_RISING"], "input_mode": "BUTTON"})
    assert reported.status_code == 200, reported.text


def test_refresh_that_changes_the_plan_still_appends_its_trace():
    now = [NOW]
    store = _store(now, _TsunamiSource(_tsunami_result(NOW)))
    sid = store.start({"language": "zh-TW", "profile": _profile()}).session_id
    now[0] = NOW + timedelta(seconds=1)
    first = asyncio.run(store.update_location(sid, _gps(now[0])))
    now[0] = NOW + timedelta(seconds=2)
    second = asyncio.run(store.update_location(sid, _gps(now[0])))
    assert second.trace[-1].event_type == "PROFILE_LOCATION_REFRESHED"
    # 3 minutes later the old fix lapses -> LOCATION_STALE; a fresh fix restores OFFICIAL_TSUNAMI (plan evaluation).
    now[0] = NOW + timedelta(minutes=3)
    stale = store.refresh(sid)
    assert stale.distress.level == DistressLevel.OFFICIAL_STALE
    restored = asyncio.run(store.update_location(sid, _gps(now[0])))
    assert restored.distress.level == DistressLevel.OFFICIAL_TSUNAMI
    assert len(restored.plan_evaluations) > len(stale.plan_evaluations)
    refreshed = [t for t in restored.trace[len(stale.trace):] if t.event_type == "PROFILE_LOCATION_REFRESHED"]
    assert len(refreshed) == 1


def test_area_change_still_invalidates_high_risk_actions():
    now = [NOW]
    store = _store(now, _TsunamiSource(_tsunami_result(NOW)))
    sid = store.start({"language": "zh-TW", "profile": _profile()}).session_id
    now[0] = NOW + timedelta(seconds=1)
    warned = asyncio.run(store.update_location(sid, _gps(now[0])))
    now[0] = NOW + timedelta(seconds=2)
    moved = asyncio.run(store.update_location(sid, _gps(now[0], ("JP-13", "JP"))))
    assert len(moved.plans) > len(warned.plans)
    assert moved.distress.level == DistressLevel.NONE


class _Fallback:
    async def select(self, session_id, context):
        return PlannerOutcome(mode="GEMINI_ADK_FALLBACK", reason_code="CHURN_TEST")

    def release_session(self, session_id):
        pass


def test_mock_live_same_area_refreshes_keep_plan_count_constant():
    """Mock-live: a synthetic official tsunami trigger yields a BLOCKED HIGH action; refreshes must not churn it."""
    from dataclasses import replace

    from agent_api.mock_live import MockLiveRequest
    from tests.distress_fixtures import tsunami_evidence, with_claim
    from seventytwoh_contracts.models import TsunamiWarningClass

    async def run():
        drills = MockLiveDrillStore(planner=_Fallback())
        started = await drills.start(MockLiveRequest(kind="EARTHQUAKE", severity=4))
        sid = started.snapshot.session_id
        await drills.next(sid)
        session = drills._lookup(sid)
        aggregate = session.store._get_aggregate(sid)
        state = tsunami_evidence(aggregate.state, TsunamiWarningClass.MAJOR_WARNING, None, area_id="JP-13")
        synthetic = state.evidence[-1].model_copy(update={"is_synthetic": True})
        aggregate.state = with_claim(replace(state, evidence=(*state.evidence[:-1], synthetic)))
        first = await session.store.update_location(sid, _gps(datetime.now(timezone.utc), ("JP-13", "JP")))
        plans = len(first.plans)
        snapshot = first
        for _ in range(200):
            await asyncio.sleep(0)
            snapshot = await session.store.update_location(
                sid, _gps(datetime.now(timezone.utc), ("JP-13", "JP")))
        return first, snapshot, plans

    first, snapshot, plans = asyncio.run(run())
    assert first.distress.level == DistressLevel.OFFICIAL_TSUNAMI and first.distress.synthetic
    current = [a for a in first.plan_actions if a.plan_id == first.situation.current_plan_id]
    assert any(a.risk_level == "HIGH" and a.safety_decision == "BLOCK" for a in current)
    assert snapshot.distress.level == DistressLevel.OFFICIAL_TSUNAMI
    assert len(snapshot.plans) == plans
