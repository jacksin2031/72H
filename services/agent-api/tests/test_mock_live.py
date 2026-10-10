from fastapi.testclient import TestClient
from agent_api.main import create_app
from agent_api.mock_live import MockLiveDrillStore
from agent_api.planner import PlannerOutcome


class RecordingPlanner:
    def __init__(self):
        self.contexts = []
    async def select(self, session_id, context):
        self.contexts.append(context)
        return PlannerOutcome(mode="GEMINI_ADK_FALLBACK", reason_code="MOCK_PROVIDER")
    def release_session(self, session_id):
        pass


KEY = "mock-live-test-secret-key-at-least-32"
HEADERS = {"X-Drill-Key": KEY}


def test_mock_live_disabled_without_key_and_unknown_type_rejected(monkeypatch):
    monkeypatch.delenv("DRILL_ACCESS_KEY", raising=False)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=RecordingPlanner()))) as client:
        assert client.post("/api/mock-live/start", json={}).status_code == 404
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=RecordingPlanner()))) as client:
        assert client.post("/api/mock-live/start", json={}).status_code == 403
        assert client.post("/api/mock-live/start", json={"kind": "TSUNAMI"}, headers=HEADERS).status_code == 422
        assert client.post("/api/mock-live/start", json={"severity": 7}, headers=HEADERS).status_code == 422
        assert client.post("/api/mock-live/start", json={"source_url": "https://evil.example"}, headers=HEADERS).status_code == 422


def test_mock_live_feed_enters_actual_live_pipeline_and_isolated(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    planner = RecordingPlanner()
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=planner))) as client:
        r = client.post("/api/mock-live/start", headers=HEADERS, json={
            "kind": "EARTHQUAKE", "severity": 4, "battery": 5,
            "network": "ONLINE", "evidence": "FRESH", "mobility": "CANNOT_MOVE"
        })
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["mode"] == "MOCK_LIVE" and data["snapshot"]["mode"] == "LIVE"
        sid = data["snapshot"]["session_id"]
        assert client.get(f"/api/live/{sid}").status_code == 404
        assert client.get(f"/api/replay/{sid}").status_code == 404
        assert data["snapshot"]["events"] == []
        assert data["current_step"] == 0
        for step in (1, 2):
            r = client.post(f"/api/mock-live/{sid}/next", headers=HEADERS)
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["current_step"] == step
            assert data["snapshot"]["source"]["source_name"].startswith("SIMULATED")
            assert not data["snapshot"]["spatial_guidance"]["movement_authorized"]
            assert data["snapshot"]["destinations"] == []
            assert data["snapshot"]["routes"] == []
            assert all(item["is_synthetic"] for item in data["snapshot"]["events"])
            assert all(item["is_synthetic"] and not item["eligible_for_high_risk"] for item in data["snapshot"]["evidence"])
            assert all(not (action["risk_level"]=="HIGH" and action["safety_decision"]=="ALLOW") for action in data["snapshot"]["plan_actions"])
        assert planner.contexts, "real Live candidate planning boundary must run"
        assert planner.contexts[-1]["exercise_conditions"]["battery_percent"] == 5
        assert client.post(f"/api/mock-live/{sid}/next", headers=HEADERS).status_code == 409
        assert client.get(f"/api/mock-live/{sid}").status_code == 403


def test_offline_and_reconnect_stay_synthetic(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=RecordingPlanner()))) as client:
        for network in ("OFFLINE", "RECONNECTING"):
            started = client.post("/api/mock-live/start", headers=HEADERS, json={"network": network}).json()
            sid=started["snapshot"]["session_id"]
            for stage in range(started["total_steps"]):
                r=client.post(f"/api/mock-live/{sid}/next", headers=HEADERS)
                assert r.status_code==200, r.text
                snap=r.json()
                assert not snap["snapshot"]["spatial_guidance"]["movement_authorized"]
            assert snap["mode"]=="MOCK_LIVE"


def test_unknown_source_never_forges_verified_evidence(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=RecordingPlanner()))) as client:
        start=client.post("/api/mock-live/start", headers=HEADERS, json={"evidence":"UNKNOWN"}).json()
        sid=start["snapshot"]["session_id"]
        for _ in range(start["total_steps"]):
            state=client.post(f"/api/mock-live/{sid}/next", headers=HEADERS).json()
        assert state["snapshot"]["evidence"] == []


def test_mock_adapter_never_uses_real_provider_classes(monkeypatch):
    def denied(*args, **kwargs):
        raise AssertionError("real external source invoked")
    from agent_api import live_sources
    monkeypatch.setattr(live_sources, "_http_get", denied)
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=RecordingPlanner()))) as client:
        start=client.post("/api/mock-live/start",headers=HEADERS, json={"severity":2})
        assert start.status_code==201
        sid=start.json()["snapshot"]["session_id"]
        assert client.post(f"/api/mock-live/{sid}/next", headers=HEADERS).status_code==200
