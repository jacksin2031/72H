import ast
from pathlib import Path

from fastapi.testclient import TestClient

from agent_api.historical_cases import CASES
from agent_api.historical_zh_cn import ZH_CN
from agent_api.main import create_app
from agent_api.storage import ReplayStore

AGENT_API = Path(__file__).resolve().parents[1] / "agent_api"
# Characters that only appear in Traditional wording of the fixed templates.
TRADITIONAL_ONLY = set("驗證資訊與請這為們點線開關確認處檢議難災協")


def _run_replay(language: str) -> dict:
    client = TestClient(create_app(ReplayStore()))
    state = client.post("/api/replay/start", json={"language": language}).json()
    session_id = state["replay"]["id"]
    for _ in range(len(state["scenario_events"])):
        state = client.post(f"/api/replay/{session_id}/next").json()
    return state


def test_every_fixed_zh_tw_text_table_has_a_zh_cn_entry():
    missing = []
    for path in sorted(AGENT_API.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Dict):
                keys = {k.value for k in node.keys if isinstance(k, ast.Constant)}
                if "zh-TW" in keys and "zh-CN" not in keys:
                    missing.append(f"{path.name}:{node.lineno}")
    assert missing == []


def test_historical_labels_have_simplified_wording():
    for case in CASES.values():
        labels = [case.public()["label"], *(m["label"] for m in case.public()["milestones"])]
        for label in labels:
            assert label["zh-TW"] in ZH_CN
            assert label["zh-CN"] == ZH_CN[label["zh-TW"]]
            assert not TRADITIONAL_ONLY & set(label["zh-CN"])


def test_zh_cn_replay_matches_zh_tw_state_and_uses_simplified_text():
    simplified = _run_replay("zh-CN")
    traditional = _run_replay("zh-TW")

    assert simplified["profile"]["preferred_language"] == "zh-CN"
    assert simplified["replay"]["status"] == "COMPLETED"
    # Language changes wording only; plan versions, actions and risk stay identical.
    assert [p["version"] for p in simplified["plans"]] == [p["version"] for p in traditional["plans"]]
    def shape(state):
        return [(a["category"], a["risk_level"], a["status"], a["safety_decision"], a["evidence_ids"])
                for a in state["plan_actions"]]
    assert shape(simplified) == shape(traditional)
    texts = [a["text"] for a in simplified["plan_actions"]] + [a["reason"] for a in simplified["plan_actions"]]
    assert texts and all(not TRADITIONAL_ONLY & set(t) for t in texts)
