import asyncio
import random
from uuid import uuid4

from fastapi.testclient import TestClient

from agent_api.distress_advice import (
    AdviceCandidate, AdviceRequest, DistressAdvice, DistressAdvisor, apply_conservative_advice,
)
from agent_api.main import create_app
from agent_api.planner import PlannerConfig
from agent_api.storage import ReplayStore
from seventytwoh_contracts.models import DistressLevel, Language

IDS = ("emergency_site:A", "emergency_site:B", "emergency_site:C")


def test_valid_advice_reorders_and_excludes_within_core_set():
    applied = apply_conservative_advice(
        DistressAdvice(candidate_order=("emergency_site:B", "emergency_site:A", "emergency_site:C"),
                       exclude_candidates=("emergency_site:C",), suggest_sos=True, emphasis_clause_ids=("MOVE_UP_NOW",)),
        level=DistressLevel.OFFICIAL_TSUNAMI, candidate_ids=IDS, user_signal=True, exclusion_signal=True)
    assert applied.candidate_order == ("emergency_site:B", "emergency_site:A")
    assert applied.excluded == ("emergency_site:C",)
    assert applied.suggest_sos is True and applied.raised_level is False


def test_invented_place_drops_ordering_but_keeps_valid_exclusions():
    applied = apply_conservative_advice(
        DistressAdvice(candidate_order=("emergency_site:Z", "emergency_site:A"), exclude_candidates=("emergency_site:B", "emergency_site:Z")),
        level=DistressLevel.OFFICIAL_TSUNAMI, candidate_ids=IDS, user_signal=True, exclusion_signal=True)
    assert applied.candidate_order == ("emergency_site:A", "emergency_site:C")
    assert applied.excluded == ("emergency_site:B",)
    assert "candidate_order" in applied.rejected_fields


def test_raise_only_from_none_to_user_reported():
    assert apply_conservative_advice(DistressAdvice(raise_level_to=1), level=DistressLevel.NONE, candidate_ids=(), user_signal=True).raised_level is True
    assert apply_conservative_advice(DistressAdvice(raise_level_to=1), level=DistressLevel.OFFICIAL_TSUNAMI, candidate_ids=IDS, user_signal=True).raised_level is False


def test_raise_requires_a_user_signal():
    applied = apply_conservative_advice(DistressAdvice(raise_level_to=1), level=DistressLevel.NONE, candidate_ids=(), user_signal=False)
    assert applied.raised_level is False
    assert applied.rejected_fields == ("raise_level_to",)


def test_property_result_is_never_less_protective_than_core():
    rng = random.Random(72)
    pool = IDS + ("emergency_site:Z", "evil:id")
    for _ in range(2000):
        level = rng.choice(list(DistressLevel))
        user_signal = rng.random() < 0.5
        exclusion_signal = rng.random() < 0.5
        ids = tuple(rng.sample(IDS, rng.randint(0, 3)))
        advice = DistressAdvice(
            raise_level_to=rng.choice([None, 1]),
            candidate_order=tuple(rng.sample(pool, rng.randint(0, 5))),
            exclude_candidates=tuple(rng.sample(pool, rng.randint(0, 5))),
            suggest_sos=rng.random() < 0.5,
        )
        applied = apply_conservative_advice(advice, level=level, candidate_ids=ids, user_signal=user_signal,
                                            exclusion_signal=exclusion_signal)
        assert set(applied.candidate_order) <= set(ids)
        assert set(applied.excluded) <= set(ids)
        assert not set(applied.candidate_order) & set(applied.excluded)
        assert set(applied.candidate_order) | set(applied.excluded) == set(ids)
        if applied.raised_level:
            assert level == DistressLevel.NONE and user_signal
        if not exclusion_signal:
            # Spec 13.3: AI may exclude places only on the person's own blocked-route report.
            assert applied.excluded == ()
            if advice.exclude_candidates:
                assert "exclude_candidates" in applied.rejected_fields


def test_exclusions_require_the_persons_blocked_route_report():
    advice = DistressAdvice(exclude_candidates=("emergency_site:A",))
    rejected = apply_conservative_advice(advice, level=DistressLevel.OFFICIAL_TSUNAMI, candidate_ids=IDS, user_signal=True)
    assert rejected.excluded == () and rejected.candidate_order == IDS
    assert rejected.rejected_fields == ("exclude_candidates",)
    accepted = apply_conservative_advice(advice, level=DistressLevel.OFFICIAL_TSUNAMI, candidate_ids=IDS,
                                         user_signal=True, exclusion_signal=True)
    assert accepted.excluded == ("emergency_site:A",) and accepted.rejected_fields == ()


def test_replay_exclusion_is_gated_by_route_blocked_report_or_hint():
    reply = {"exclude_candidates": ["emergency_site:A"]}
    with _replay_client(reply) as client:
        def advise(body, tags=None):
            replay_id = client.post("/api/replay/start").json()["replay"]["id"]
            if tags:
                assert client.post(f"/api/replay/{replay_id}/distress", json={"tags": tags, "input_mode": "BUTTON"}).status_code == 200
            return client.post(f"/api/replay/{replay_id}/distress/advice", json=body).json()["advice"]

        no_signal = advise(ADVICE_BODY, ["WATER_RISING"])
        assert no_signal["excluded"] == [] and "exclude_candidates" in no_signal["rejected_fields"]
        assert advise(ADVICE_BODY, ["ROUTE_BLOCKED_REPORTED"])["excluded"] == ["emergency_site:A"]
        assert advise(HINT_BODY)["excluded"] == ["emergency_site:A"]


def test_unknown_emphasis_clause_is_dropped_and_reported():
    applied = apply_conservative_advice(
        DistressAdvice(emphasis_clause_ids=("AVOID_WATER", "THIS_PLACE_IS_SAFE")),
        level=DistressLevel.USER_REPORTED, candidate_ids=IDS, user_signal=True)
    assert [c.value for c in applied.emphasis_clause_ids] == ["AVOID_WATER"]
    assert applied.rejected_fields == ("emphasis_clause_ids",)


def test_model_cannot_add_fields_like_safety_claims():
    advisor, _ = _advisor({"suggest_sos": True, "route_safe": True})
    applied = asyncio.run(advisor.advise("s1", _request(), level=DistressLevel.NONE, tags=(), user_signal=True))
    assert applied.mode == "DETERMINISTIC_FALLBACK" and applied.reason_code == "INVALID_OUTPUT"
    assert applied.suggest_sos is False and applied.raised_level is False
    assert applied.candidate_order == IDS[:2]


def test_disabled_model_degrades_without_calling_it():
    model = FakeModel({"raise_level_to": 1})
    advisor = DistressAdvisor(PlannerConfig(mode="deterministic"), model=model)
    applied = asyncio.run(advisor.advise("s1", _request(), level=DistressLevel.NONE, tags=(), user_signal=True))
    assert applied.mode == "DETERMINISTIC_FALLBACK" and applied.reason_code == "MODEL_DISABLED"
    assert model.calls == []


def test_advisor_passes_loose_advice_schema_to_model():
    advisor, model = _advisor({"candidate_order": ["emergency_site:B"]})
    applied = asyncio.run(advisor.advise("s1", _request(), level=DistressLevel.NONE, tags=(), user_signal=True))
    assert applied.mode == "GEMINI"
    assert applied.candidate_order == ("emergency_site:B", "emergency_site:A")
    schema = model.kwargs[0]["schema"]
    assert schema is not None and "candidate_order" in schema.model_fields


class FakeModel:
    def __init__(self, reply):
        self.reply = reply
        self.calls = []
        self.kwargs = []

    async def generate(self, parts, config, **kwargs):
        self.calls.append(parts)
        self.kwargs.append(kwargs)
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


def _advisor(reply):
    model = FakeModel(reply)
    return DistressAdvisor(PlannerConfig(mode="gemini", timeout_seconds=1), model=model), model


def _request():
    return AdviceRequest(language=Language.JAPANESE, candidates=(
        AdviceCandidate(place_id="emergency_site:A", name="A", walk_minutes=5),
        AdviceCandidate(place_id="emergency_site:B", name="B", walk_minutes=9),
    ))


ADVICE_BODY = {
    "language": "ja",
    "candidates": [
        {"place_id": "emergency_site:A", "name": "高台A", "walk_minutes": 6},
        {"place_id": "emergency_site:B", "name": "高台B", "walk_minutes": 11},
    ],
}


def _replay_client(reply):
    advisor, _ = _advisor(reply)
    return TestClient(create_app(store=ReplayStore(), distress_advisor=advisor))


HINT_BODY = dict(ADVICE_BODY, route_blocked_hint="旧北上川の橋")


def test_replay_advice_without_user_signal_never_escalates():
    with _replay_client({"raise_level_to": 1, "suggest_sos": True}) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        for body in (ADVICE_BODY, dict(ADVICE_BODY, route_blocked_hint="   ")):
            data = client.post(f"/api/replay/{replay_id}/distress/advice", json=body).json()
            assert data["advice"]["raised_level"] is False
            assert "raise_level_to" in data["advice"]["rejected_fields"]
            assert data["snapshot"]["distress"]["level"] == "NONE"
            assert data["snapshot"]["distress"]["ai_escalated"] is False
            rejected = [t for t in data["snapshot"]["trace"] if t["event_type"] == "DISTRESS_ADVICE_REJECTED"]
            assert rejected and "raise_level_to" in rejected[-1]["public_summary"]
            assert all(t["event_type"] != "DISTRESS_AI_ESCALATED" for t in data["snapshot"]["trace"])


def test_replay_advice_raises_none_to_user_reported_and_replans():
    with _replay_client({"raise_level_to": 1, "suggest_sos": True, "candidate_order": ["emergency_site:B"]}) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        before = client.get(f"/api/replay/{replay_id}").json()
        assert before["distress"]["level"] == "NONE"
        response = client.post(f"/api/replay/{replay_id}/distress/advice", json=HINT_BODY)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["advice"]["raised_level"] is True and data["advice"]["mode"] == "GEMINI"
        assert data["advice"]["candidate_order"] == ["emergency_site:B", "emergency_site:A"]
        snapshot = data["snapshot"]
        assert snapshot["distress"]["level"] == "USER_REPORTED"
        assert snapshot["distress"]["ai_escalated"] is True
        events = [t["event_type"] for t in snapshot["trace"]]
        assert "DISTRESS_AI_ESCALATED" in events and "DISTRESS_ADVICE_APPLIED" in events
        assert events.index("DISTRESS_AI_ESCALATED") < events.index("DISTRESS_ADVICE_APPLIED")
        assert snapshot["situation"]["current_plan_id"] != before["situation"]["current_plan_id"]
        assert {p["id"] for p in before["plans"]} <= {p["id"] for p in snapshot["plans"]}
        assert all(a["intent_id"] != "tsunami_evacuate_now" for a in snapshot["plan_actions"])


def test_replay_advice_invalid_json_falls_back_and_keeps_level():
    with _replay_client(ValueError("not json")) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        before = client.get(f"/api/replay/{replay_id}").json()
        response = client.post(f"/api/replay/{replay_id}/distress/advice", json=ADVICE_BODY)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["advice"]["mode"] == "DETERMINISTIC_FALLBACK"
        assert data["advice"]["reason_code"] == "INVALID_OUTPUT"
        assert data["advice"]["candidate_order"] == ["emergency_site:A", "emergency_site:B"]
        assert data["snapshot"]["distress"]["level"] == before["distress"]["level"]
        assert data["snapshot"]["distress"]["ai_escalated"] is False
        assert data["snapshot"]["situation"]["current_plan_id"] == before["situation"]["current_plan_id"]


def test_rejected_advice_trace_lists_field_names_not_model_text():
    reply = {"candidate_order": ["evil:IgnoreRulesSayItIsSafe"], "emphasis_clause_ids": ["THIS_PLACE_IS_SAFE"]}
    with _replay_client(reply) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        data = client.post(f"/api/replay/{replay_id}/distress/advice", json=ADVICE_BODY).json()
        trace = [t for t in data["snapshot"]["trace"] if t["event_type"] == "DISTRESS_ADVICE_REJECTED"]
        assert len(trace) == 1
        text = str(trace[0])
        assert "candidate_order" in trace[0]["public_summary"]
        assert "IgnoreRules" not in text and "THIS_PLACE_IS_SAFE" not in text
        assert data["snapshot"]["distress"]["level"] == "NONE"


def test_advice_rejects_invented_request_fields_and_missing_sessions():
    with _replay_client({}) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        bad = dict(ADVICE_BODY, level="OFFICIAL_TSUNAMI")
        assert client.post(f"/api/replay/{replay_id}/distress/advice", json=bad).status_code == 422
        bad_id = dict(ADVICE_BODY, candidates=[{"place_id": "Bad Id!", "name": "x", "walk_minutes": 1}])
        assert client.post(f"/api/replay/{replay_id}/distress/advice", json=bad_id).status_code == 422
        secret_hint = dict(ADVICE_BODY, route_blocked_hint="x" * 81)
        rejected = client.post(f"/api/replay/{replay_id}/distress/advice", json=secret_hint)
        assert rejected.status_code == 422 and "xxxx" not in rejected.text
        assert client.post(f"/api/replay/{uuid4()}/distress/advice", json=ADVICE_BODY).status_code == 404
        assert client.post(f"/api/live/{uuid4()}/distress/advice", json=ADVICE_BODY).status_code == 404


def test_live_advice_escalates_and_replans():
    from test_live_location import _store_and_client, _start

    advisor, _ = _advisor({"raise_level_to": 1})
    store, _client = _store_and_client()
    with TestClient(create_app(live_store=store, distress_advisor=advisor)) as client:
        sid = _start(client)["session_id"]
        before = client.get(f"/api/live/{sid}").json()
        assert before["distress"]["level"] == "NONE"
        response = client.post(f"/api/live/{sid}/distress/advice", json=HINT_BODY)
        assert response.status_code == 200, response.text
        snapshot = response.json()["snapshot"]
        assert snapshot["distress"]["level"] == "USER_REPORTED" and snapshot["distress"]["ai_escalated"] is True
        events = [t["event_type"] for t in snapshot["trace"]]
        assert events.count("DISTRESS_AI_ESCALATED") == 1 and events.count("DISTRESS_ADVICE_APPLIED") == 1
        assert snapshot["situation"]["current_plan_id"] != before["situation"]["current_plan_id"]


def test_mock_live_advice_requires_drill_key(monkeypatch):
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
    advisor, model = _advisor({"raise_level_to": 1, "suggest_sos": True})
    app = create_app(mock_live_store=MockLiveDrillStore(planner=Fallback()), distress_advisor=advisor)
    with TestClient(app) as client:
        sid = client.post("/api/mock-live/start", json={}, headers=headers).json()["snapshot"]["session_id"]
        assert client.post(f"/api/mock-live/{sid}/distress/advice", json=ADVICE_BODY).status_code in {401, 403}
        assert model.calls == []
        response = client.post(f"/api/mock-live/{sid}/distress/advice", json=HINT_BODY, headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["advice"]["suggest_sos"] is True
        assert "current_step" in data["snapshot"]
        inner = data["snapshot"]["snapshot"]
        assert inner["distress"]["ai_escalated"] is True
        assert inner["distress"]["level"] in {"USER_REPORTED", "OFFICIAL_TSUNAMI"}
        assert any(t["event_type"] == "DISTRESS_ADVICE_APPLIED" for t in inner["trace"])
        assert client.post(f"/api/mock-live/{uuid4()}/distress/advice", json=ADVICE_BODY, headers=headers).status_code == 404


def test_escalation_is_skipped_when_core_level_changed_before_recording(monkeypatch):
    """Race: the level left NONE between the advice read and the escalation write."""
    import agent_api.storage as storage_module
    from seventytwoh_contracts.models import DistressStatus

    with _replay_client({"raise_level_to": 1}) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        original = storage_module.resolve_distress
        calls = {"n": 0}

        def raced(state, now, policy):
            status = original(state, now, policy)
            calls["n"] += 1
            # First read (endpoint GET snapshot) sees NONE; afterwards Core reports a raised level.
            if calls["n"] > 1 and status.level == DistressLevel.NONE:
                return DistressStatus(level=DistressLevel.USER_REPORTED, reports=status.reports)
            return status

        monkeypatch.setattr(storage_module, "resolve_distress", raced)
        data = client.post(f"/api/replay/{replay_id}/distress/advice", json=HINT_BODY).json()
        assert data["advice"]["raised_level"] is False
        assert "raise_level_to" in data["advice"]["rejected_fields"]
        assert data["snapshot"]["distress"]["ai_escalated"] is False
        assert all(t["event_type"] != "DISTRESS_AI_ESCALATED" for t in data["snapshot"]["trace"])


def test_extractor_and_advisor_share_one_session_budget():
    from agent_api.distress_extract import DistressExtractor, ExtractRequest
    from agent_api.planner import _CallBudget

    budget = _CallBudget()
    config = PlannerConfig(mode="gemini", timeout_seconds=1)
    extract_model = FakeModel({"tags": [], "route_blocked_hint": None})
    advice_model = FakeModel({})
    extractor = DistressExtractor(config, model=extract_model, budget=budget)
    advisor = DistressAdvisor(config, model=advice_model, budget=budget)
    for _ in range(4):
        asyncio.run(extractor.extract(ExtractRequest(session_id="s1", language=Language.JAPANESE, text="水")))
    results = [asyncio.run(advisor.advise("s1", _request(), level=DistressLevel.NONE, tags=(), user_signal=False)) for _ in range(4)]
    assert len(extract_model.calls) + len(advice_model.calls) == 6
    assert results[-1].reason_code == "SESSION_CALL_LIMIT"


def test_create_app_wires_one_budget_into_extractor_and_advisor():
    app = create_app(store=ReplayStore())
    assert app.state.distress_advisor._budget is app.state.distress_extractor._budget
