import pathlib

from fastapi.testclient import TestClient

from agent_api.main import create_app
from agent_api.storage import ReplayStore


def _now_intent(data):
    plan_id = data["situation"]["current_plan_id"]
    return next(a["intent_id"] for a in data["plan_actions"] if a["plan_id"] == plan_id and a["category"] == "NOW")


def test_tsunami_replay_drives_levels_through_the_real_pipeline():
    with TestClient(create_app(store=ReplayStore())) as client:
        start = client.post("/api/replay/start", json={"scenario_key": "miyagi-tsunami-v1"}).json()
        rid = start["replay"]["id"]
        step = client.post(f"/api/replay/{rid}/next").json()  # earthquake
        assert step["distress"]["level"] == "NONE"
        step = client.post(f"/api/replay/{rid}/distress", json={"tags": ["WATER_RISING"], "input_mode": "BUTTON"}).json()
        assert step["distress"]["level"] == "USER_REPORTED"
        assert _now_intent(step) == "shelter_in_place_vertical"
        step = client.post(f"/api/replay/{rid}/next").json()  # tsunami WARNING
        assert step["distress"]["level"] == "OFFICIAL_TSUNAMI" and step["distress"]["synthetic"] is True
        assert _now_intent(step) == "tsunami_evacuate_now"
        warning_deadline = step["distress"]["deadline_at"]
        step = client.post(f"/api/replay/{rid}/next").json()  # MAJOR_WARNING, earlier arrival
        assert step["distress"]["deadline_at"] < warning_deadline
        plans_before_cancel = len(step["plans"])
        step = client.post(f"/api/replay/{rid}/next").json()  # cancellation
        assert step["distress"]["level"] != "OFFICIAL_TSUNAMI"
        assert _now_intent(step) != "tsunami_evacuate_now"
        assert len(step["plans"]) > plans_before_cancel  # history kept, new version appended


def test_no_timeline_specific_branches():
    root = pathlib.Path(__file__).resolve().parents[1] / "agent_api"
    for name in ("storage.py", "domain.py", "planning.py", "distress.py"):
        text = (root / name).read_text(encoding="utf-8")
        assert "replay_step ==" not in text and "current_event_index ==" not in text
