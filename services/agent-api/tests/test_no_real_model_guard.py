"""F7: no backend test may reach a real Gemini / Vertex endpoint."""

import pytest

from agent_api.distress_extract import extract_config_from_env


def test_constructing_a_real_genai_client_is_blocked_in_tests():
    from google import genai

    with pytest.raises(RuntimeError, match="real google.genai.Client"):
        genai.Client(vertexai=True, project="p", location="us-central1")


def test_distress_mode_defaults_to_deterministic_in_tests():
    assert extract_config_from_env().mode != "gemini"


def test_default_distress_endpoints_never_report_gemini():
    from fastapi.testclient import TestClient

    from agent_api.main import create_app

    client = TestClient(create_app())
    replay = client.post("/api/replay/start").json()["replay"]["id"]
    response = client.post("/api/distress/extract", json={"session_id": replay, "text": "help", "language": "en"})
    assert response.status_code == 200
    assert response.json()["mode"] != "GEMINI"
