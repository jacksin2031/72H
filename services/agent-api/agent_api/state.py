"""Immutable aggregate state consumed by deterministic reducers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from seventytwoh_contracts.models import (
    AreaDefinition,
    DisasterEvent,
    Evidence,
    MobilitySnapshot,
    Plan,
    PlanAction,
    PlanEvaluation,
    Situation,
    TraceEvent,
    UserProfile,
)


@dataclass(frozen=True, slots=True)
class CoreState:
    profile: UserProfile
    situation: Situation
    current_time: datetime
    scenario_key: str = ""
    area_catalog: tuple[AreaDefinition, ...] = ()
    reconnect_evidence_count: int | None = None
    events: tuple[DisasterEvent, ...] = ()
    evidence: tuple[Evidence, ...] = ()
    plans: tuple[Plan, ...] = ()
    plan_actions: tuple[PlanAction, ...] = ()
    trace: tuple[TraceEvent, ...] = ()
    mobility: tuple[MobilitySnapshot, ...] = ()
    plan_evaluations: tuple[PlanEvaluation, ...] = ()
