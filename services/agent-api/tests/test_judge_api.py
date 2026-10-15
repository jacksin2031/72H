from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from agent_api import main as main_module, mock_live as mock_live_module
from agent_api.main import create_app
from agent_api.mock_live import MAX_MOCK_SESSIONS, MOCK_TTL, MockLiveDrillStore
from agent_api.planner import CandidatePlanner, PlannerConfig
from agent_api.simulation_advice import SimulationAdvisor


DRILL_KEY = "judge-api-test-key-with-at-least-thirty-two-characters"
HEADERS = {"X-Drill-Key": DRILL_KEY}
ISHINOMAKI = ["JP-MUNI-04202", "JP-04", "JP"]
TOHOKU_MILESTONES = ["EARTHQUAKE", "TSUNAMI_WARNING", "TSUNAMI_UPGRADE", "AFTERSHOCK"]


class _TimedOutRunner:
    async def run_assessment(self, context, config):
        raise TimeoutError()


class _ReleaseTrackingPlanner(CandidatePlanner):
    def __init__(self):
        super().__init__(config=PlannerConfig(mode="deterministic"))
        self.released_sessions = []

    def release_session(self, replay_id):
        self.released_sessions.append(replay_id)
        super().release_session(replay_id)


class _ReleaseTrackingAdvisor(SimulationAdvisor):
    def __init__(self):
        super().__init__(
            config=PlannerConfig(mode="gemini"), runner=_TimedOutRunner()
        )
        self.released_sessions = []

    def release_session(self, session_id):
        self.released_sessions.append(session_id)
        super().release_session(session_id)


class _RecordingMockLiveStore(MockLiveDrillStore):
    def __init__(self, *, max_sessions=8):
        super().__init__(
            planner=_ReleaseTrackingPlanner(),
            advisor=_ReleaseTrackingAdvisor(),
            max_sessions=max_sessions,
        )
        self.requests = []

    async def start(self, request):
        self.requests.append(request)
        return await super().start(request)


def _client(
    store: MockLiveDrillStore | None = None,
    *,
    judge_store: MockLiveDrillStore | None = None,
) -> TestClient:
    configured_store = store or _RecordingMockLiveStore()
    return TestClient(
        create_app(
            mock_live_store=configured_store,
            judge_store=judge_store or configured_store,
        )
    )


def test_judge_start_defaults_to_japanese_and_uses_fixed_server_profile(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", DRILL_KEY)
    store = _RecordingMockLiveStore()
    with _client(store) as client:
        before = datetime.now(timezone.utc)
        response = client.post("/api/judge/start")
        after = datetime.now(timezone.utc)

    assert response.status_code == 201, response.text
    data = response.json()
    request = store.requests[0]
    observed_at = request.location_context.observed_at
    location = data["snapshot"]["profile"]["current_location"]
    assert request.kind == "EARTHQUAKE"
    assert request.severity == 4
    assert request.battery == 80
    assert request.network == "ONLINE"
    assert request.evidence == "FRESH"
    assert request.mobility == "ABLE"
    assert request.use_gemini is True
    assert request.historical_case == "tohoku-2011"
    assert request.location_context.area_ids == tuple(ISHINOMAKI)
    assert request.location_context.source == "USER_SELECTED"
    assert before <= observed_at <= after
    assert data["snapshot"]["profile"]["preferred_language"] == "ja"
    assert location["area_ids"] == ISHINOMAKI
    assert location["source"] == "USER_SELECTED"
    assert datetime.fromisoformat(location["observed_at"].replace("Z", "+00:00")) == observed_at
    assert data["mode"] == "MOCK_LIVE"
    assert data["current_step"] == 0
    assert data["total_steps"] == 4
    assert data["battery"] == 80
    assert data["historical"]["case_id"] == "tohoku-2011"
    assert data["movement_assessment"] is None
    assert data["ai_modes"] == []


@pytest.mark.parametrize("language", ["ja", "en", "zh-TW", "zh-CN"])
def test_judge_start_accepts_only_supported_language_values(language):
    with _client() as client:
        response = client.post("/api/judge/start", json={"language": language})
    assert response.status_code == 201, response.text
    assert response.json()["snapshot"]["profile"]["preferred_language"] == language


@pytest.mark.parametrize(
    "payload",
    [
        {"language": "fr"},
        {"language": "ja", "severity": 0},
        {"language": "ja", "historical_case": "kobe-1995"},
        {"language": "ja", "location_context": {"area_ids": ISHINOMAKI}},
    ],
)
def test_judge_start_rejects_language_or_profile_overrides(payload):
    with _client() as client:
        response = client.post("/api/judge/start", json=payload)
    assert response.status_code == 422
    assert all("input" not in entry for entry in response.json()["detail"])


def test_judge_next_only_advances_judge_sessions_and_rejects_inputs(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", DRILL_KEY)
    with _client() as client:
        judge_start = client.post("/api/judge/start")
        ordinary_start = client.post("/api/mock-live/start", json={}, headers=HEADERS)
        assert judge_start.status_code == 201
        assert ordinary_start.status_code == 201
        judge_id = judge_start.json()["snapshot"]["session_id"]
        ordinary_id = ordinary_start.json()["snapshot"]["session_id"]

        assert client.post(f"/api/judge/{ordinary_id}/next").status_code == 404
        assert client.post(f"/api/judge/{judge_id}/next", json={}).status_code == 422
        assert client.post(f"/api/judge/{judge_id}/next", params={"step": "1"}).status_code == 422
        assert client.post(f"/api/mock-live/{judge_id}/next").status_code == 403
        assert client.get(f"/api/judge/{judge_id}").status_code == 404

        advanced = client.post(f"/api/judge/{judge_id}/next")
        assert advanced.status_code == 200, advanced.text
        assert advanced.json()["current_step"] == 1


def test_judge_public_start_does_not_weaken_mock_live_auth(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", DRILL_KEY)
    with _client() as client:
        assert client.post("/api/mock-live/start", json={}).status_code == 403
        assert client.post("/api/judge/start").status_code == 201


def test_judge_replays_four_ordered_synthetic_events_without_movement(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", DRILL_KEY)
    with _client() as client:
        started = client.post("/api/judge/start")
        assert started.status_code == 201, started.text
        session_id = started.json()["snapshot"]["session_id"]
        responses = [started.json()]
        for expected_step in range(1, 5):
            advanced = client.post(f"/api/judge/{session_id}/next")
            assert advanced.status_code == 200, advanced.text
            data = advanced.json()
            assert data["current_step"] == expected_step
            responses.append(data)
        completed = client.post(f"/api/judge/{session_id}/next")

    assert completed.status_code == 409
    assert [
        item["historical"]["current_milestone"]["kind"]
        for item in responses[1:]
    ] == TOHOKU_MILESTONES
    for item in responses[1:]:
        snapshot = item["snapshot"]
        assert snapshot["spatial_guidance"]["movement_authorized"] is False
        assert snapshot["routes"] == []
        assert snapshot["destinations"] == []
        assert all(event["is_synthetic"] for event in snapshot["events"])
        assert all(
            evidence["is_synthetic"] and not evidence["eligible_for_high_risk"]
            for evidence in snapshot["evidence"]
        )
        # The API returns the real assessment result and never labels a test timeout as success.
        assert item["movement_assessment"]["ai_mode"] == "GEMINI_ADK_FALLBACK"
        assert item["movement_assessment"]["reason_code"] == "TIMEOUT"
        assert item["ai_modes"] == []


def test_judge_start_uses_bounded_process_wide_rate_limit():
    with _client() as client:
        responses = [client.post("/api/judge/start") for _ in range(5)]
    assert [response.status_code for response in responses] == [201] * 4 + [429]
    assert responses[-1].headers["Retry-After"] == "60"


def test_more_than_eight_completed_judge_runs_release_capacity_and_keep_recent_409_markers(monkeypatch):
    monkeypatch.setenv("DRILL_ACCESS_KEY", DRILL_KEY)
    now = [1_000.0]
    monkeypatch.setattr(main_module, "monotonic", lambda: now[0])
    protected_store = _RecordingMockLiveStore(max_sessions=2)
    app = create_app(mock_live_store=protected_store)
    assert app.state.judge_store is not protected_store
    assert app.state.judge_store._planner is protected_store._planner
    assert app.state.judge_store._advisor is protected_store._advisor

    with TestClient(app) as client:
        admin_first = client.post("/api/mock-live/start", json={}, headers=HEADERS)
        assert admin_first.status_code == 201, admin_first.text

        judge_ids = []
        for run_number in range(9):
            if run_number:
                # Keep the test above the public 4-starts / 60-second window.
                now[0] += 61
            started = client.post("/api/judge/start")
            assert started.status_code == 201, started.text
            session_id = started.json()["snapshot"]["session_id"]
            judge_ids.append(session_id)
            for expected_step in range(1, 5):
                advanced = client.post(f"/api/judge/{session_id}/next")
                assert advanced.status_code == 200, advanced.text
                assert advanced.json()["current_step"] == expected_step
            assert client.post(f"/api/judge/{session_id}/next").status_code == 409

        # Public judge sessions use a separate bounded session pool. They must not
        # occupy the remaining authenticated mock-live capacity.
        admin_second = client.post("/api/mock-live/start", json={}, headers=HEADERS)
        admin_over_capacity = client.post("/api/mock-live/start", json={}, headers=HEADERS)

        assert admin_second.status_code == 201, admin_second.text
        assert admin_over_capacity.status_code == 503
        # The marker cache stays bounded to eight recent sessions. Completed
        # markers still return the established 409 while they remain retained.
        assert client.post(f"/api/judge/{judge_ids[0]}/next").status_code == 404
        assert [
            client.post(f"/api/judge/{session_id}/next").status_code
            for session_id in judge_ids[1:]
        ] == [409] * 8
        assert protected_store._planner.released_sessions == [
            f"live-{session_id}" for session_id in judge_ids
        ]
        assert protected_store._advisor.released_sessions == judge_ids


def test_incomplete_judge_sessions_remain_bounded_until_the_existing_idle_ttl(monkeypatch):
    now = [10_000.0]
    clock = lambda: now[0]
    monkeypatch.setattr(main_module, "monotonic", clock)
    monkeypatch.setattr(mock_live_module, "monotonic", clock)

    with TestClient(create_app(mock_live_store=_RecordingMockLiveStore(max_sessions=1))) as client:
        for index in range(MAX_MOCK_SESSIONS):
            if index:
                # Stay under the start rate limit while keeping all runs incomplete.
                now[0] += 61
            started = client.post("/api/judge/start")
            assert started.status_code == 201, started.text

        now[0] += 61
        assert client.post("/api/judge/start").status_code == 503

        # The last incomplete run reaches the same 30-minute inactivity expiry
        # used by MockLiveDrillStore, freeing a slot without a new endpoint.
        now[0] += MOCK_TTL - 61
        restarted = client.post("/api/judge/start")
        assert restarted.status_code == 201, restarted.text


def test_slow_next_refreshes_active_marker_before_underlying_store_wait(monkeypatch):
    now = [0.0]
    clock = lambda: now[0]
    monkeypatch.setattr(main_module, "monotonic", clock)
    monkeypatch.setattr(mock_live_module, "monotonic", clock)
    protected_store = _RecordingMockLiveStore()
    app = create_app(mock_live_store=protected_store)
    judge_store = app.state.judge_store
    original_next = judge_store.next
    next_entered = Event()
    resume_next = Event()

    async def slow_next(session_id):
        response = await original_next(session_id)
        next_entered.set()
        if not await asyncio.to_thread(resume_next.wait, 10):
            raise TimeoutError("test did not resume the delayed next request")
        return response

    monkeypatch.setattr(judge_store, "next", slow_next)
    with TestClient(app) as client:
        session_ids = []
        for index in range(MAX_MOCK_SESSIONS):
            if index:
                now[0] += 61
            started = client.post("/api/judge/start")
            assert started.status_code == 201, started.text
            session_ids.append(started.json()["snapshot"]["session_id"])

        # The first marker would expire at t=1800. The store lookup extends its
        # session at t=1799, then this request waits while another start arrives.
        now[0] = 1_799
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending_next = executor.submit(
                client.post, f"/api/judge/{session_ids[0]}/next"
            )
            try:
                assert next_entered.wait(10)
                now[0] = 1_801
                rejected_start = client.post("/api/judge/start")
                assert rejected_start.status_code == 503
                assert rejected_start.json()["detail"] == "judge exercise capacity reached"
            finally:
                resume_next.set()

            advanced = pending_next.result(timeout=10)

        assert advanced.status_code == 200, advanced.text
        assert advanced.json()["current_step"] == 1
        # A successful in-flight request must keep its refreshed marker usable.
        continued = client.post(f"/api/judge/{session_ids[0]}/next")
        assert continued.status_code == 200, continued.text
        assert continued.json()["current_step"] == 2


def test_judge_store_404_removes_stale_session_marker_and_frees_capacity(monkeypatch):
    now = [0.0]
    clock = lambda: now[0]
    monkeypatch.setattr(main_module, "monotonic", clock)
    monkeypatch.setattr(mock_live_module, "monotonic", clock)
    app = create_app(mock_live_store=_RecordingMockLiveStore())

    with TestClient(app) as client:
        stale = client.post("/api/judge/start")
        assert stale.status_code == 201, stale.text
        stale_id = stale.json()["snapshot"]["session_id"]
        assert app.state.judge_store.release_session(UUID(stale_id)) is True
        assert client.post(f"/api/judge/{stale_id}/next").status_code == 404

        for _ in range(MAX_MOCK_SESSIONS):
            now[0] += 61
            started = client.post("/api/judge/start")
            assert started.status_code == 201, started.text

        now[0] += 61
        assert client.post("/api/judge/start").status_code == 503


def test_failed_next_does_not_extend_completed_marker_ttl(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(main_module, "monotonic", lambda: now[0])

    with _client() as client:
        started = client.post("/api/judge/start")
        assert started.status_code == 201, started.text
        session_id = started.json()["snapshot"]["session_id"]
        for _ in range(4):
            advanced = client.post(f"/api/judge/{session_id}/next")
            assert advanced.status_code == 200, advanced.text

        assert client.post(f"/api/judge/{session_id}/next").status_code == 409
        now[0] = MOCK_TTL - 1
        assert client.post(f"/api/judge/{session_id}/next").status_code == 409
        now[0] = MOCK_TTL
        assert client.post(f"/api/judge/{session_id}/next").status_code == 404
