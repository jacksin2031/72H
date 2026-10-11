from __future__ import annotations
from fastapi.testclient import TestClient
from agent_api.main import create_app
from agent_api.mock_live import MockLiveDrillStore
from agent_api.planner import PlannerOutcome

KEY="historic-window-secure-test-key-01234567890"
HEADERS={"X-Drill-Key":KEY}

class CheapPlanner:
    async def select(self,session_id,context):
        return PlannerOutcome(mode="GEMINI_ADK_FALLBACK",reason_code="TEST_WINDOW")
    def release_session(self,session_id): pass

def app():
    return create_app(mock_live_store=MockLiveDrillStore(planner=CheapPlanner()))

def test_historical_time_window_runs_only_requested_311_events(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY",KEY)
    with TestClient(app()) as client:
        r=client.post("/api/mock-live/start",headers=HEADERS,json={
            "historical_case":"tohoku-2011",
            "historical_start_jst":"2011-03-11T14:46:00+09:00",
            "historical_end_jst":"2011-03-11T15:00:00+09:00",
        })
        assert r.status_code==201,r.text
        state=r.json()
        assert state["total_steps"]==2
        assert [x["kind"] for x in state["historical"]["milestones"]]==["EARTHQUAKE","TSUNAMI_WARNING"]
        sid=state["snapshot"]["session_id"]
        for _ in range(2):
            response=client.post(f"/api/mock-live/{sid}/next",headers=HEADERS)
            assert response.status_code==200,response.text
            state=response.json()
        assert state["current_step"]==2
        assert state["historical"]["current_milestone"]["at_jst"]=="2011-03-11T14:49:00+09:00"
        assert state["historical"]["current_milestone"]["fed_to_safety_core"] is False
        assert len(state["snapshot"]["events"])==1
        assert all(x["is_synthetic"] for x in state["snapshot"]["evidence"])
        assert not state["snapshot"]["spatial_guidance"]["movement_authorized"]
        assert client.post(f"/api/mock-live/{sid}/next",headers=HEADERS).status_code==409

def test_historical_range_can_start_midstream_without_prior_quake(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY",KEY)
    with TestClient(app()) as client:
        response=client.post("/api/mock-live/start",headers=HEADERS,json={
            "historical_case":"tohoku-2011",
            "historical_start_jst":"2011-03-11T14:49:00+09:00",
            "historical_end_jst":"2011-03-11T14:49:00+09:00",
        })
        assert response.status_code==201,response.text
        info=response.json()
        assert info["total_steps"]==1
        snap=client.post(f"/api/mock-live/{info['snapshot']['session_id']}/next",headers=HEADERS).json()
        assert snap["snapshot"]["events"]==[]
        assert snap["historical"]["current_milestone"]["kind"]=="TSUNAMI_WARNING"

def test_rejects_invalid_ranges_or_no_historical_cases(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY",KEY)
    valid={"historical_case":"tohoku-2011",
        "historical_start_jst":"2011-03-11T14:46:00+09:00",
        "historical_end_jst":"2011-03-11T15:15:00+09:00"}
    invalid=[
        {**valid, "historical_start_jst":"2011-03-11T14:46:00"},
        {**valid, "historical_end_jst":"2011-03-11T15:15:00+00:00"},
        {**valid, "historical_start_jst":"2011-03-11T15:15:00+09:00", "historical_end_jst":"2011-03-11T14:46:00+09:00"},
        {**valid, "historical_start_jst":"2011-03-11T14:45:00+09:00"},
        {**valid, "historical_end_jst":"2011-03-11T15:16:00+09:00"},
        {**valid, "historical_start_jst":"2011-03-11T14:50:00+09:00","historical_end_jst":"2011-03-11T14:51:00+09:00"},
        {**valid, "historical_case":None},
        {**valid, "historical_end_jst":None},
    ]
    with TestClient(app()) as client:
        for item in invalid:
            response=client.post("/api/mock-live/start",headers=HEADERS,json=item)
            assert response.status_code==422,(item,response.text)
