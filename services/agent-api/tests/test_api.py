from fastapi.testclient import TestClient

from agent_api.main import create_app
from agent_api.storage import ReplayStore


def _client():
    return TestClient(create_app(ReplayStore()))


def test_health_version_and_start_without_body():
    client = _client()
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/version").json() == {
        "service": "72h-agent-api",
        "version": "0.1.0",
        "phase": "phase-3",
    }

    response = client.post("/api/replay/start")

    assert response.status_code == 201
    snapshot = response.json()
    assert set(snapshot) == {
        "distress",
        "profile",
        "area_catalog",
        "situation",
        "events",
        "evidence",
        "plans",
        "plan_actions",
        "trace",
        "replay",
        "scenario_events",
        "evidence_projections",
        "mobility",
        "plan_evaluations",
    }
    assert snapshot["replay"]["id"]
    assert snapshot["replay"]["mode"] == "SYNTHETIC_REPLAY"
    assert "not live official information" in snapshot["replay"]["mode_label"]
    assert snapshot["profile"]["preferred_language"] == "zh-TW"
    assert snapshot["profile"]["current_location"]["lat"] == 35.6595
    assert snapshot["profile"]["current_location"]["lng"] == 139.7005
    assert snapshot["profile"]["accommodation_location"]["lat"] == 35.7148
    assert snapshot["profile"]["accommodation_location"]["lng"] == 139.7967
    assert snapshot["replay"]["scenario_key"] == "tokyo-earthquake-v1"
    assert snapshot["plans"] == []
    assert snapshot["plan_actions"] == []
    assert snapshot["plan_evaluations"] == []
    assert snapshot["situation"]["claim_states"] == []
    assert snapshot["scenario_events"][0].keys() >= {
        "id",
        "event_type",
        "occurred_at",
        "offset_seconds",
        "label",
    }


def test_start_accepts_supported_language_and_rejects_extra_fields():
    client = _client()
    response = client.post("/api/replay/start", json={"language": "ja"})
    assert response.status_code == 201
    assert response.json()["profile"]["preferred_language"] == "ja"

    bad = client.post("/api/replay/start", json={"language": "fr"})
    assert bad.status_code == 422
    extra = client.post("/api/replay/start", json={"language": "ja", "trust_status": "VERIFIED_OFFICIAL"})
    assert extra.status_code == 422


def test_registered_scenario_api_selects_osaka_and_rejects_unknown_keys():
    client = _client()
    options = client.get("/api/replay/scenarios")
    assert options.status_code == 200
    assert {item["key"] for item in options.json()} == {
        "tokyo-earthquake-v1",
        "osaka-earthquake-v1",
    }
    assert all(set(item) == {"key", "name"} for item in options.json())

    started = client.post(
        "/api/replay/start", json={"scenario_key": "osaka-earthquake-v1"}
    )
    assert started.status_code == 201
    snapshot = started.json()
    assert snapshot["replay"]["scenario_key"] == "osaka-earthquake-v1"
    assert snapshot["profile"]["current_location"]["area_ids"][0] == "JP-27-KITA"
    assert snapshot["profile"]["current_location"]["lat"] == 34.7
    assert snapshot["profile"]["current_location"]["lng"] == 135.5
    session_id = snapshot["replay"]["id"]
    client.post(f"/api/replay/{session_id}/next")
    state = client.post(f"/api/replay/{session_id}/next").json()
    assert state["evidence"][0]["raw_reference"].startswith(
        "replay://osaka-earthquake-v1/"
    )
    status_claim = next(
        claim
        for claim in state["situation"]["claim_states"]
        if claim["key"] == "disaster.EARTHQUAKE.JP-27.status"
    )
    assert status_claim["status"] == "VERIFIED"
    assert status_claim["value"] == "ACTIVE"

    unknown = client.post(
        "/api/replay/start", json={"scenario_key": "C:/arbitrary/scenario.json"}
    )
    assert unknown.status_code == 422

    invalid_profile = client.post(
        "/api/replay/start",
        json={
            "scenario_key": "tokyo-earthquake-v1",
            "profile": {
                "current_location": {"label": "Shibuya", "area_ids": ["JP-99"]},
                "accommodation_location": {"label": "Asakusa"},
            },
        },
    )
    assert invalid_profile.status_code == 422


def test_tokyo_replay_keeps_the_registered_eleven_event_four_plan_baseline():
    client = _client()
    state = client.post("/api/replay/start").json()
    session_id = state["replay"]["id"]
    assert len(state["scenario_events"]) == 11
    for _ in range(len(state["scenario_events"])):
        state = client.post(f"/api/replay/{session_id}/next").json()
    assert state["replay"]["status"] == "COMPLETED"
    assert len(state["plans"]) == 4


def test_controls_and_reset_preserve_session_identity_and_fixture_ids():
    client = _client()
    started = client.post("/api/replay/start", json={"language": "en"}).json()
    session_id = started["replay"]["id"]

    paused = client.post(f"/api/replay/{session_id}/pause")
    assert paused.status_code == 200
    assert paused.json()["replay"]["status"] == "PAUSED"

    advanced = client.post(f"/api/replay/{session_id}/next")
    assert advanced.status_code == 200
    assert advanced.json()["replay"]["current_event_index"] == 1
    assert advanced.json()["events"][0]["id"] == "evt_evt-earthquake-001"

    sped = client.post(f"/api/replay/{session_id}/speed", json={"speed": 4})
    assert sped.status_code == 200
    assert sped.json()["replay"]["speed"] == 4
    assert sped.json()["replay"]["next_event_delay_seconds"] == 3.75

    resumed = client.post(f"/api/replay/{session_id}/resume")
    assert resumed.status_code == 200
    assert resumed.json()["replay"]["status"] == "RUNNING"

    reset = client.post(f"/api/replay/{session_id}/reset")
    assert reset.status_code == 200
    body = reset.json()
    assert body["replay"]["id"] == session_id
    assert body["replay"]["status"] == "READY"
    assert body["replay"]["current_event_index"] == 0
    assert body["replay"]["speed"] == 1
    assert body["profile"]["id"] == started["profile"]["id"]
    assert body["situation"]["id"] == started["situation"]["id"]
    assert body["events"] == []
    assert body["evidence"] == []
    assert body["trace"] == []
    assert body["mobility"] == []

    replayed = client.post(f"/api/replay/{session_id}/resume")
    replayed = client.post(f"/api/replay/{session_id}/next")
    assert replayed.json()["events"][0]["id"] == "evt_evt-earthquake-001"
    assert replayed.json()["events"][0]["occurred_at"] == advanced.json()["events"][0]["occurred_at"]


def test_sessions_are_isolated_and_bad_speed_does_not_mutate_state():
    client = _client()
    first = client.post("/api/replay/start").json()
    second = client.post("/api/replay/start").json()
    first_id = first["replay"]["id"]
    second_id = second["replay"]["id"]
    assert first_id != second_id

    bad_speed = client.post(f"/api/replay/{first_id}/speed", json={"speed": 3})
    assert bad_speed.status_code == 422
    assert client.get(f"/api/replay/{first_id}").json()["replay"]["speed"] == 1

    client.post(f"/api/replay/{first_id}/next")
    first_after = client.get(f"/api/replay/{first_id}").json()
    second_after = client.get(f"/api/replay/{second_id}").json()
    assert len(first_after["events"]) == 1
    assert second_after["events"] == []
    assert first_after["situation"]["id"] != second_after["situation"]["id"]


def test_network_restore_requires_verified_update_before_online_verified():
    client = _client()
    started = client.post("/api/replay/start").json()
    session_id = started["replay"]["id"]
    state = started

    for _ in range(8):
        state = client.post(f"/api/replay/{session_id}/next").json()
    assert state["situation"]["network_state"] == "RECONNECTING"

    state = client.post(f"/api/replay/{session_id}/next").json()
    assert state["situation"]["network_state"] == "RECONNECTING"
    state = client.post(f"/api/replay/{session_id}/next").json()
    assert state["situation"]["network_state"] == "ONLINE_VERIFIED"
    reconciliation = next(item for item in state["trace"] if item["event_type"] == "RECONCILIATION_COMPLETED")
    assert set(reconciliation["output_refs"]) == {
        "ev_reconnect-official-update-001",
        "ev_reconnect-transport-update-001",
    }


def test_clock_tick_exposes_stale_offline_evidence_and_get_does_not_advance_time():
    client = _client()
    started = client.post("/api/replay/start").json()
    session_id = started["replay"]["id"]
    for _ in range(3):
        state = client.post(f"/api/replay/{session_id}/next").json()
    before = client.get(f"/api/replay/{session_id}").json()
    assert client.get(f"/api/replay/{session_id}").json() == before
    assert before["replay"]["current_time"] == state["replay"]["current_time"]

    for _ in range(4):
        state = client.post(f"/api/replay/{session_id}/next").json()
    assert state["replay"]["current_time"] == "2026-10-04T17:52:30+09:00"
    assert state["situation"]["network_state"] == "OFFLINE_STALE"
    transport_projection = next(
        item for item in state["evidence_projections"]
        if item["evidence_id"] == "ev_transport-update-001"
    )
    assert transport_projection["freshness_status"] == "STALE"
    assert transport_projection["age_seconds"] == 335


def test_bad_transition_and_missing_session_are_explicit():
    client = _client()
    response = client.post("/api/replay/00000000-0000-0000-0000-000000000000/next")
    assert response.status_code == 404
    unstarted = client.post("/api/replay/00000000-0000-0000-0000-000000000000/resume")
    assert unstarted.status_code == 404
