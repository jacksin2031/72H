"""Immutable aggregate state consumed by deterministic reducers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from seventytwoh_contracts.models import (
    AreaDefinition,
    DestinationRecord,
    DisasterEvent,
    DistressReport,
    Evidence,
    MobilitySnapshot,
    Plan,
    PlanAction,
    PlanEvaluation,
    RoutePresentation,
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
    last_reconnect_at: datetime | None = None
    official_recovery_ready: bool = True
    events: tuple[DisasterEvent, ...] = ()
    evidence: tuple[Evidence, ...] = ()
    plans: tuple[Plan, ...] = ()
    plan_actions: tuple[PlanAction, ...] = ()
    trace: tuple[TraceEvent, ...] = ()
    mobility: tuple[MobilitySnapshot, ...] = ()
    plan_evaluations: tuple[PlanEvaluation, ...] = ()
    destinations: tuple[DestinationRecord, ...] = ()
    routes: tuple[RoutePresentation, ...] = ()
    distress_reports: tuple[DistressReport, ...] = ()
    ai_escalations: tuple[datetime, ...] = ()
