from datetime import datetime, timedelta, timezone

import pytest
from seventytwoh_contracts.models import (
    IncidentStatus,
    NetworkState,
    Situation,
    UserProfile,
    Language,
    Location,
)

from agent_api.domain import CoreState


@pytest.fixture
def initial_state() -> CoreState:
    start = datetime(2026, 10, 4, 17, 40, tzinfo=timezone(timedelta(hours=9)))
    profile = UserProfile(
        id="user_fixture",
        preferred_language=Language.TRADITIONAL_CHINESE,
        current_location=Location(label="Shibuya"),
        accommodation_location=Location(label="Asakusa"),
        current_destination=Location(label="Asakusa"),
        party_size=1,
        self_reported_safety_status="SAFE",
        current_plan_summary="Return to Asakusa at 18:00",
        created_at=start,
        updated_at=start,
    )
    situation = Situation(
        id="sit_fixture",
        user_id=profile.id,
        incident_status=IncidentStatus.IDLE,
        network_state=NetworkState.ONLINE_VERIFIED,
        created_at=start,
        updated_at=start,
    )
    return CoreState(profile=profile, situation=situation, current_time=start)
