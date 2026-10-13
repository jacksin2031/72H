from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from agent_api.main import create_app
from agent_api.storage import ReplayStore


def test_replay_distress_report_creates_plan_and_trace():
    with TestClient(create_app(store=ReplayStore())) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        response = client.post(f"/api/replay/{replay_id}/distress", json={"tags": ["WATER_RISING"], "input_mode": "BUTTON"})
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["distress"]["level"] == "USER_REPORTED"
        assert data["distress"]["reports"][0]["source"] == "USER_REPORTED"
        assert any(t["event_type"] == "DISTRESS_REPORTED" for t in data["trace"])
        now = next(a for a in data["plan_actions"] if a["plan_id"] == data["situation"]["current_plan_id"] and a["category"] == "NOW")
        assert now["intent_id"] == "shelter_in_place_vertical"


def test_distress_rejects_unknown_tags_extra_fields_and_missing_sessions():
    with TestClient(create_app(store=ReplayStore())) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        assert client.post(f"/api/replay/{replay_id}/distress", json={"tags": ["SAFE_HERE"], "input_mode": "BUTTON"}).status_code == 422
        assert client.post(f"/api/replay/{replay_id}/distress", json={"tags": ["TRAPPED"], "input_mode": "BUTTON", "lat": 1}).status_code == 422
        assert client.post(f"/api/replay/{uuid4()}/distress", json={"tags": ["TRAPPED"], "input_mode": "BUTTON"}).status_code == 404
        assert client.post(f"/api/live/{uuid4()}/distress", json={"tags": ["TRAPPED"], "input_mode": "BUTTON"}).status_code == 404


def test_user_report_alone_never_creates_tsunami_evacuate_now():
    with TestClient(create_app(store=ReplayStore())) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        all_tags = ["WATER_RISING", "TRAPPED", "INJURED", "MOBILITY_LIMITED", "WITH_DEPENDENTS", "LOST_NO_DESTINATION", "ROUTE_BLOCKED_REPORTED"]
        data = client.post(f"/api/replay/{replay_id}/distress", json={"tags": all_tags, "input_mode": "TEXT"}).json()
        assert data["distress"]["level"] == "USER_REPORTED"
        assert all(a["intent_id"] != "tsunami_evacuate_now" for a in data["plan_actions"])


def test_mock_live_and_live_distress(monkeypatch):
    from agent_api.mock_live import MockLiveDrillStore
    from agent_api.planner import PlannerOutcome

    class Fallback:
        async def select(self, session_id, context):
            return PlannerOutcome(mode="GEMINI_ADK_FALLBACK", reason_code="DISTRESS_TEST_FALLBACK")

        def release_session(self, session_id):
            pass

    key = "this-is-a-test-only-distress-drill-key-with-adequate-length"
    monkeypatch.setenv("DRILL_ACCESS_KEY", key)
    headers = {"X-Drill-Key": key}
    body = {"tags": ["TRAPPED"], "input_mode": "BUTTON"}
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=Fallback()))) as client:
        started = client.post("/api/mock-live/start", json={}, headers=headers)
        assert started.status_code == 201, started.text
        sid = started.json()["snapshot"]["session_id"]
        assert client.post(f"/api/mock-live/{sid}/distress", json=body).status_code in {401, 403}
        response = client.post(f"/api/mock-live/{sid}/distress", json=body, headers=headers)
        assert response.status_code == 200, response.text
        snapshot = response.json()["snapshot"]
        assert snapshot["distress"]["level"] == "USER_REPORTED"
        assert any(t["event_type"] == "DISTRESS_REPORTED" for t in snapshot["trace"])
        assert client.post(f"/api/mock-live/{uuid4()}/distress", json=body, headers=headers).status_code == 404


BODY = {"tags": ["WATER_RISING"], "input_mode": "BUTTON"}


def _live_client():
    from test_live_location import _store_and_client, _start

    store, client = _store_and_client()
    sid = _start(client)["session_id"]
    return store, client, sid


def _live_aggregate(store, sid):
    return store._get_aggregate(__import__("uuid").UUID(sid))


def test_live_distress_success_preserves_plan_history():
    store, client, sid = _live_client()
    before = client.get(f"/api/live/{sid}").json()
    response = client.post(f"/api/live/{sid}/distress", json=BODY)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["distress"]["level"] == "USER_REPORTED"
    assert sum(t["event_type"] == "DISTRESS_REPORTED" for t in data["trace"]) == 1
    assert data["situation"]["current_plan_id"] != before["situation"]["current_plan_id"]
    assert {p["id"] for p in before["plans"]} <= {p["id"] for p in data["plans"]}
    assert all(a["intent_id"] != "tsunami_evacuate_now" for a in data["plan_actions"])


def test_live_distress_applies_report_once_when_state_changes_during_replan(monkeypatch):
    import agent_api.live as live_module

    store, client, sid = _live_client()
    aggregate = _live_aggregate(store, sid)
    original = live_module.replan_live_transition

    def racing(before, after, *args, **kwargs):
        result = original(before, after, *args, **kwargs)
        # A concurrent writer replaces the aggregate state while we were planning.
        aggregate.state = replace(aggregate.state, current_time=aggregate.state.current_time + timedelta(seconds=5))
        return result

    monkeypatch.setattr(live_module, "replan_live_transition", racing)
    response = client.post(f"/api/live/{sid}/distress", json=BODY)
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(aggregate.state.distress_reports) == 1
    assert sum(t["event_type"] == "DISTRESS_REPORTED" for t in data["trace"]) == 1
    assert data["distress"]["level"] == "USER_REPORTED"


def test_live_distress_trace_capacity_maps_to_409():
    import agent_api.live as live_module

    store, client, sid = _live_client()
    monkeypatch_cap = live_module.MAX_LIVE_TRACE_EVENTS
    aggregate = _live_aggregate(store, sid)
    live_module.MAX_LIVE_TRACE_EVENTS = len(aggregate.state.trace) + 8
    try:
        response = client.post(f"/api/live/{sid}/distress", json=BODY)
    finally:
        live_module.MAX_LIVE_TRACE_EVENTS = monkeypatch_cap
    assert response.status_code == 409, response.text
    assert len(aggregate.state.distress_reports) == 0


def _fill_replay_trace(store, replay_id, remaining):
    """Pad a replay aggregate's trace so only `remaining` slots are left below MAX_TRACE."""
    from uuid import UUID

    from agent_api.domain import MAX_TRACE

    from seventytwoh_contracts.models import AgentName, TraceEvent, TraceStatus

    aggregate = store._get_aggregate(UUID(replay_id))
    state = aggregate.state
    padding = tuple(
        TraceEvent(id=f"trace_{len(state.trace) + i + 1:03d}", situation_id=state.situation.id,
                   timestamp=state.current_time, agent=AgentName.SAFETY_CORE, event_type="TEST_PADDING",
                   status=TraceStatus.SUCCESS, public_summary="test padding")
        for i in range(MAX_TRACE - remaining - len(state.trace))
    )
    aggregate.state = replace(state, trace=(*state.trace, *padding))
    return aggregate


def test_replay_distress_and_advice_trace_capacity_map_to_409():
    from test_distress_advice import ADVICE_BODY, _advisor

    store = ReplayStore()
    advisor, _ = _advisor({"suggest_sos": True})
    with TestClient(create_app(store=store, distress_advisor=advisor)) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        aggregate = _fill_replay_trace(store, replay_id, 8)
        before = aggregate.state
        assert client.post(f"/api/replay/{replay_id}/distress", json=BODY).status_code == 409
        assert client.post(f"/api/replay/{replay_id}/distress/advice", json=ADVICE_BODY).status_code == 409
        assert aggregate.state.distress_reports == before.distress_reports
        assert len(aggregate.state.trace) == len(before.trace)
        assert client.get(f"/api/replay/{replay_id}").status_code == 200


def _disabled_advisor():
    # Never reach a real model in tests: an explicitly disabled advisor always degrades.
    from agent_api.distress_advice import DistressAdvisor
    from agent_api.planner import PlannerConfig

    return DistressAdvisor(PlannerConfig(mode="deterministic"))


def test_fallback_advice_writes_no_trace_even_at_capacity():
    from test_distress_advice import ADVICE_BODY

    store = ReplayStore()
    with TestClient(create_app(store=store, distress_advisor=_disabled_advisor())) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        before = len(client.get(f"/api/replay/{replay_id}").json()["trace"])
        response = client.post(f"/api/replay/{replay_id}/distress/advice", json=ADVICE_BODY)
        assert response.status_code == 200, response.text
        assert response.json()["advice"]["mode"] == "DETERMINISTIC_FALLBACK"
        assert len(response.json()["snapshot"]["trace"]) == before
        _fill_replay_trace(store, replay_id, 8)
        assert client.post(f"/api/replay/{replay_id}/distress/advice", json=ADVICE_BODY).status_code == 200


def test_live_fallback_advice_writes_no_trace():
    from test_distress_advice import ADVICE_BODY

    from test_live_location import _store_and_client, _start

    store, _ = _store_and_client()
    client = TestClient(create_app(live_store=store, distress_advisor=_disabled_advisor()))
    sid = _start(client)["session_id"]
    before = len(client.get(f"/api/live/{sid}").json()["trace"])
    response = client.post(f"/api/live/{sid}/distress/advice", json=ADVICE_BODY)
    assert response.status_code == 200, response.text
    assert response.json()["advice"]["mode"] == "DETERMINISTIC_FALLBACK"
    assert len(response.json()["snapshot"]["trace"]) == before
