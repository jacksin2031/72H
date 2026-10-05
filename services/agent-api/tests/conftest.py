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
from agent_api.scenario import load_scenario


@pytest.fixture
def initial_state() -> CoreState:
    scenario = load_scenario()
    start = datetime(2026, 10, 4, 17, 40, tzinfo=timezone(timedelta(hours=9)))
    profile = UserProfile(
        id="user_fixture",
        preferred_language=Language.TRADITIONAL_CHINESE,
        current_location=Location(
            label="Shibuya", area_ids=("JP-13-SHIBUYA", "JP-13", "JP")
        ),
        accommodation_location=Location(
            label="Asakusa", area_ids=("JP-13-ASAKUSA", "JP-13", "JP")
        ),
        current_destination=Location(
            label="Asakusa", area_ids=("JP-13-ASAKUSA", "JP-13", "JP")
        ),
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
    return CoreState(
        profile=profile,
        situation=situation,
        current_time=start,
        scenario_key=scenario.key,
        area_catalog=scenario.area_catalog,
    )
