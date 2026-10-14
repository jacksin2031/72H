"""311 / Noto historical exercises feed a synthetic tsunami bulletin through the real Live pipeline.

No real model calls and no real JMA provider: the synthetic bulletin enters the same Live reducers,
evidence, dependency invalidation, re-planning and distress trigger code as a live VTSE41 bulletin.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from agent_api.historical_cases import CASES
from agent_api.main import create_app
from agent_api.mock_live import MockLiveDrillStore, MockLiveRequest, MockTsunamiSource, MockJmaSource
from agent_api.planner import CandidatePlanner, PlannerConfig
from agent_api.simulation_advice import SimulationAdvisor
from seventytwoh_contracts.models import LiveSourceStatus, TsunamiOperation, TsunamiWarningClass

KEY = "TEST_ONLY_HISTORICAL_TSUNAMI_KEY_0123456789"
HEADERS = {"X-Drill-Key": KEY}
ISHINOMAKI = ("JP-MUNI-04202", "JP-04", "JP")
CHIYODA = ("JP-MUNI-13101", "JP-13", "JP")
WAJIMA = ("JP-MUNI-17204", "JP-17", "JP")
RETURN_TRIP = ("返程", "帰路", "return trip", "planned return")
TRANSPORT_ONLY = ("交通狀態判斷", "交通状況だけ", "transport status alone")


class UnknownRunner:
    def __init__(self):
        self.contexts = []

    async def run_assessment(self, context, config):
        self.contexts.append(context)
        return dict(version=context["version"], decision="UNKNOWN",
                    fact_ids=[f["id"] for f in context["facts"]], limitation_ids=context["limitation_ids"])


def _client(runner=None):
    advisor = SimulationAdvisor(config=PlannerConfig(mode="gemini"), runner=runner or UnknownRunner())
    store = MockLiveDrillStore(planner=CandidatePlanner(PlannerConfig(mode="deterministic")), advisor=advisor)
    return TestClient(create_app(mock_live_store=store))


def _start(client, *, area=ISHINOMAKI, case="tohoku-2011", network="ONLINE", language="zh-TW"):
    body = {
        "historical_case": case, "use_gemini": True, "network": network, "language": language,
        "location_context": {"area_ids": list(area), "source": "USER_SELECTED",
                             "observed_at": datetime.now(timezone.utc).isoformat()},
        "conditions": {"site": "COASTAL_LOWLAND", "shaking": "AFTER"},
    }
    response = client.post("/api/mock-live/start", headers=HEADERS, json=body)
    assert response.status_code == 201, response.text
    return response.json()["snapshot"]["session_id"]


def _next(client, sid):
    response = client.post(f"/api/mock-live/{sid}/next", headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def _current(snapshot, category):
    plan_id = snapshot["situation"]["current_plan_id"]
    return [a for a in snapshot["plan_actions"] if a["plan_id"] == plan_id and a["category"] == category]


def _assert_exercise_safe(data):
    snapshot = data["snapshot"]
    assert snapshot["spatial_guidance"]["movement_authorized"] is False
    assert snapshot["routes"] == [] and snapshot["destinations"] == []
    assert all(e["is_synthetic"] for e in snapshot["events"])
    assert all(e["is_synthetic"] and not e["eligible_for_high_risk"] for e in snapshot["evidence"])
    assert not any(a["risk_level"] == "HIGH" and a["safety_decision"] == "ALLOW" for a in snapshot["plan_actions"])
    # Synthetic data is never labelled as the live JMA feed.
    for source in (snapshot["source"], *snapshot["official_sources"]):
        assert source["source_name"].startswith("SIMULATED"), source
        assert source["source_url"].startswith("mock://"), source


def _no_trip_text(actions):
    for action in actions:
        for needle in (*RETURN_TRIP, *TRANSPORT_ONLY):
            assert needle not in action["text"], (needle, action["text"])


def test_tsunami_milestones_are_fed_to_safety_core_and_power_outage_stays_background():
    for case in CASES.values():
        for milestone in case.milestones:
            expected = milestone.kind in {"EARTHQUAKE", "AFTERSHOCK", "TSUNAMI_WARNING", "TSUNAMI_UPGRADE"}
            assert milestone.public()["fed_to_safety_core"] is expected, (case.id, milestone.kind)
    assert any(m.kind == "POWER_OUTAGE" and not m.public()["fed_to_safety_core"]
               for case in CASES.values() for m in case.milestones)


def test_311_ishinomaki_warning_replans_to_tsunami_guidance_through_the_real_pipeline(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with _client() as client:
        sid = _start(client)
        step1 = _next(client, sid)
        snap = step1["snapshot"]
        assert snap["situation"]["current_plan_id"] == "plan_v1"
        assert snap["distress"]["level"] == "NONE"
        assert not any(e["event_type"] == "TSUNAMI" for e in snap["events"])
        _no_trip_text(_current(snap, "NEXT") + _current(snap, "AVOID"))
        _assert_exercise_safe(step1)

        step2 = _next(client, sid)
        snap = step2["snapshot"]
        _assert_exercise_safe(step2)
        assert snap["distress"]["level"] == "OFFICIAL_TSUNAMI"
        assert snap["distress"]["synthetic"] is True
        assert snap["distress"]["warning_class"] == "MAJOR_WARNING"
        assert snap["situation"]["current_plan_id"] == "plan_v2"
        assert [p["id"] for p in snap["plans"]][:2] == ["plan_v1", "plan_v2"]
        assert any(e["plan_id"] == "plan_v1" and e["status"] != "KEEP" for e in snap["plan_evaluations"])
        now = _current(snap, "NOW")
        assert [a["intent_id"] for a in now] == ["tsunami_evacuate_now"]
        # Synthetic evidence never authorizes the high-risk movement intent: blocked, not substituted.
        assert now[0]["safety_decision"] == "BLOCK"
        trigger = snap["distress"]["trigger_evidence_ids"]
        assert len(trigger) == 1 and trigger[0] in now[0]["evidence_ids"]
        tsunami = next(e for e in snap["evidence"] if e["id"] == trigger[0])
        assert tsunami["is_synthetic"] is True and "JP-04" in tsunami["affected_area_ids"]
        assert "HISTORICAL EXERCISE" in tsunami["summary"]
        assert tsunami["raw_reference"] == "mock://72h/historical/tohoku-2011/2/tsunami"
        assert "SIMULATED" in tsunami["source_name"]
        # Tsunami-relevant NEXT / AVOID, never the transport / return-trip template.
        next_actions, avoid = _current(snap, "NEXT"), _current(snap, "AVOID")
        assert [a["intent_id"] for a in next_actions] == ["stay_high_until_official_clear"]
        assert [a["intent_id"] for a in avoid] == ["avoid_coast_and_rivers"]
        assert "高處" in next_actions[0]["text"] and "海" in avoid[0]["text"]
        _no_trip_text(next_actions + avoid)
        # The Gemini assessment for this step is bound to the new plan.
        assert step2["movement_assessment"]["plan_id"] == "plan_v2"

        step3 = _next(client, sid)
        _assert_exercise_safe(step3)
        assert step3["snapshot"]["distress"]["level"] == "OFFICIAL_TSUNAMI"

        step4 = _next(client, sid)  # M7.6 aftershock while the warning is current
        snap = step4["snapshot"]
        _assert_exercise_safe(step4)
        assert step4["historical"]["current_milestone"]["kind"] == "AFTERSHOCK"
        assert snap["distress"]["level"] == "OFFICIAL_TSUNAMI"
        assert [a["intent_id"] for a in _current(snap, "NOW")] == ["tsunami_evacuate_now"]
        assert [a["intent_id"] for a in _current(snap, "NEXT")] == ["stay_high_until_official_clear"]
        assert [p["version"] for p in snap["plans"]] == list(range(1, len(snap["plans"]) + 1))


def test_offline_exercise_never_receives_a_tsunami_trigger(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with _client() as client:
        sid = _start(client, network="OFFLINE")
        for _ in range(4):
            data = _next(client, sid)
            assert data["snapshot"]["distress"]["level"] == "NONE"
            assert not any(e["event_type"] == "TSUNAMI" for e in data["snapshot"]["events"])
            _assert_exercise_safe(data)


def test_user_outside_warned_prefectures_gets_no_trigger(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with _client() as client:
        sid = _start(client, area=CHIYODA)
        for _ in range(4):
            data = _next(client, sid)
            assert data["snapshot"]["distress"]["level"] == "NONE"
            assert all(a["intent_id"] != "tsunami_evacuate_now" for a in data["snapshot"]["plan_actions"])
            _assert_exercise_safe(data)


def test_noto_tsunami_warning_uses_its_own_area(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    with _client() as client:
        sid = _start(client, area=WAJIMA, case="noto-2024")
        assert _next(client, sid)["snapshot"]["distress"]["level"] == "NONE"
        warned = _next(client, sid)["snapshot"]
        assert warned["distress"]["level"] == "OFFICIAL_TSUNAMI" and warned["distress"]["synthetic"] is True
        assert warned["distress"]["warning_class"] == "WARNING"
        _next(client, sid)
        upgraded = _next(client, sid)["snapshot"]
        assert upgraded["distress"]["level"] == "OFFICIAL_TSUNAMI"
        assert upgraded["distress"]["warning_class"] == "MAJOR_WARNING"
        sid = _start(client, area=ISHINOMAKI, case="noto-2024")
        for _ in range(4):
            assert _next(client, sid)["snapshot"]["distress"]["level"] == "NONE"


@pytest.mark.parametrize("case", ["kobe-1995", "kumamoto-2016", "iburi-2018"])
def test_cases_without_tsunami_milestones_never_trigger(monkeypatch, case):
    monkeypatch.setenv("DRILL_ACCESS_KEY", KEY)
    area = {"kobe-1995": ("JP-MUNI-28101", "JP-28", "JP"), "kumamoto-2016": ("JP-MUNI-43101", "JP-43", "JP"),
            "iburi-2018": ("JP-MUNI-01101", "JP-01", "JP")}[case]
    with _client() as client:
        sid = _start(client, area=area, case=case)
        for _ in range(len(CASES[case].milestones)):
            data = _next(client, sid)
            assert data["snapshot"]["distress"]["level"] == "NONE"
            assert not any(e["event_type"] == "TSUNAMI" for e in data["snapshot"]["events"])


def test_mock_tsunami_bulletin_is_stable_labelled_and_expires(monkeypatch):
    request = MockLiveRequest(historical_case="tohoku-2011")
    jma = MockJmaSource(request)
    clock = {"now": datetime(2026, 10, 15, 3, 0, tzinfo=timezone.utc)}
    source = MockTsunamiSource(jma, now=lambda: clock["now"])
    jma.stage = 1
    assert source.fetch_latest().bulletins == ()
    jma.stage = 2
    first = source.fetch_latest()
    assert first.status == LiveSourceStatus.FRESH
    (bulletin,) = first.bulletins
    assert bulletin.operation == TsunamiOperation.ISSUE
    assert bulletin.published_at == clock["now"]
    assert bulletin.reference_url == "mock://72h/historical/tohoku-2011/2/tsunami"
    assert {a.name for a in bulletin.forecast_areas} >= {"岩手県", "宮城県", "福島県"}
    assert all(a.warning_class == TsunamiWarningClass.MAJOR_WARNING for a in bulletin.forecast_areas)
    clock["now"] += timedelta(minutes=5)
    assert source.fetch_latest().bulletins[0].published_at == bulletin.published_at  # no silent refresh
    jma.stage = 3
    upgrade = source.fetch_latest().bulletins[-1]
    assert upgrade.operation == TsunamiOperation.UPDATE and upgrade.event_id == bulletin.event_id
    jma.stage = 4
    clock["now"] += timedelta(hours=1)
    stale = source.fetch_latest()
    assert stale.status == LiveSourceStatus.STALE  # expired per the JMA evidence TTL, never shown as current
    offline = MockTsunamiSource(MockJmaSource(MockLiveRequest(historical_case="tohoku-2011", network="OFFLINE")))
    offline.jma.stage = 2
    assert offline.fetch_latest().status == LiveSourceStatus.UNAVAILABLE
    assert offline.fetch_latest().bulletins == ()
