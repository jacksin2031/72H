"""Validated scenario loading and replay-only source trust registry."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Mapping

from pydantic import TypeAdapter
from seventytwoh_contracts.models import (
    ClaimType,
    ReplayEvent,
    ReplayScenario,
    SourceClass,
    TrustStatus,
)


ReplayEventAdapter = TypeAdapter(ReplayEvent)


@dataclass(frozen=True, slots=True)
class SourceRegistration:
    source_name: str
    source_class: SourceClass
    trust_status: TrustStatus
    allowed_claim_type: ClaimType
    allowed_claim_values: Mapping[str, frozenset[str] | None]


SIMULATION_SOURCE_REGISTRY: dict[str, SourceRegistration] = {
    "jma-replay": SourceRegistration(
        source_name="JMA (synthetic replay)",
        source_class=SourceClass.OFFICIAL,
        trust_status=TrustStatus.VERIFIED_OFFICIAL,
        allowed_claim_type=ClaimType.DISASTER_STATUS,
        allowed_claim_values=MappingProxyType(
            {"disaster.tokyo.status": frozenset({"ACTIVE", "RESOLVED", "UNKNOWN"})}
        ),
    ),
    "transport-replay": SourceRegistration(
        source_name="Transport provider (synthetic replay)",
        source_class=SourceClass.PARTNER,
        trust_status=TrustStatus.VERIFIED_PARTNER,
        allowed_claim_type=ClaimType.TRANSPORT_STATUS,
        allowed_claim_values=MappingProxyType(
            {"route.shibuya_asakusa.status": frozenset({"AVAILABLE", "DISRUPTED", "UNKNOWN"})}
        ),
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
    scenario_path = path or Path(__file__).resolve().parents[3] / "scenarios" / "tokyo-earthquake-v1.json"
    try:
        raw = json.loads(scenario_path.read_text(encoding="utf-8"))
        scenario = ReplayScenario.model_validate(raw)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ScenarioError(f"could not load replay scenario: {exc}") from exc

    for event in scenario.events:
        source_key = getattr(event, "source_key", None)
        if source_key is not None and source_key not in SIMULATION_SOURCE_REGISTRY:
            raise ScenarioError(f"event {event.id} references an unregistered source")
    return scenario


def timeline_event(event: ReplayEvent):
    from seventytwoh_contracts.models import ReplayTimelineEvent

    return ReplayTimelineEvent(
        id=event.id,
        event_type=event.event_type,
        occurred_at=event.occurred_at,
        offset_seconds=event.offset_seconds,
        label=event.label,
    )
