"""Bounded, synthetic-only exercise feeder into the real Replay/Safety/ADK path.

No public input is ever interpreted as an official Live report. Only server-owned
schema-checked template events and enumerated modifications may enter a drill.
"""
from __future__ import annotations

from datetime import timedelta
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from seventytwoh_contracts.models import ReplayScenario

from .scenario import load_scenario


class DrillRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["EARTHQUAKE"] = "EARTHQUAKE"
    severity: Literal[0, 1, 2, 3, 4] = 2
    battery: int | None = Field(default=60, ge=0, le=100)
    network: Literal["ONLINE", "OFFLINE", "RECONNECTING"] = "ONLINE"
    evidence: Literal["FRESH", "STALE", "UNKNOWN"] = "FRESH"
    mobility: Literal["ABLE", "CANNOT_MOVE"] = "ABLE"
    language: Literal["ja", "en", "zh-TW"] = "zh-TW"


def compile_drill(request: DrillRequest) -> ReplayScenario:
    """Compile an allowlisted earthquake feed, not an arbitrary JSON/API payload."""
    base = load_scenario()
    raw = base.model_dump(mode="json")
    raw["key"] = "drill-earthquake-v1"
    raw["name"] = "Earthquake agent exercise (synthetic)"
    raw["description"] = "SIMULATION ONLY. Emulated official/transport API data; never live."
    start = base.start_time
    # Replay v1 has only EARTHQUAKE assessments. Do not misrepresent other hazards.
    by_type = {event["event_type"]: event for event in raw["events"] if event["event_type"] in ("disaster_alert", "official_update", "transport_update", "network_lost", "network_restored")}
    alert = dict(by_type["disaster_alert"], id="drill-alert", label="SYNTHETIC earthquake API event",
                 severity_raw=f"SYNTHETIC_L{request.severity}")
    alert["summary"] = f"DRILL ONLY: earthquake L{request.severity}; no real event or authority."
    alert["occurred_at"] = (start + timedelta(seconds=10)).isoformat()
    alert["offset_seconds"] = 10
    official = dict(by_type["official_update"], id="drill-official", label="Emulated JMA typed report")
    official["claims"] = [{"key": "disaster.tokyo.severity", "value": f"L{request.severity}"},
                          {"key": "disaster.tokyo.status", "value": "ACTIVE"}]
    official["disaster_assessments"] = [{"area_id": "JP-13", "event_type": "EARTHQUAKE",
                                         "level": f"L{request.severity}", "status": "ACTIVE"}]
    official["occurred_at"] = (start + timedelta(seconds=25)).isoformat()
    official["published_at"] = (start + timedelta(seconds=20 if request.evidence == "FRESH" else -3600)).isoformat()
    official["offset_seconds"] = 25
    official["summary"] = f"DRILL ONLY: emulated earthquake L{request.severity} feed. Synthetic source, not JMA."
    transport = dict(by_type["transport_update"], id="drill-transport", label="Emulated transport provider disruption")
    transport["occurred_at"] = (start + timedelta(seconds=40)).isoformat()
    transport["published_at"] = (start + timedelta(seconds=37)).isoformat()
    transport["offset_seconds"] = 40
    transport["summary"] = "DRILL ONLY: emulated transport route disruption."
    events = [alert]
    if request.evidence != "UNKNOWN":
        events.append(official)
    events.append(transport)
    if request.network != "ONLINE":
        lost = dict(by_type["network_lost"], id="drill-network-lost", label="Simulated API/network outage")
        lost["occurred_at"] = (start + timedelta(seconds=60)).isoformat()
        lost["offset_seconds"] = 60
        events.append(lost)
        if request.network == "RECONNECTING":
            restored = dict(by_type["network_restored"], id="drill-network-restored", label="Simulated reconnection without fresh evidence")
            restored["occurred_at"] = (start + timedelta(seconds=75)).isoformat()
            restored["offset_seconds"] = 75
            events.append(restored)
    if request.mobility == "CANNOT_MOVE":
        raw["profile_seed"]["self_reported_safety_status"] = "NEEDS_ASSISTANCE"
        raw["profile_seed"]["accessibility_constraints"] = ["MOBILITY_SUPPORT"]
    # Server-owned context is conveyed through validated profile, typed evidence
    # and network transitions. Battery is a separate UI/power-policy input.
    raw["events"] = events
    scenario = ReplayScenario.model_validate(raw)
    assert all(event.event_type in {"disaster_alert", "official_update", "transport_update", "network_lost", "network_restored"} for event in scenario.events)
    return scenario
