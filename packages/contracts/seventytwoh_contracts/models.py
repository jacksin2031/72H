"""Strict, immutable Pydantic contracts for the 72H Phase 1 domain."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, TypeAlias, Union
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    computed_field,
    model_validator,
)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        validate_default=True,
    )


ShortText = Annotated[StrictStr, Field(min_length=1, max_length=240)]
LongText = Annotated[StrictStr, Field(min_length=1, max_length=1200)]
Identifier = Annotated[StrictStr, Field(min_length=1, max_length=96)]
ClaimKey = Annotated[StrictStr, Field(min_length=1, max_length=160)]
AreaList = Annotated[tuple[ShortText, ...], Field(max_length=20)]
StringList = Annotated[tuple[Identifier, ...], Field(max_length=64)]
JsonPrimitive: TypeAlias = Union[StrictStr, StrictInt, StrictFloat, StrictBool]


class Language(StrEnum):
    JAPANESE = "ja"
    ENGLISH = "en"
    TRADITIONAL_CHINESE = "zh-TW"


class SelfReportedSafetyStatus(StrEnum):
    SAFE = "SAFE"
    UNCERTAIN = "UNCERTAIN"
    NEEDS_ASSISTANCE = "NEEDS_ASSISTANCE"
    UNKNOWN = "UNKNOWN"


class SourceClass(StrEnum):
    OFFICIAL = "OFFICIAL"
    PARTNER = "PARTNER"
    USER_REPORT = "USER_REPORT"
    SOCIAL_MEDIA = "SOCIAL_MEDIA"
    OTHER = "OTHER"


class TrustStatus(StrEnum):
    VERIFIED_OFFICIAL = "VERIFIED_OFFICIAL"
    VERIFIED_PARTNER = "VERIFIED_PARTNER"
    UNVERIFIED = "UNVERIFIED"
    CONFLICTING = "CONFLICTING"
    STALE = "STALE"
    REJECTED = "REJECTED"


class FreshnessStatus(StrEnum):
    CURRENT = "CURRENT"
    STALE = "STALE"
    UNKNOWN = "UNKNOWN"


class ClaimType(StrEnum):
    DISASTER_STATUS = "DISASTER_STATUS"
    TRANSPORT_STATUS = "TRANSPORT_STATUS"
    USER_REPORT = "USER_REPORT"
    GENERAL_UPDATE = "GENERAL_UPDATE"


class MobilityStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    DISRUPTED = "DISRUPTED"
    UNKNOWN = "UNKNOWN"


class NetworkState(StrEnum):
    ONLINE_VERIFIED = "ONLINE_VERIFIED"
    ONLINE_DEGRADED = "ONLINE_DEGRADED"
    OFFLINE_RECENT = "OFFLINE_RECENT"
    OFFLINE_STALE = "OFFLINE_STALE"
    RECONNECTING = "RECONNECTING"


class IncidentStatus(StrEnum):
    IDLE = "IDLE"
    EVENT_DETECTED = "EVENT_DETECTED"
    ASSESSING = "ASSESSING"
    PLAN_ACTIVE = "PLAN_ACTIVE"
    MONITORING = "MONITORING"
    CHANGE_DETECTED = "CHANGE_DETECTED"
    PLAN_REVIEW = "PLAN_REVIEW"
    PLAN_INVALIDATED = "PLAN_INVALIDATED"
    REPLANNING = "REPLANNING"
    WAITING_FOR_EVIDENCE = "WAITING_FOR_EVIDENCE"
    OFFLINE_CONTINUITY = "OFFLINE_CONTINUITY"


class DisasterEventType(StrEnum):
    EARTHQUAKE = "EARTHQUAKE"


class DisasterEventStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    UNKNOWN = "UNKNOWN"


class DisasterSeverityLevel(StrEnum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"
    L4 = "L4"


class PlanStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    PARTIALLY_INVALID = "PARTIALLY_INVALID"
    INVALIDATED = "INVALIDATED"
    EXPIRED = "EXPIRED"
    SUPERSEDED = "SUPERSEDED"


class PlanActionCategory(StrEnum):
    NOW = "NOW"
    NEXT = "NEXT"
    AVOID = "AVOID"


class SafeIntentId(StrEnum):
    """Closed server-owned intent catalog; model output cannot supply prose or risk."""

    PROTECT_AND_MONITOR = "protect_and_monitor"
    REVIEW_OFFICIAL_GUIDANCE = "review_official_guidance"
    WAIT_FOR_TRANSPORT_UPDATE = "wait_for_transport_update"
    RECHECK_TRANSPORT_STATUS = "recheck_transport_status"
    AVOID_DISRUPTED_ROUTE = "avoid_disrupted_route"
    DO_NOT_ASSUME_ROUTE_SAFETY = "do_not_assume_route_safety"


class RiskLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class PlanActionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INVALID = "INVALID"
    EXPIRED = "EXPIRED"
    BLOCKED = "BLOCKED"
    SUPERSEDED = "SUPERSEDED"


class SafetyDecision(StrEnum):
    ALLOW = "ALLOW"
    MODIFY = "MODIFY"
    BLOCK = "BLOCK"
    WAIT_FOR_EVIDENCE = "WAIT_FOR_EVIDENCE"


class PlanEvaluationStatus(StrEnum):
    KEEP = "KEEP"
    PARTIAL_INVALIDATION = "PARTIAL_INVALIDATION"
    INVALIDATED = "INVALIDATED"
    EXPIRED = "EXPIRED"


class ClaimStateStatus(StrEnum):
    VERIFIED = "VERIFIED"
    UNKNOWN = "UNKNOWN"
    CONFLICT = "CONFLICT"


class AgentName(StrEnum):
    SITUATION_AGENT = "SITUATION_AGENT"
    SOURCE_AGENT = "SOURCE_AGENT"
    MOBILITY_AGENT = "MOBILITY_AGENT"
    ACTION_AGENT = "ACTION_AGENT"
    SAFETY_CORE = "SAFETY_CORE"
    REPLAY_ENGINE = "REPLAY_ENGINE"
    OFFLINE_ENGINE = "OFFLINE_ENGINE"
    SYNC_ENGINE = "SYNC_ENGINE"


class TraceStatus(StrEnum):
    SUCCESS = "SUCCESS"
    REJECTED = "REJECTED"
    FAILED = "FAILED"
    NOOP = "NOOP"


class ReplayStatus(StrEnum):
    READY = "READY"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    RESET = "RESET"


class AreaDefinition(ContractModel):
    id: Identifier
    label: ShortText
    parent_id: Identifier | None = None


class Location(ContractModel):
    label: ShortText
    lat: Annotated[StrictFloat, Field(ge=-90, le=90)] | None = None
    lng: Annotated[StrictFloat, Field(ge=-180, le=180)] | None = None
    area_ids: StringList = ()
    observed_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def coordinates_are_paired_and_area_path_is_unique(self) -> "Location":
        if (self.lat is None) != (self.lng is None):
            raise ValueError("lat and lng must both be provided or both be null")
        if len(self.area_ids) != len(set(self.area_ids)):
            raise ValueError("area_ids must be unique and ordered from specific area to ancestors")
        return self


class ProfileSeed(ContractModel):
    current_location: Location
    accommodation_location: Location
    current_destination: Location | None = None
    party_size: Annotated[StrictInt, Field(ge=1, le=20)] = 1
    self_reported_safety_status: SelfReportedSafetyStatus = SelfReportedSafetyStatus.UNKNOWN
    current_plan_summary: Annotated[StrictStr, Field(max_length=240)] = ""
    accessibility_constraints: Annotated[tuple[ShortText, ...], Field(max_length=32)] = ()


class DisasterAssessment(ContractModel):
    area_id: Identifier
    event_type: DisasterEventType
    level: DisasterSeverityLevel | None = None
    status: DisasterEventStatus


class UserProfile(ContractModel):
    id: Identifier
    preferred_language: Language
    current_location: Location
    accommodation_location: Location
    current_destination: Location | None = None
    party_size: Annotated[StrictInt, Field(ge=1, le=20)]
    self_reported_safety_status: SelfReportedSafetyStatus
    current_plan_summary: Annotated[StrictStr, Field(max_length=240)] = ""
    accessibility_constraints: Annotated[tuple[ShortText, ...], Field(max_length=32)] = ()
    created_at: AwareDatetime
    updated_at: AwareDatetime


class Claim(ContractModel):
    key: ClaimKey
    value: JsonPrimitive


class DisasterEvent(ContractModel):
    id: Identifier
    situation_id: Identifier
    event_type: DisasterEventType
    occurred_at: AwareDatetime
    received_at: AwareDatetime
    affected_areas: AreaList
    affected_area_ids: StringList = ()
    source_name: ShortText
    source_class: SourceClass
    severity_raw: Annotated[StrictStr, Field(min_length=1, max_length=80)]
    status: DisasterEventStatus
    raw_reference: Annotated[StrictStr, Field(min_length=1, max_length=300)]
    is_synthetic: StrictBool

    @model_validator(mode="after")
    def receipt_follows_occurrence(self) -> "DisasterEvent":
        if self.received_at < self.occurred_at:
            raise ValueError("received_at cannot be earlier than occurred_at")
        return self


class Evidence(ContractModel):
    id: Identifier
    situation_id: Identifier
    source_name: ShortText
    source_class: SourceClass
    trust_status: TrustStatus
    freshness_status: FreshnessStatus
    published_at: AwareDatetime
    received_at: AwareDatetime
    expires_at: AwareDatetime | None = None
    relevant_areas: AreaList
    affected_area_ids: StringList = ()
    disaster_assessments: Annotated[tuple[DisasterAssessment, ...], Field(max_length=64)] = ()
    claim_type: ClaimType
    claims: Annotated[tuple[Claim, ...], Field(max_length=64)]
    summary: LongText
    conflict_group: ShortText | None = None
    conflict: StrictBool = False
    raw_reference: Annotated[StrictStr, Field(min_length=1, max_length=300)]
    is_synthetic: StrictBool

    @model_validator(mode="after")
    def evidence_times_are_ordered(self) -> "Evidence":
        if self.received_at < self.published_at:
            raise ValueError("received_at cannot be earlier than published_at")
        if self.expires_at is not None and self.expires_at <= self.published_at:
            raise ValueError("expires_at must be later than published_at")
        claim_keys = [claim.key for claim in self.claims]
        if len(claim_keys) != len(set(claim_keys)):
            raise ValueError("claim keys must be unique within evidence")
        assessment_scopes = [(item.area_id, item.event_type) for item in self.disaster_assessments]
        if len(assessment_scopes) != len(set(assessment_scopes)):
            raise ValueError("disaster assessment areas and event types must be unique within evidence")
        if not {item.area_id for item in self.disaster_assessments}.issubset(self.affected_area_ids):
            raise ValueError("every disaster assessment area must be explicitly affected by its evidence")
        return self

    @computed_field
    @property
    def eligible_for_high_risk(self) -> bool:
        """Synthetic replay evidence is never authorization for real-world action."""
        return (
            not self.is_synthetic
            and self.trust_status in {TrustStatus.VERIFIED_OFFICIAL, TrustStatus.VERIFIED_PARTNER}
            and self.freshness_status == FreshnessStatus.CURRENT
            and not self.conflict
        )


class Situation(ContractModel):
    id: Identifier
    user_id: Identifier
    incident_status: IncidentStatus
    network_state: NetworkState
    active_event_ids: StringList = ()
    current_plan_id: Identifier | None = None
    latest_evidence_at: AwareDatetime | None = None
    uncertainty_flags: Annotated[tuple[ShortText, ...], Field(max_length=64)] = ()
    conflict_flags: Annotated[tuple[ShortText, ...], Field(max_length=64)] = ()
    claim_states: Annotated[tuple["SituationClaim", ...], Field(max_length=128)] = ()
    created_at: AwareDatetime
    updated_at: AwareDatetime


class SituationClaim(ContractModel):
    key: ClaimKey
    status: ClaimStateStatus
    value: JsonPrimitive | None = None
    evidence_ids: StringList = ()
    updated_at: AwareDatetime


class EvidenceProjection(ContractModel):
    evidence_id: Identifier
    freshness_status: FreshnessStatus
    age_seconds: Annotated[StrictInt, Field(ge=0, le=31536000)]
    ttl_seconds: Annotated[StrictInt, Field(ge=1, le=86400)]
    expires_at: AwareDatetime
    conflict: StrictBool
    eligible_for_claims: StrictBool
    eligible_for_high_risk: StrictBool


class DependencyExpectation(ContractModel):
    key: ClaimKey
    expected_value: JsonPrimitive


class Plan(ContractModel):
    id: Identifier
    situation_id: Identifier
    version: Annotated[StrictInt, Field(ge=1, le=10000)]
    status: PlanStatus
    created_at: AwareDatetime
    expires_at: AwareDatetime
    invalidate_on_new_relevant_evidence: StrictBool
    based_on_evidence_ids: StringList
    previous_plan_id: Identifier | None = None
    invalidation_reason: Annotated[StrictStr, Field(max_length=500)] | None = None
    changed_action_ids: StringList = ()
    language: Language

    @model_validator(mode="after")
    def expiration_follows_creation(self) -> "Plan":
        if self.expires_at <= self.created_at:
            raise ValueError("expires_at must be later than created_at")
        return self


class PlanAction(ContractModel):
    id: Identifier
    plan_id: Identifier
    category: PlanActionCategory
    intent_id: SafeIntentId | None = None
    text: LongText
    reason: LongText
    risk_level: RiskLevel
    confidence_class: Literal["HIGH", "MEDIUM", "LOW", "UNKNOWN"] = "UNKNOWN"
    evidence_ids: StringList
    dependency_keys: Annotated[tuple[ClaimKey, ...], Field(max_length=64)] = ()
    dependency_expectations: Annotated[tuple[DependencyExpectation, ...], Field(max_length=64)] = ()
    status: PlanActionStatus
    safety_decision: SafetyDecision

    @computed_field
    @property
    def dependency_values(self) -> dict[str, JsonPrimitive]:
        """Expose expected dependency values as a UI-friendly object."""
        return {item.key: item.expected_value for item in self.dependency_expectations}

    @model_validator(mode="after")
    def dependency_expectations_are_unique(self) -> "PlanAction":
        keys = [item.key for item in self.dependency_expectations]
        if len(keys) != len(set(keys)):
            raise ValueError("dependency expectation keys must be unique")
        if not set(keys).issubset(set(self.dependency_keys)):
            raise ValueError("dependency expectations must refer to declared dependency keys")
        return self


class CandidateActionSelection(ContractModel):
    """The only model-controlled plan fields: a known intent and evidence refs."""

    category: PlanActionCategory
    intent_id: SafeIntentId
    evidence_ids: StringList = ()


class CandidatePlanSelection(ContractModel):
    choices: Annotated[tuple[CandidateActionSelection, ...], Field(min_length=1, max_length=3)]

    @model_validator(mode="after")
    def categories_are_unique(self) -> "CandidatePlanSelection":
        categories = [choice.category for choice in self.choices]
        if len(categories) != len(set(categories)):
            raise ValueError("candidate categories must be unique")
        return self


class PlanEvaluation(ContractModel):
    plan_id: Identifier
    status: PlanEvaluationStatus
    evaluated_at: AwareDatetime
    reason: ShortText
    invalid_action_ids: StringList = ()


class MobilitySnapshot(ContractModel):
    id: Identifier
    situation_id: Identifier
    origin: ShortText
    destination: ShortText
    origin_area_id: Identifier | None = None
    destination_area_id: Identifier | None = None
    status: MobilityStatus
    candidate_routes: Annotated[tuple[ShortText, ...], Field(max_length=32)] = ()
    evidence_ids: StringList
    checked_at: AwareDatetime
    expires_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def expiry_follows_check(self) -> "MobilitySnapshot":
        if self.expires_at is not None and self.expires_at <= self.checked_at:
            raise ValueError("expires_at must be later than checked_at")
        return self


class TraceEvent(ContractModel):
    id: Identifier
    situation_id: Identifier
    timestamp: AwareDatetime
    agent: AgentName
    event_type: Annotated[StrictStr, Field(min_length=1, max_length=80)]
    input_refs: StringList = ()
    output_refs: StringList = ()
    status: TraceStatus
    public_summary: ShortText


class ReplayEventBase(ContractModel):
    id: Annotated[StrictStr, Field(min_length=1, max_length=72)]
    occurred_at: AwareDatetime
    offset_seconds: Annotated[StrictInt, Field(ge=0, le=86400)]
    label: ShortText


class DisasterAlertReplayEvent(ReplayEventBase):
    event_type: Literal["disaster_alert"]
    source_key: Literal["jma-replay", "osaka-jma-replay"]
    disaster_type: DisasterEventType
    affected_areas: AreaList
    affected_area_ids: StringList = ()
    severity_raw: Annotated[StrictStr, Field(min_length=1, max_length=80)]
    summary: ShortText


class OfficialUpdateReplayEvent(ReplayEventBase):
    event_type: Literal["official_update"]
    source_key: Literal["jma-replay", "osaka-jma-replay"]
    published_at: AwareDatetime
    affected_areas: AreaList
    affected_area_ids: StringList = ()
    disaster_assessments: Annotated[tuple[DisasterAssessment, ...], Field(max_length=64)] = ()
    claims: Annotated[tuple[Claim, ...], Field(max_length=64)] = ()
    summary: LongText

    @model_validator(mode="after")
    def update_has_a_typed_or_legacy_claim(self) -> "OfficialUpdateReplayEvent":
        if not self.claims and not self.disaster_assessments:
            raise ValueError("official update must contain claims or disaster assessments")
        if not {item.area_id for item in self.disaster_assessments}.issubset(self.affected_area_ids):
            raise ValueError("every disaster assessment area must be explicitly affected by the update")
        return self

    @model_validator(mode="after")
    def claim_keys_are_unique(self) -> "OfficialUpdateReplayEvent":
        if len({item.key for item in self.claims}) != len(self.claims):
            raise ValueError("claim keys must be unique within an event")
        return self

    @model_validator(mode="after")
    def published_before_reception(self) -> "OfficialUpdateReplayEvent":
        if self.published_at > self.occurred_at:
            raise ValueError("published_at cannot be later than occurred_at")
        return self


class TransportUpdateReplayEvent(ReplayEventBase):
    event_type: Literal["transport_update"]
    source_key: Literal["transport-replay"]
    published_at: AwareDatetime
    origin: ShortText
    destination: ShortText
    origin_area_id: Identifier | None = None
    destination_area_id: Identifier | None = None
    mobility_status: MobilityStatus
    claims: Annotated[tuple[Claim, ...], Field(min_length=1, max_length=64)]
    summary: LongText

    @model_validator(mode="after")
    def route_area_ids_are_paired(self) -> "TransportUpdateReplayEvent":
        if (self.origin_area_id is None) != (self.destination_area_id is None):
            raise ValueError("origin_area_id and destination_area_id must both be provided or both be null")
        return self

    @model_validator(mode="after")
    def published_before_reception(self) -> "TransportUpdateReplayEvent":
        if self.published_at > self.occurred_at:
            raise ValueError("published_at cannot be later than occurred_at")
        return self


class UnverifiedReportReplayEvent(ReplayEventBase):
    event_type: Literal["unverified_report"]
    source_key: Literal["social-replay"]
    published_at: AwareDatetime
    affected_areas: AreaList
    affected_area_ids: StringList = ()
    content: Annotated[StrictStr, Field(min_length=1, max_length=1000)]
    summary: LongText

    @model_validator(mode="after")
    def published_before_reception(self) -> "UnverifiedReportReplayEvent":
        if self.published_at > self.occurred_at:
            raise ValueError("published_at cannot be later than occurred_at")
        return self


class NetworkDegradedReplayEvent(ReplayEventBase):
    event_type: Literal["network_degraded"]


class NetworkLostReplayEvent(ReplayEventBase):
    event_type: Literal["network_lost"]


class NetworkRestoredReplayEvent(ReplayEventBase):
    event_type: Literal["network_restored"]


class VerifiedUpdateReplayEvent(ReplayEventBase):
    event_type: Literal["verified_update"]
    source_key: Literal["jma-replay", "osaka-jma-replay", "transport-replay"]
    published_at: AwareDatetime
    affected_areas: AreaList = ()
    affected_area_ids: StringList = ()
    disaster_assessments: Annotated[tuple[DisasterAssessment, ...], Field(max_length=64)] = ()
    origin: ShortText | None = None
    destination: ShortText | None = None
    origin_area_id: Identifier | None = None
    destination_area_id: Identifier | None = None
    mobility_status: MobilityStatus | None = None
    claims: Annotated[tuple[Claim, ...], Field(max_length=64)] = ()
    summary: LongText

    @model_validator(mode="after")
    def transport_claim_has_mobility_context(self) -> "VerifiedUpdateReplayEvent":
        if self.source_key == "transport-replay" and not (self.origin and self.destination and self.mobility_status):
            raise ValueError("transport verified updates require origin, destination, and mobility_status")
        if (self.origin_area_id is None) != (self.destination_area_id is None):
            raise ValueError("origin_area_id and destination_area_id must both be provided or both be null")
        if not {item.area_id for item in self.disaster_assessments}.issubset(self.affected_area_ids):
            raise ValueError("every disaster assessment area must be explicitly affected by the update")
        if self.published_at > self.occurred_at:
            raise ValueError("published_at cannot be later than occurred_at")
        if not self.claims and not self.disaster_assessments and self.mobility_status is None:
            raise ValueError("verified update must contain typed status or legacy claims")
        if len({item.key for item in self.claims}) != len(self.claims):
            raise ValueError("claim keys must be unique within an event")
        return self


class PlanExpirationReplayEvent(ReplayEventBase):
    event_type: Literal["plan_expiration"]
    plan_id: Identifier


class ClockTickReplayEvent(ReplayEventBase):
    event_type: Literal["clock_tick"]


ReplayEvent: TypeAlias = Annotated[
    Union[
        DisasterAlertReplayEvent,
        OfficialUpdateReplayEvent,
        TransportUpdateReplayEvent,
        UnverifiedReportReplayEvent,
        NetworkDegradedReplayEvent,
        NetworkLostReplayEvent,
        NetworkRestoredReplayEvent,
        VerifiedUpdateReplayEvent,
        PlanExpirationReplayEvent,
        ClockTickReplayEvent,
    ],
    Field(discriminator="event_type"),
]


class ReplayTimelineEvent(ContractModel):
    id: Identifier
    event_type: Annotated[StrictStr, Field(min_length=1, max_length=80)]
    occurred_at: AwareDatetime
    offset_seconds: Annotated[StrictInt, Field(ge=0, le=86400)]
    label: ShortText


class ReplayScenario(ContractModel):
    key: Identifier
    name: ShortText
    description: ShortText
    mode: Literal["SYNTHETIC_REPLAY"]
    start_time: AwareDatetime
    area_catalog: Annotated[tuple[AreaDefinition, ...], Field(min_length=1, max_length=512)]
    profile_seed: ProfileSeed
    events: Annotated[tuple[ReplayEvent, ...], Field(min_length=1, max_length=64)]

    @model_validator(mode="after")
    def event_ids_and_timing_are_deterministic(self) -> "ReplayScenario":
        ids = [event.id for event in self.events]
        if len(ids) != len(set(ids)):
            raise ValueError("scenario event IDs must be unique")
        offsets = [event.offset_seconds for event in self.events]
        if offsets != sorted(offsets):
            raise ValueError("scenario event offsets must be in non-decreasing order")
        times = [event.occurred_at for event in self.events]
        if times != sorted(times):
            raise ValueError("scenario event timestamps must be in non-decreasing order")
        area_by_id = {item.id: item for item in self.area_catalog}
        if len(area_by_id) != len(self.area_catalog):
            raise ValueError("area catalog IDs must be unique")
        for area in self.area_catalog:
            if area.parent_id is not None and area.parent_id not in area_by_id:
                raise ValueError(f"area {area.id} references an unknown parent")
            visited = {area.id}
            parent_id = area.parent_id
            while parent_id is not None:
                if parent_id in visited:
                    raise ValueError("area catalog ancestry must not contain cycles")
                visited.add(parent_id)
                parent_id = area_by_id[parent_id].parent_id
        for location in (
            self.profile_seed.current_location,
            self.profile_seed.accommodation_location,
            self.profile_seed.current_destination,
        ):
            if location is not None:
                validate_location_area_path(location, area_by_id)
        for event in self.events:
            area_ids = set(getattr(event, "affected_area_ids", ()))
            area_ids.update(item.area_id for item in getattr(event, "disaster_assessments", ()))
            if getattr(event, "origin_area_id", None):
                area_ids.add(event.origin_area_id)
            if getattr(event, "destination_area_id", None):
                area_ids.add(event.destination_area_id)
            if not area_ids.issubset(area_by_id):
                raise ValueError("scenario event references an unknown area ID")
        return self


def validate_location_area_path(location: Location, area_by_id: dict[str, AreaDefinition]) -> None:
    """Validate caller-supplied location ancestry; labels and coordinates never resolve IDs."""
    path = location.area_ids
    if not path:
        return
    if any(area_id not in area_by_id for area_id in path):
        raise ValueError("location references an unknown area ID")
    if any(area_by_id[current].parent_id != parent for current, parent in zip(path, path[1:])):
        raise ValueError("location area_ids must be a contiguous specific-to-ancestor path")
    if area_by_id[path[-1]].parent_id is not None:
        raise ValueError("location area_ids must include the complete catalog ancestry")


class ReplaySession(ContractModel):
    id: UUID
    scenario_key: Identifier
    status: ReplayStatus
    speed: Literal[1, 2, 4]
    started_at: AwareDatetime
    current_time: AwareDatetime
    current_event_index: Annotated[StrictInt, Field(ge=0, le=64)]
    deterministic_seed: Identifier
    situation_id: Identifier
    mode: Literal["SYNTHETIC_REPLAY"]
    mode_label: ShortText
    planning_mode: Literal["DETERMINISTIC_REPLAY_ONLY", "GEMINI_ADK", "GEMINI_ADK_FALLBACK"]
    next_event_delay_seconds: Annotated[StrictFloat, Field(ge=0)] | None = None


class ReplaySnapshot(ContractModel):
    profile: UserProfile
    area_catalog: Annotated[tuple[AreaDefinition, ...], Field(max_length=512)] = ()
    situation: Situation
    events: Annotated[tuple[DisasterEvent, ...], Field(max_length=64)]
    evidence: Annotated[tuple[Evidence, ...], Field(max_length=128)]
    plans: Annotated[tuple[Plan, ...], Field(max_length=128)]
    plan_actions: Annotated[tuple[PlanAction, ...], Field(max_length=512)]
    trace: Annotated[tuple[TraceEvent, ...], Field(max_length=512)]
    replay: ReplaySession
    scenario_events: Annotated[tuple[ReplayTimelineEvent, ...], Field(max_length=64)]
    evidence_projections: Annotated[tuple[EvidenceProjection, ...], Field(max_length=128)]
    mobility: Annotated[tuple[MobilitySnapshot, ...], Field(max_length=128)]
    plan_evaluations: Annotated[tuple[PlanEvaluation, ...], Field(max_length=512)]


class ReplayScenarioOption(ContractModel):
    key: Identifier
    name: ShortText


class StartReplayRequest(ContractModel):
    language: Language = Language.TRADITIONAL_CHINESE
    scenario_key: Identifier | None = None
    profile: ProfileSeed | None = None


class SpeedRequest(ContractModel):
    speed: Literal[1, 2, 4]


class PlanAppendRequest(ContractModel):
    plan: Plan
    actions: Annotated[tuple[PlanAction, ...], Field(max_length=128)] = ()

    @model_validator(mode="after")
    def actions_belong_to_plan(self) -> "PlanAppendRequest":
        if any(action.plan_id != self.plan.id for action in self.actions):
            raise ValueError("every action must reference the appended plan")
        return self


class ApiVersion(ContractModel):
    service: Literal["72h-agent-api"]
    version: ShortText
    phase: Literal["phase-3"]
