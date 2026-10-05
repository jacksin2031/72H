"""Validated scenario loading and replay-only source trust registry."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

from pydantic import TypeAdapter
from seventytwoh_contracts.models import (
    AreaDefinition,
    ClaimType,
    DisasterAssessment,
    ReplayEvent,
    ReplayScenario,
    ReplayScenarioOption,
    SourceClass,
    TrustStatus,
    VerifiedUpdateReplayEvent,
)


ReplayEventAdapter = TypeAdapter(ReplayEvent)

# Only these server-owned scenario files are selectable through the API.
SCENARIO_FILE_REGISTRY: Mapping[str, str] = MappingProxyType(
    {
        "tokyo-earthquake-v1": "tokyo-earthquake-v1.json",
        "osaka-earthquake-v1": "osaka-earthquake-v1.json",
    }
)
DEFAULT_SCENARIO_KEY = "tokyo-earthquake-v1"


@dataclass(frozen=True, slots=True)
class SourceRegistration:
    source_name: str
    source_class: SourceClass
    trust_status: TrustStatus
    allowed_claim_type: ClaimType
    allowed_claim_values: Mapping[str, frozenset[str] | None]
    authorized_area_ids: frozenset[str] = frozenset()
    legacy_disaster_area_id: str | None = None
    legacy_route_area_ids: tuple[str, str] | None = None


SIMULATION_SOURCE_REGISTRY: dict[str, SourceRegistration] = {
    "jma-replay": SourceRegistration(
        source_name="JMA (synthetic replay)",
        source_class=SourceClass.OFFICIAL,
        trust_status=TrustStatus.VERIFIED_OFFICIAL,
        allowed_claim_type=ClaimType.DISASTER_STATUS,
        allowed_claim_values=MappingProxyType(
            {
                "disaster.tokyo.status": frozenset({"ACTIVE", "RESOLVED", "UNKNOWN"}),
                "disaster.tokyo.severity": frozenset({"L0", "L1", "L2", "L3", "L4"}),
            }
        ),
        authorized_area_ids=frozenset({"JP-13"}),
        legacy_disaster_area_id="JP-13",
    ),
    "transport-replay": SourceRegistration(
        source_name="Transport provider (synthetic replay)",
        source_class=SourceClass.PARTNER,
        trust_status=TrustStatus.VERIFIED_PARTNER,
        allowed_claim_type=ClaimType.TRANSPORT_STATUS,
        allowed_claim_values=MappingProxyType(
            {"route.shibuya_asakusa.status": frozenset({"AVAILABLE", "DISRUPTED", "UNKNOWN"})}
        ),
        authorized_area_ids=frozenset({"JP-13"}),
        legacy_route_area_ids=("JP-13-SHIBUYA", "JP-13-ASAKUSA"),
    ),
    "osaka-jma-replay": SourceRegistration(
        source_name="Osaka JMA (synthetic replay)",
        source_class=SourceClass.OFFICIAL,
        trust_status=TrustStatus.VERIFIED_OFFICIAL,
        allowed_claim_type=ClaimType.DISASTER_STATUS,
        allowed_claim_values=MappingProxyType({}),
        authorized_area_ids=frozenset({"JP-27"}),
    ),
    "social-replay": SourceRegistration(
        source_name="Social media (synthetic replay)",
        source_class=SourceClass.SOCIAL_MEDIA,
        trust_status=TrustStatus.UNVERIFIED,
        allowed_claim_type=ClaimType.USER_REPORT,
        allowed_claim_values=MappingProxyType({"unverified.content": None}),
    ),
}


class ScenarioError(ValueError):
    """The scenario file is missing or violates its canonical contract."""


def load_scenario(path: Path | None = None) -> ReplayScenario:
    default_file = SCENARIO_FILE_REGISTRY[DEFAULT_SCENARIO_KEY]
    scenario_path = path or Path(__file__).resolve().parents[3] / "scenarios" / default_file
    try:
        raw = json.loads(scenario_path.read_text(encoding="utf-8"))
        scenario = ReplayScenario.model_validate(raw)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ScenarioError(f"could not load replay scenario: {exc}") from exc

    for event in scenario.events:
        source_key = getattr(event, "source_key", None)
        if source_key is not None and source_key not in SIMULATION_SOURCE_REGISTRY:
            raise ScenarioError(f"event {event.id} references an unregistered source")
        if source_key is not None:
            registration = SIMULATION_SOURCE_REGISTRY[source_key]
            catalog = {area.id: area for area in scenario.area_catalog}
            if not registration.authorized_area_ids.issubset(catalog):
                raise ScenarioError(f"source {source_key} references an area outside the scenario catalog")
            for area_id in _event_area_ids(event):
                if registration.trust_status in {TrustStatus.VERIFIED_OFFICIAL, TrustStatus.VERIFIED_PARTNER}:
                    if not source_authorizes_area(registration, area_id, catalog):
                        raise ScenarioError(f"source {source_key} is not authorized for area {area_id}")
            if isinstance(event, VerifiedUpdateReplayEvent):
                if _has_route_context(event) and not source_authorizes_transport(registration):
                    raise ScenarioError(
                        f"source {source_key} does not authorize verified route context for event {event.id}"
                    )
                if event.disaster_assessments and not source_authorizes_disaster_assessments(registration):
                    raise ScenarioError(
                        f"source {source_key} does not authorize verified disaster assessments for event {event.id}"
                    )
            for assessment in getattr(event, "disaster_assessments", ()):
                if not source_authorizes_disaster_assessments(registration) or not source_authorizes_area(
                    registration, assessment.area_id, catalog
                ):
                    raise ScenarioError(f"source {source_key} is not authorized for disaster assessment area {assessment.area_id}")
    return scenario


def load_registered_scenarios() -> dict[str, ReplayScenario]:
    """Load only the static server-owned scenario registry, never caller paths."""
    scenario_dir = Path(__file__).resolve().parents[3] / "scenarios"
    scenarios: dict[str, ReplayScenario] = {}
    for key, filename in SCENARIO_FILE_REGISTRY.items():
        scenario = load_scenario(scenario_dir / filename)
        if scenario.key != key:
            raise ScenarioError(f"registered scenario file {filename} has an unexpected key")
        scenarios[key] = scenario
    return scenarios


def scenario_options(scenarios: Mapping[str, ReplayScenario]) -> tuple[ReplayScenarioOption, ...]:
    return tuple(
        ReplayScenarioOption(key=scenario.key, name=scenario.name)
        for scenario in sorted(scenarios.values(), key=lambda item: item.key)
    )


def _event_area_ids(event: ReplayEvent) -> set[str]:
    ids = set(getattr(event, "affected_area_ids", ()))
    ids.update(item.area_id for item in getattr(event, "disaster_assessments", ()))
    for field in ("origin_area_id", "destination_area_id"):
        area_id = getattr(event, field, None)
        if area_id:
            ids.add(area_id)
    return ids


def area_ancestry(area_id: str, catalog: Mapping[str, AreaDefinition]) -> tuple[str, ...]:
    result: list[str] = []
    current = catalog.get(area_id)
    while current is not None:
        result.append(current.id)
        current = catalog.get(current.parent_id) if current.parent_id is not None else None
    return tuple(result)


def source_authorizes_area(
    registration: SourceRegistration,
    area_id: str,
    catalog: Mapping[str, AreaDefinition],
) -> bool:
    """A source's server-owned authorized area may cover descendants through explicit ancestry."""
    return bool(set(area_ancestry(area_id, catalog)) & registration.authorized_area_ids)


def source_authorizes_transport(registration: SourceRegistration) -> bool:
    return (
        registration.source_class == SourceClass.PARTNER
        and registration.trust_status == TrustStatus.VERIFIED_PARTNER
        and registration.allowed_claim_type == ClaimType.TRANSPORT_STATUS
    )


def source_authorizes_disaster_assessments(registration: SourceRegistration) -> bool:
    return (
        registration.source_class == SourceClass.OFFICIAL
        and registration.trust_status == TrustStatus.VERIFIED_OFFICIAL
        and registration.allowed_claim_type == ClaimType.DISASTER_STATUS
    )


def _has_route_context(event: ReplayEvent) -> bool:
    return any(
        getattr(event, field, None) is not None
        for field in (
            "origin",
            "destination",
            "origin_area_id",
            "destination_area_id",
            "mobility_status",
        )
    )


def timeline_event(event: ReplayEvent):
    from seventytwoh_contracts.models import ReplayTimelineEvent

    return ReplayTimelineEvent(
        id=event.id,
        event_type=event.event_type,
        occurred_at=event.occurred_at,
        offset_seconds=event.offset_seconds,
        label=event.label,
    )
