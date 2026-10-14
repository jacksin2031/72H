from __future__ import annotations

from fastapi.testclient import TestClient

from agent_api.drill import DrillRequest, compile_drill
from agent_api.drill_store import DrillStore
from agent_api.main import create_app
from agent_api.planner import PlannerOutcome
from agent_api.storage import ReplayStore


class RecordingPlanner:
    def __init__(self):
        self.contexts: list[dict] = []
    async def select(self, replay_id: str, context: dict):
        self.contexts.append(context)
        return PlannerOutcome(mode="GEMINI_ADK_FALLBACK", reason_code="TEST_PROVIDER_UNAVAILABLE")
    def release_session(self, replay_id: str):
        pass


def test_drill_is_disabled_by_default_and_cannot_access_replay(monkeypatch):
    monkeypatch.delenv("DRILL_ACCESS_KEY", raising=False)
    with TestClient(create_app(ReplayStore())) as client:
        response = client.post("/api/drill/start", json={"kind": "EARTHQUAKE"})
        assert response.status_code == 404
        normal = client.post("/api/replay/start")
        assert normal.status_code == 201


def test_exercise_requires_secret_and_rejects_unmodelled_hazards(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", "x" * 40)
    with TestClient(create_app(ReplayStore())) as client:
        assert client.post("/api/drill/start").status_code == 403
        assert client.post("/api/drill/start", headers={"X-Drill-Key": "bad"}, json={}).status_code == 403
        assert client.post("/api/drill/start", headers={"X-Drill-Key": "x" * 40}, json={"kind": "TSUNAMI"}).status_code == 422
        assert client.post("/api/drill/start", headers={"X-Drill-Key": "x" * 40}, json={"severity": 5}).status_code == 422
        assert client.post("/api/drill/start", headers={"X-Drill-Key": "x" * 40}, json={"raw_payload": {"claim": "approved"}}).status_code == 422


def test_dynamic_earthquake_scenario_preserves_allowlisted_typed_contract():
    request = DrillRequest(severity=3, network="RECONNECTING", evidence="STALE", mobility="CANNOT_MOVE", battery=3)
    scenario = compile_drill(request)
    assert scenario.mode == "SYNTHETIC_REPLAY"
    assert [event.event_type for event in scenario.events] == [
        "disaster_alert", "official_update", "transport_update", "network_lost", "network_restored",
    ]
    assert scenario.events[1].disaster_assessments[0].level == "L3"
    assert scenario.profile_seed.self_reported_safety_status == "NEEDS_ASSISTANCE"
    assert all(event.source_key in {"jma-replay", "transport-replay"} for event in scenario.events if hasattr(event, "source_key"))


def test_full_pipeline_calls_planner_with_fake_api_input_and_remains_isolated(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", "x" * 40)
    planner = RecordingPlanner()
    headers = {"X-Drill-Key": "x" * 40}
    with TestClient(create_app(store=ReplayStore(), drill_store=DrillStore(planner=planner))) as client:
        started = client.post("/api/drill/start", headers=headers,
                              json={"severity": 4, "battery": 3, "network": "OFFLINE", "evidence": "FRESH", "mobility": "CANNOT_MOVE"})
        assert started.status_code == 201, started.text
        snapshot = started.json()
        drill_id = snapshot["replay"]["id"]
        assert client.get(f"/api/replay/{drill_id}").status_code == 404
        assert client.get(f"/api/live/{drill_id}").status_code == 404
        for _ in snapshot["scenario_events"]:
            response = client.post(f"/api/drill/{drill_id}/next", headers=headers)
            assert response.status_code == 200, response.text
            snapshot = response.json()
        assert snapshot["replay"]["status"] == "COMPLETED"
        assert snapshot["situation"]["network_state"] in {"OFFLINE_RECENT", "OFFLINE_STALE"}
        assert planner.contexts == [], "Safety Core transitions must not invoke candidate planning"
        assert all(e["is_synthetic"] for e in snapshot["evidence"])
        assert all(not e["eligible_for_high_risk"] for e in snapshot["evidence"])
        assert all(not (a["risk_level"] == "HIGH" and a["safety_decision"] == "ALLOW") for a in snapshot["plan_actions"])
        assert any(e["event_type"] == "OFFLINE_MODE_ENTERED" for e in snapshot["trace"])
        assert snapshot["replay"]["planning_mode"] == "DETERMINISTIC_REPLAY_ONLY"
        assert client.get(f"/api/drill/{drill_id}", headers=headers).status_code == 200
        assert client.get(f"/api/drill/{drill_id}").status_code == 403


def test_unknown_evidence_does_not_forge_official_evidence(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", "y" * 40)
    with TestClient(create_app(drill_store=DrillStore(planner=RecordingPlanner()))) as client:
        response = client.post("/api/drill/start", headers={"X-Drill-Key": "y" * 40}, json={"evidence": "UNKNOWN"})
        assert response.status_code == 201
        state = response.json()
        for _ in state["scenario_events"]:
            state = client.post(f'/api/drill/{state["replay"]["id"]}/next', headers={"X-Drill-Key": "y" * 40}).json()
        assert all(not e["disaster_assessments"] for e in state["evidence"])
