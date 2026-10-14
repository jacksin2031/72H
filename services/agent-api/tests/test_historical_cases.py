from __future__ import annotations
from fastapi.testclient import TestClient
from agent_api.main import create_app
from agent_api.mock_live import MockLiveDrillStore
from agent_api.planner import PlannerOutcome
from agent_api.historical_cases import CASES


class Fallback:
    def __init__(self):
        self.contexts=[]
    async def select(self, session_id, context):
        self.contexts.append(context)
        return PlannerOutcome(mode="GEMINI_ADK_FALLBACK", reason_code="HISTORICAL_TEST_FALLBACK")
    def release_session(self, session_id):
        pass


KEY="this-is-a-test-only-historical-drill-key-with-adequate-length"
HEADERS={"X-Drill-Key":KEY}


def test_curated_historical_catalog_factual_anchors(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY",KEY)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=Fallback()))) as client:
        data=client.get("/api/mock-live/cases").json()
        assert len(data)==5
        assert all(item["source_url"].startswith("https://") for item in data)
        assert [e["at_jst"] for e in data[0]["milestones"]]==[
            "2011-03-11T14:46:00+09:00","2011-03-11T14:49:00+09:00",
            "2011-03-11T15:14:00+09:00","2011-03-11T15:15:00+09:00"]
        assert data[0]["magnitude"]=="9.0"
        assert data[0]["area_id"]=="JP-04"
        assert data[3]["milestones"][1]["at_jst"]=="2018-09-06T03:25:00+09:00"
        assert data[1]["milestones"][1]["historic_observation"] is False


def test_historical_runs_use_live_adapter_feed_tsunami_and_keep_power_outage_background(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY",KEY)
    planner=Fallback()
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=planner))) as client:
        for case_id,case in CASES.items():
            response=client.post("/api/mock-live/start",json={"historical_case":case_id},headers=HEADERS)
            assert response.status_code==201,response.text
            data=response.json()
            sid=data["snapshot"]["session_id"]
            assert data["historical"]["case_id"]==case_id
            assert data["total_steps"]==len(case.milestones)
            assert client.get(f"/api/live/{sid}").status_code==404
            assert data["snapshot"]["profile"]["current_location"]["area_ids"][0]==f"JP-{case.area_code}"
            for index,milestone in enumerate(case.milestones):
                res=client.post(f"/api/mock-live/{sid}/next",headers=HEADERS)
                assert res.status_code==200,res.text
                current=res.json()
                assert current["current_step"]==index+1
                assert current["historical"]["current_milestone"]["kind"]==milestone.kind
                assert current["historical"]["current_milestone"]["at_jst"]==milestone.at_jst
                snapshot=current["snapshot"]
                assert snapshot["spatial_guidance"]["movement_authorized"] is False
                assert all(x["is_synthetic"] and not x["eligible_for_high_risk"] for x in snapshot["evidence"])
                assert snapshot["routes"]==[] and snapshot["destinations"]==[]
                # Tsunami milestones now enter the Safety Core as synthetic bulletins; power outage stays background.
                if milestone.kind == "POWER_OUTAGE":
                    assert current["historical"]["current_milestone"]["fed_to_safety_core"] is False
                if milestone.kind in {"TSUNAMI_WARNING","TSUNAMI_UPGRADE"}:
                    assert current["historical"]["current_milestone"]["fed_to_safety_core"] is True
                    assert all(e["is_synthetic"] for e in snapshot["events"] if e["event_type"]=="TSUNAMI")
            assert client.post(f"/api/mock-live/{sid}/next",headers=HEADERS).status_code==409
        # P2.7: the candidate planner no longer selects Live/Mock Live actions before Core gating.
        assert planner.contexts == []


def test_history_is_server_allowlisted_and_never_applies_to_real_live(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY",KEY)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=Fallback()))) as client:
        for bad in ["2011", "../2011", "tsunami-2004"]:
            r=client.post("/api/mock-live/start",headers=HEADERS,json={"historical_case":bad})
            assert r.status_code==422
        r=client.post("/api/mock-live/start",json={"historical_case":"tohoku-2011"},headers=HEADERS)
        assert r.status_code==201
        sid=r.json()["snapshot"]["session_id"]
        assert client.get(f"/api/live/{sid}").status_code==404
        assert client.post("/api/mock-live/start",json={"historical_case":"tohoku-2011"}).status_code==403


def test_historical_stale_unknown_fail_closed(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY",KEY)
    with TestClient(create_app(mock_live_store=MockLiveDrillStore(planner=Fallback()))) as client:
        for evidence in ("STALE","UNKNOWN"):
            resp=client.post("/api/mock-live/start",
                             json={"historical_case":"tohoku-2011","evidence":evidence},
                             headers=HEADERS).json()
            session_id=resp["snapshot"]["session_id"]
            for _ in range(resp["total_steps"]):
                resp=client.post(f"/api/mock-live/{session_id}/next",headers=HEADERS).json()
            assert not resp["snapshot"]["spatial_guidance"]["movement_authorized"]
            assert all(e["is_synthetic"] for e in resp["snapshot"]["evidence"])
