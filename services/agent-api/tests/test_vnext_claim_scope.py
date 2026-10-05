import json
from datetime import timedelta

import pytest
from pydantic import ValidationError
from dataclasses import replace

from agent_api.domain import reduce_raw_event
from agent_api.scenario import ScenarioError, load_registered_scenarios, load_scenario
from seventytwoh_contracts.models import (
    AreaDefinition,
    ClaimStateStatus,
    DisasterAssessment,
    DisasterSeverityLevel,
    DisasterEventStatus,
    PlanAction,
    ReplayScenario,
)


def test_typed_synthetic_severity_enters_real_evidence_pipeline(initial_state):
    event = next(e for e in load_scenario().events if e.id == "official-update-001")
    state = reduce_raw_event(initial_state, event.model_dump(mode="json"))
    severity = next(c for c in state.situation.claim_states if c.key == "disaster.tokyo.severity")
    assert severity.status == ClaimStateStatus.VERIFIED
    assert severity.value == "L4"
    assert severity.evidence_ids
    assert all(e.is_synthetic for e in state.evidence)
    assert not any(a.risk_level == "HIGH" for a in state.plan_actions)


@pytest.mark.parametrize("source,level", [("transport-update-001", "L4"), ("official-update-001", "CRITICAL"), ("official-update-001", "EVACUATE")])
def test_severity_registry_rejects_wrong_source_or_value_atomically(initial_state, source, level):
    event = next(e for e in load_scenario().events if e.id == source).model_dump(mode="json")
    event["claims"] = [{"key": "disaster.tokyo.severity", "value": level}]
    with pytest.raises(ValueError, match="source registry"):
        reduce_raw_event(initial_state, event)
    assert initial_state.evidence == ()
    assert initial_state.plans == ()


@pytest.mark.parametrize(
    ("legacy_key", "legacy_value"),
    [("disaster.tokyo.severity", "L1"), ("disaster.tokyo.status", "RESOLVED")],
)
def test_typed_and_legacy_tokyo_assessments_cannot_silently_disagree(
    initial_state, legacy_key, legacy_value
):
    event = next(
        e for e in load_scenario().events if e.id == "official-update-001"
    ).model_dump(mode="json")
    event["claims"] = [{"key": legacy_key, "value": legacy_value}]
    with pytest.raises(ValueError, match="conflicts with legacy Tokyo claim"):
        reduce_raw_event(initial_state, event)
    assert initial_state.evidence == ()
    assert initial_state.plans == ()


def test_unknown_severity_and_area_references_fail_contract_validation():
    with pytest.raises(ValidationError):
        DisasterAssessment.model_validate(
            {
                "area_id": "JP-27",
                "event_type": "EARTHQUAKE",
                "level": "L5",
                "status": "ACTIVE",
            }
        )

    scenario = load_scenario().model_dump(mode="json")
    scenario["events"][0]["affected_area_ids"] = ["JP-99"]
    with pytest.raises(ValidationError, match="unknown area ID"):
        ReplayScenario.model_validate(scenario)


def test_official_source_cannot_authorize_osaka_scope_atomically(initial_state):
    osaka = load_registered_scenarios()["osaka-earthquake-v1"]
    event = next(item for item in osaka.events if item.event_type == "official_update").model_dump(mode="json")
    event["source_key"] = "jma-replay"
    with pytest.raises(ValueError, match="source registry does not authorize area JP-27"):
        reduce_raw_event(initial_state, event)
    assert initial_state.evidence == ()
    assert initial_state.plans == ()


def test_official_verified_update_cannot_launder_transport_context(initial_state):
    payload = {
        "id": "official-route-launder",
        "event_type": "verified_update",
        "occurred_at": (initial_state.current_time + timedelta(seconds=1)).isoformat(),
        "offset_seconds": 1,
        "label": "test official route",
        "source_key": "jma-replay",
        "published_at": initial_state.current_time.isoformat(),
        "origin": "Shibuya",
        "destination": "Asakusa",
        "origin_area_id": "JP-13-SHIBUYA",
        "destination_area_id": "JP-13-ASAKUSA",
        "mobility_status": "AVAILABLE",
        "claims": [],
        "summary": "synthetic reproduction",
    }

    with pytest.raises(ValueError, match="source registry does not authorize verified route context"):
        reduce_raw_event(initial_state, payload)
    assert initial_state.evidence == ()
    assert initial_state.mobility == ()
    assert initial_state.trace == ()
    assert initial_state.plans == ()


def test_transport_verified_update_cannot_emit_disaster_assessment_claims(initial_state):
    payload = {
        "id": "transport-disaster-launder",
        "event_type": "verified_update",
        "occurred_at": (initial_state.current_time + timedelta(seconds=1)).isoformat(),
        "offset_seconds": 1,
        "label": "test partner disaster assessment",
        "source_key": "transport-replay",
        "published_at": initial_state.current_time.isoformat(),
        "affected_area_ids": ["JP-13"],
        "disaster_assessments": [
            {"area_id": "JP-13", "event_type": "EARTHQUAKE", "level": "L2", "status": "ACTIVE"}
        ],
        "origin": "Shibuya",
        "destination": "Asakusa",
        "origin_area_id": "JP-13-SHIBUYA",
        "destination_area_id": "JP-13-ASAKUSA",
        "mobility_status": "AVAILABLE",
        "claims": [],
        "summary": "synthetic reproduction",
    }

    with pytest.raises(ValueError, match="source registry does not authorize verified disaster assessments"):
        reduce_raw_event(initial_state, payload)
    assert initial_state.evidence == ()
    assert initial_state.mobility == ()
    assert initial_state.trace == ()
    assert initial_state.plans == ()


@pytest.mark.parametrize(
    ("source_key", "route_context", "assessments", "message"),
    [
        (
            "jma-replay",
            {
                "origin": "Shibuya",
                "destination": "Asakusa",
                "origin_area_id": "JP-13-SHIBUYA",
                "destination_area_id": "JP-13-ASAKUSA",
                "mobility_status": "AVAILABLE",
            },
            [],
            "verified route context",
        ),
        (
            "transport-replay",
            {
                "origin": "Shibuya",
                "destination": "Asakusa",
                "origin_area_id": "JP-13-SHIBUYA",
                "destination_area_id": "JP-13-ASAKUSA",
                "mobility_status": "AVAILABLE",
            },
            [
                {"area_id": "JP-13", "event_type": "EARTHQUAKE", "level": "L2", "status": "ACTIVE"}
            ],
            "verified disaster assessments",
        ),
    ],
)
def test_scenario_loader_rejects_verified_update_source_capability_mismatch(
    tmp_path, source_key, route_context, assessments, message
):
    scenario = load_scenario().model_dump(mode="json")
    event = next(item for item in scenario["events"] if item["event_type"] == "verified_update")
    event.update(
        {
            "source_key": source_key,
            **route_context,
            "affected_area_ids": list(dict.fromkeys([*event.get("affected_area_ids", []), "JP-13"])),
            "disaster_assessments": assessments or event.get("disaster_assessments", []),
            "claims": [],
        }
    )
    path = tmp_path / "source-capability-mismatch.json"
    path.write_text(json.dumps(scenario), encoding="utf-8")

    with pytest.raises(ScenarioError, match=message):
        load_scenario(path)


def test_long_area_id_claim_key_survives_full_plan_pipeline_and_dependency_limit(initial_state):
    scenario = load_scenario()
    long_area_id = "a" * 96
    state = replace(
        initial_state,
        profile=initial_state.profile.model_copy(
            update={
                "current_location": initial_state.profile.current_location.model_copy(
                    update={"area_ids": (long_area_id, "JP-13", "JP")}
                )
            }
        ),
        area_catalog=(
            *initial_state.area_catalog,
            AreaDefinition(id=long_area_id, label="Long area identifier", parent_id="JP-13"),
        ),
    )
    alert = next(item for item in scenario.events if item.event_type == "disaster_alert")
    state = reduce_raw_event(state, alert.model_dump(mode="json"))

    official = next(item for item in scenario.events if item.id == "official-update-001").model_dump(
        mode="json"
    )
    official["affected_area_ids"] = ["JP-13", long_area_id]
    official["disaster_assessments"] = [
        {
            "area_id": long_area_id,
            "event_type": "EARTHQUAKE",
            "level": "L2",
            "status": "ACTIVE",
        }
    ]
    official["claims"] = []
    state = reduce_raw_event(state, official)

    current_plan = next(plan for plan in state.plans if plan.id == state.situation.current_plan_id)
    action = next(
        item
        for item in state.plan_actions
        if item.plan_id == current_plan.id and item.category.value == "NOW"
    )
    long_dependency = f"disaster.EARTHQUAKE.{long_area_id}.status"
    assert long_dependency in action.dependency_keys
    assert 96 < len(long_dependency) <= 160

    invalid_action = action.model_dump(mode="json", exclude={"dependency_values"})
    invalid_action["dependency_keys"] = ["k" * 161]
    with pytest.raises(ValidationError, match="160"):
        PlanAction.model_validate(invalid_action)


def test_tokyo_evidence_cannot_start_a_plan_for_an_explicit_osaka_profile(initial_state):
    osaka_seed = load_registered_scenarios()["osaka-earthquake-v1"].profile_seed
    state = replace(
        initial_state,
        profile=initial_state.profile.model_copy(
            update={"current_location": osaka_seed.current_location}
        ),
    )
    tokyo = load_scenario()
    for event_id in ("evt-earthquake-001", "official-update-001"):
        event = next(item for item in tokyo.events if item.id == event_id)
        state = reduce_raw_event(state, event.model_dump(mode="json"))
    assert state.plans == ()
    assert state.situation.current_plan_id is None


def test_stale_typed_assessment_is_unknown_to_claim_projection(initial_state):
    event = next(item for item in load_scenario().events if item.id == "official-update-001").model_dump(mode="json")
    event["published_at"] = "2026-10-04T17:00:00+09:00"
    state = reduce_raw_event(initial_state, event)
    status = next(item for item in state.situation.claim_states if item.key == "disaster.EARTHQUAKE.JP-13.status")
    assert status.status == ClaimStateStatus.UNKNOWN
    assert status.evidence_ids == ("ev_official-update-001",)
    assert state.evidence[-1].freshness_status == "STALE"


def test_typed_osaka_scenario_uses_the_same_safety_core_pipeline():
    from agent_api.storage import ReplayStore
    from seventytwoh_contracts.models import StartReplayRequest

    store = ReplayStore()
    snapshot = store.start(StartReplayRequest(scenario_key="osaka-earthquake-v1"))
    snapshot = store.next(snapshot.replay.id)
    snapshot = store.next(snapshot.replay.id)
    status = next(item for item in snapshot.situation.claim_states if item.key == "disaster.EARTHQUAKE.JP-27.status")
    severity = next(item for item in snapshot.situation.claim_states if item.key == "disaster.EARTHQUAKE.JP-27.severity")
    assert status.status == ClaimStateStatus.VERIFIED and status.value == "ACTIVE"
    assert severity.status == ClaimStateStatus.VERIFIED and severity.value == DisasterSeverityLevel.L2.value
    assert snapshot.replay.scenario_key == "osaka-earthquake-v1"
    assert snapshot.evidence[0].disaster_assessments[0].status == DisasterEventStatus.ACTIVE
    assert snapshot.evidence[0].raw_reference.startswith("replay://osaka-earthquake-v1/")
