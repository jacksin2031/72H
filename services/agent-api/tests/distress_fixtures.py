from dataclasses import replace
from datetime import datetime, timedelta

from agent_api.safety import disaster_claim_key
from agent_api.storage import ReplayStore
from seventytwoh_contracts.models import (
    ClaimStateStatus, DisasterAssessment, DisasterEventStatus, DisasterEventType,
    FreshnessStatus, LocationSource, SourceClass, TrustStatus, TsunamiWarningClass,
)


def base_state(now: datetime, *, gps_observed_at: datetime | None = None, source=LocationSource.GPS):
    """A real replay CoreState relocated to Miyagi (JP-04) with a fresh GPS fix."""
    store = ReplayStore()
    snapshot = store.start()
    state = store._get_aggregate(snapshot.replay.id).state
    location = state.profile.current_location.model_copy(update={
        "label": "石巻", "lat": 38.4334, "lng": 141.3037, "area_ids": ("JP-04", "JP"),
        "observed_at": gps_observed_at or now, "source": source,
    })
    profile = state.profile.model_copy(update={"current_location": location})
    return replace(state, profile=profile, current_time=now, evidence=(), events=(), plans=(), plan_actions=())


def tsunami_evidence(state, warning_class, arrival_at, *, freshness=FreshnessStatus.CURRENT,
                     trust=TrustStatus.VERIFIED_OFFICIAL, area_id="JP-04"):
    from agent_api.live_sources import JMA_TSUNAMI_SOURCE_NAME
    from seventytwoh_contracts.models import Evidence
    template = Evidence.model_validate({
        "id": "ev_jma-tsunami-test", "situation_id": state.situation.id, "source_key": "jma-tsunami",
        "source_name": JMA_TSUNAMI_SOURCE_NAME, "source_class": SourceClass.OFFICIAL, "trust_status": trust,
        "freshness_status": freshness, "published_at": state.current_time, "received_at": state.current_time,
        "expires_at": state.current_time + timedelta(hours=1), "relevant_areas": ("宮城県",),
        "affected_area_ids": (area_id,),
        "disaster_assessments": (DisasterAssessment(area_id=area_id, event_type=DisasterEventType.TSUNAMI,
            status=DisasterEventStatus.ACTIVE, tsunami_warning_class=warning_class, arrival_at=arrival_at),),
        "claim_type": "DISASTER_STATUS", "claims": ({"key": disaster_claim_key(area_id, "TSUNAMI", "status"), "value": "ACTIVE"},),
        "summary": "test tsunami", "raw_reference": "https://www.data.jma.go.jp/test", "is_synthetic": False,
    })
    return replace(state, evidence=(*state.evidence, template))


def with_claim(state, *, status=ClaimStateStatus.VERIFIED):
    from seventytwoh_contracts.models import SituationClaim
    evidence = state.evidence[-1]
    area_id = evidence.affected_area_ids[0]
    claim = SituationClaim(key=disaster_claim_key(area_id, "TSUNAMI", "status"), status=status, value="ACTIVE",
                           evidence_ids=(evidence.id,), updated_at=state.current_time)
    situation = state.situation.model_copy(update={"claim_states": (claim,)})
    return replace(state, situation=situation)
