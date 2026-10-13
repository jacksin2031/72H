from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from seventytwoh_contracts.models import (
    DisasterAssessment, DisasterEventStatus, DisasterEventType, DistressLevel,
    DistressReport, DistressRequest, DistressStatus, DistressTag, SafeIntentId,
    TsunamiWarningClass,
)

NOW = datetime(2026, 10, 13, 8, 0, tzinfo=timezone.utc)


def test_distress_request_accepts_only_whitelisted_unique_tags():
    request = DistressRequest(tags=(DistressTag.WATER_RISING, DistressTag.TRAPPED), input_mode="BUTTON")
    assert request.tags == (DistressTag.WATER_RISING, DistressTag.TRAPPED)
    with pytest.raises(ValidationError):
        DistressRequest(tags=("GO_TO_SAFE_PLACE",), input_mode="BUTTON")
    with pytest.raises(ValidationError):
        DistressRequest(tags=(DistressTag.TRAPPED, DistressTag.TRAPPED), input_mode="BUTTON")
    with pytest.raises(ValidationError):
        DistressRequest(tags=(), input_mode="BUTTON")


def test_distress_report_is_always_user_reported():
    report = DistressReport(id="distress_001", tags=(DistressTag.INJURED,), input_mode="VOICE", reported_at=NOW)
    assert report.source == "USER_REPORTED"
    with pytest.raises(ValidationError):
        DistressReport(id="d", tags=(DistressTag.INJURED,), input_mode="VOICE", reported_at=NOW, source="OFFICIAL")


def test_tsunami_fields_are_rejected_on_earthquake_assessments():
    ok = DisasterAssessment(area_id="JP-04", event_type=DisasterEventType.TSUNAMI, status=DisasterEventStatus.ACTIVE,
                            tsunami_warning_class=TsunamiWarningClass.MAJOR_WARNING, arrival_at=NOW)
    assert ok.tsunami_warning_class == TsunamiWarningClass.MAJOR_WARNING
    with pytest.raises(ValidationError):
        DisasterAssessment(area_id="JP-04", event_type=DisasterEventType.EARTHQUAKE,
                           status=DisasterEventStatus.ACTIVE, tsunami_warning_class=TsunamiWarningClass.WARNING)


def test_new_intents_and_default_status():
    assert SafeIntentId.SHELTER_IN_PLACE_VERTICAL.value == "shelter_in_place_vertical"
    assert SafeIntentId.TSUNAMI_EVACUATE_NOW.value == "tsunami_evacuate_now"
    status = DistressStatus()
    assert status.level == DistressLevel.NONE and status.reports == () and status.synthetic is False
