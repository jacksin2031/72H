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
