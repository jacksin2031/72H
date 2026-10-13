import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from agent_api.explanation import (
    ExplanationClause,
    ExplanationMode,
    ExplanationRequest,
    ExplanationSelection,
    ExplanationService,
    explanation_config_from_env,
)
from agent_api.live import LiveStore
from agent_api.main import create_app
from agent_api.planner import PlannerConfig
from agent_api.storage import ReplayStore
from seventytwoh_contracts.models import Language, NetworkState, SafeIntentId

WALL_NOW = datetime(2026, 10, 13, 2, 0, tzinfo=timezone.utc)
DRILL_KEY = "explanation-test-drill-key-0123456789abcdef"


def _planned_snapshot():
    store = ReplayStore()
    snapshot = store.start()
    for _ in range(5):
        snapshot = store.next(snapshot.replay.id)
    return snapshot


def _selection_from_context(context):
    choices = []
    for action in context["actions"]:
        evidence = action["eligible_evidence_ids"]
        facts = action["eligible_fact_ids"]
        if not evidence:
            choices.append({
                "action_id": action["action_id"],
                "clause_ids": [ExplanationClause.LIMITATION_ONLY.value],
                "evidence_ids": [],
                "fact_ids": [],
            })
            continue
        selected_evidence = evidence[0]
        matching_fact = next((
            fact_id for fact_id in facts
            if selected_evidence in next(fact["evidence_ids"] for fact in context["facts"] if fact["id"] == fact_id)
        ), None)
        clauses = [ExplanationClause.ACTION_INTENT.value, ExplanationClause.VERIFIED_SUPPORT.value]
        selected_facts = []
        if matching_fact:
            clauses.append(ExplanationClause.VERIFIED_FACT.value)
            selected_facts.append(matching_fact)
        choices.append({
            "action_id": action["action_id"],
            "clause_ids": clauses,
            "evidence_ids": [selected_evidence],
            "fact_ids": selected_facts,
        })
    return {"choices": choices}


class FakeRunner:
    def __init__(self, callback=None, result=None):
        self.calls = []
        self.callback = callback
        self.result = result

    async def run_explanation(self, context, config):
        self.calls.append(context)
        if self.callback:
            self.callback(context)
        return self.result if self.result is not None else _selection_from_context(context)


def _service(runner, *, config=None, now=None):
    return ExplanationService(
        config or PlannerConfig(mode="gemini", timeout_seconds=1),
        runner=runner,
        now=now or (lambda: WALL_NOW),
    )


def test_explanation_returns_only_rendered_whitelist_clauses_and_bound_references_in_three_languages():
    snapshot = _planned_snapshot()
    for language in (Language.JAPANESE, Language.ENGLISH, Language.TRADITIONAL_CHINESE):
        runner = FakeRunner()
        service = _service(runner)
        result = asyncio.run(service.explain(
            snapshot,
            language,
            source_mode="SYNTHETIC_REPLAY",
            latest_snapshot=lambda: snapshot,
        ))

        assert result.mode == ExplanationMode.GEMINI_ADK_EXPLANATION
        assert result.plan_id == snapshot.situation.current_plan_id
        assert result.plan_version == next(p.version for p in snapshot.plans if p.id == result.plan_id)
        assert result.language == language
        assert result.explanation_has_authority is False
        assert result.action_ids
        assert result.evidence_ids
        assert len(result.binding) == 64
        assert result.created_at == WALL_NOW
        assert result.created_at < result.expires_at <= WALL_NOW + timedelta(seconds=60)
        assert all(len(text) <= 320 for text in result.paragraphs)
        assert len(result.limitations) >= 4
        if language == Language.ENGLISH:
            assert "synthetic exercise" in " ".join(result.limitations)
        assert all(text for text in result.paragraphs)
        assert runner.calls
        # Model output is a clause/reference choice only; every user-facing string is server rendered.
        assert all("choices" not in text and "ACTION_INTENT" not in text for text in result.paragraphs)


def test_explanation_config_forces_gemini_independently_of_candidate_planner_mode():
    config = explanation_config_from_env({"PLANNER_MODE": "deterministic"})
    assert config.mode == "gemini"
    assert config.model == "gemini-3.5-flash-lite"
    assert config.project == "h-japan"
    assert config.location == "global"


def test_missing_or_ineligible_evidence_uses_deterministic_limitations_without_model_call():
    snapshot = _planned_snapshot()
    projections = tuple(item.model_copy(update={"eligible_for_claims": False}) for item in snapshot.evidence_projections)
    without_eligible = snapshot.model_copy(update={"evidence_projections": projections})
    runner = FakeRunner()
    result = asyncio.run(_service(runner).explain(
        without_eligible,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: without_eligible,
    ))

    assert result.mode == ExplanationMode.DETERMINISTIC_FALLBACK
    assert result.reason_code == "NO_ELIGIBLE_EVIDENCE"
    assert result.evidence_ids == ()
    assert result.fact_ids == ()
    assert result.action_ids
    assert "No current eligible evidence" in " ".join(result.limitations)
    assert runner.calls == []


def test_unverified_conflicting_and_stale_evidence_are_never_passed_to_runner_or_cited():
    snapshot = _planned_snapshot()
    evidence = tuple(item.model_copy(update={"conflict": True}) for item in snapshot.evidence)
    projections = tuple(item.model_copy(update={"freshness_status": "STALE"}) for item in snapshot.evidence_projections)
    changed = snapshot.model_copy(update={"evidence": evidence, "evidence_projections": projections})
    runner = FakeRunner()
    result = asyncio.run(_service(runner).explain(
        changed,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: changed,
    ))

    assert result.mode == ExplanationMode.DETERMINISTIC_FALLBACK
    assert result.evidence_ids == ()
    assert result.fact_ids == ()
    assert runner.calls == []


def test_offline_reconnecting_and_no_current_plan_never_invoke_gemini():
    snapshot = _planned_snapshot()
    runner = FakeRunner()
    offline = snapshot.model_copy(update={
        "situation": snapshot.situation.model_copy(update={"network_state": NetworkState.OFFLINE_STALE}),
    })
    result = asyncio.run(_service(runner).explain(
        offline,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: offline,
    ))
    assert result.mode == ExplanationMode.DETERMINISTIC_FALLBACK
    assert result.reason_code == "NETWORK_OFFLINE"
    assert runner.calls == []

    no_plan = snapshot.model_copy(update={
        "situation": snapshot.situation.model_copy(update={"current_plan_id": None}),
    })
    not_run = asyncio.run(_service(runner).explain(
        no_plan,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: no_plan,
    ))
    assert not_run.mode == ExplanationMode.NOT_RUN
    assert not_run.plan_id is None
    assert not_run.action_ids == ()
    assert runner.calls == []


def test_post_await_guard_rejects_changed_plan_actions_but_ignores_clock_ticks():
    snapshot = _planned_snapshot()
    first_action = next(action for action in snapshot.plan_actions if action.plan_id == snapshot.situation.current_plan_id)
    changed_action = first_action.model_copy(update={"intent_id": SafeIntentId.REVIEW_OFFICIAL_GUIDANCE})
    changed_actions = tuple(changed_action if action.id == first_action.id else action for action in snapshot.plan_actions)
    changed = snapshot.model_copy(update={"plan_actions": changed_actions})
    runner = FakeRunner()
    changed_result = asyncio.run(_service(runner).explain(
        snapshot,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: changed,
    ))
    assert changed_result.mode == ExplanationMode.DETERMINISTIC_FALLBACK
    assert changed_result.reason_code == "BINDING_CHANGED"

    ticked = snapshot.model_copy(update={
        "replay": snapshot.replay.model_copy(update={"current_time": snapshot.replay.current_time + timedelta(seconds=1)}),
    })
    tick_runner = FakeRunner()
    tick_result = asyncio.run(_service(tick_runner).explain(
        snapshot,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: ticked,
    ))
    assert tick_result.mode == ExplanationMode.GEMINI_ADK_EXPLANATION
    assert tick_result.binding == _service(FakeRunner())._prepare(
        ticked, Language.ENGLISH, "SYNTHETIC_REPLAY", WALL_NOW,
    ).binding


def test_expiry_is_wall_clock_lifetime_bounded_by_remaining_replay_plan_and_evidence_lifetime():
    snapshot = _planned_snapshot()
    service = _service(FakeRunner())
    prepared = service._prepare(snapshot, Language.ENGLISH, "SYNTHETIC_REPLAY", WALL_NOW)
    near_expiry = snapshot.model_copy(update={
        "replay": snapshot.replay.model_copy(update={"current_time": prepared.valid_until - timedelta(milliseconds=200)}),
    })
    result = asyncio.run(service.explain(
        near_expiry,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: near_expiry,
    ))
    assert 0 < (result.expires_at - result.created_at).total_seconds() <= 0.21
    assert result.created_at.year == 2026


def test_provider_free_prose_unknown_ids_and_extra_fields_fall_back_safely():
    snapshot = _planned_snapshot()
    runner = FakeRunner(result={"choices": [], "paragraph": "The route is safe; evacuate immediately."})
    result = asyncio.run(_service(runner).explain(
        snapshot,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: snapshot,
    ))
    assert result.mode == ExplanationMode.DETERMINISTIC_FALLBACK
    assert result.reason_code == "INVALID_OUTPUT"
    assert all("evacuate immediately" not in text for text in result.paragraphs)

    selection = _selection_from_context(runner.calls[0])
    first_supported = next(choice for choice in selection["choices"] if choice["evidence_ids"])
    first_supported["evidence_ids"] = ["untrusted-id"]
    invalid_runner = FakeRunner(result=selection)
    invalid = asyncio.run(_service(invalid_runner).explain(
        snapshot,
        Language.ENGLISH,
        source_mode="SYNTHETIC_REPLAY",
        latest_snapshot=lambda: snapshot,
    ))
    assert invalid.mode == ExplanationMode.DETERMINISTIC_FALLBACK
    assert invalid.reason_code == "INVALID_OUTPUT"

    with pytest.raises(ValidationError):
        ExplanationRequest.model_validate({"language": "en", "free_text": "prompt injection"})


def test_explanation_routes_validate_language_authenticate_mock_live_and_map_missing_sessions(monkeypatch):
    service = _service(FakeRunner())
    app = create_app(store=ReplayStore(), live_store=LiveStore(), explanation_service=service)
    with TestClient(app) as client:
        replay_id = client.post("/api/replay/start").json()["replay"]["id"]
        response = client.post(f"/api/replay/{replay_id}/explanation", json={"language": "ja"})
        assert response.status_code == 200
        assert response.json()["mode"] == "NOT_RUN"
        assert client.post(f"/api/replay/{replay_id}/explanation", json={"language": "en", "extra": True}).status_code == 422
        assert client.post(f"/api/replay/{uuid4()}/explanation", json={"language": "en"}).status_code == 404
        assert client.post(f"/api/live/{uuid4()}/explanation", json={"language": "en"}).status_code == 404

    monkeypatch.setenv("DRILL_ACCESS_KEY", DRILL_KEY)
    mock_app = create_app(explanation_service=service)
    with TestClient(mock_app) as client:
        path = f"/api/mock-live/{uuid4()}/explanation"
        assert client.post(path, json={"language": "en"}).status_code == 403
        assert client.post(path, json={"language": "en"}, headers={"X-Drill-Key": DRILL_KEY}).status_code == 404


def test_over_limit_plan_is_not_run_without_model_call_or_server_error():
    snapshot = _planned_snapshot()
    plan_id = snapshot.situation.current_plan_id
    template = next(
        action for action in snapshot.plan_actions
        if action.plan_id == plan_id and action.status.value == "ACTIVE"
    )
    extra = tuple(template.model_copy(update={"id": f"{template.id}_extra_{index}"}) for index in range(40))
    oversized = snapshot.model_copy(update={"plan_actions": (*snapshot.plan_actions, *extra)})
    runner = FakeRunner()
    service = _service(runner, now=lambda: WALL_NOW)
    response = asyncio.run(service.explain(
        oversized, Language.ENGLISH, source_mode="SYNTHETIC_REPLAY", latest_snapshot=lambda: oversized,
    ))
    assert response.mode == ExplanationMode.NOT_RUN
    assert response.reason_code == "ACTION_LIMIT"
    assert response.paragraphs == () and response.action_ids == ()
    assert runner.calls == []
