"""Deterministic distress levels. User reports only make guidance more protective."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from seventytwoh_contracts.models import (
    ClaimStateStatus, DisasterEventStatus, DisasterEventType, DistressLevel, DistressReport,
    DistressStatus, DistressTag, FreshnessStatus, LocationSource, SourceClass, TrustStatus,
    TsunamiWarningClass,
)

from .location_freshness import gps_observation_is_fresh
from .safety import SafetyPolicy, disaster_claim_key
from .state import CoreState

MAX_DISTRESS_REPORTS = 16
MAX_AI_ESCALATIONS = 16
TRIGGER_CLASSES = frozenset({TsunamiWarningClass.MAJOR_WARNING, TsunamiWarningClass.WARNING})
PROTECTIVE_TAGS = frozenset({
    DistressTag.WATER_RISING, DistressTag.TRAPPED, DistressTag.INJURED,
    DistressTag.MOBILITY_LIMITED, DistressTag.WITH_DEPENDENTS, DistressTag.LOST_NO_DESTINATION,
})


# OFFICIAL_STALE may use an older GPS fix than the live trigger (2 min): the person is
# very likely still in the same area, and the result is only protective vertical shelter.
STALE_LOCATION_MAX_AGE = timedelta(minutes=30)
STALE_TRUST = frozenset({TrustStatus.VERIFIED_OFFICIAL, TrustStatus.STALE})
SUPERSEDING_STATUSES = frozenset({DisasterEventStatus.ACTIVE, DisasterEventStatus.RESOLVED})


@dataclass(frozen=True, slots=True)
class TsunamiTrigger:
    evidence_id: str
    area_id: str
    warning_class: TsunamiWarningClass
    arrival_at: datetime | None
    deadline_at: datetime
    synthetic: bool
    published_at: datetime | None = None
    expires_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class StaleTsunamiTrigger:
    evidence_id: str
    area_id: str
    warning_class: TsunamiWarningClass
    published_at: datetime
    expires_at: datetime | None
    synthetic: bool


CRITICAL_TAGS = frozenset({DistressTag.TRAPPED, DistressTag.INJURED, DistressTag.MOBILITY_LIMITED})


def report_ttl(report: DistressReport, policy: SafetyPolicy) -> timedelta:
    critical = any(tag in CRITICAL_TAGS for tag in report.tags)
    return timedelta(seconds=policy.distress_critical_report_ttl_seconds if critical else policy.user_report_ttl_seconds)


def active_distress_reports(state: CoreState, now: datetime, policy: SafetyPolicy) -> tuple[DistressReport, ...]:
    return tuple(r for r in state.distress_reports if r.reported_at <= now < r.reported_at + report_ttl(r, policy))


def _ai_escalated(state: CoreState, now: datetime, policy: SafetyPolicy) -> bool:
    ttl = timedelta(seconds=policy.user_report_ttl_seconds)
    return any(at <= now < at + ttl for at in state.ai_escalations)


def _location_usable(state: CoreState, now: datetime) -> bool:
    location = state.profile.current_location
    if not location.area_ids:
        return False
    if location.source == LocationSource.GPS:
        return gps_observation_is_fresh(location.observed_at, now)
    return location.source == LocationSource.USER_SELECTED


def official_tsunami_trigger(state: CoreState, now: datetime, policy: SafetyPolicy) -> TsunamiTrigger | None:
    if not _location_usable(state, now):
        return None
    user_areas = set(state.profile.current_location.area_ids)
    claims = {item.key: item for item in state.situation.claim_states}
    margin = timedelta(seconds=policy.distress_arrival_margin_seconds)
    best: TsunamiTrigger | None = None
    for evidence in sorted(state.evidence, key=lambda item: item.published_at, reverse=True):
        if (
            evidence.source_class != SourceClass.OFFICIAL
            or evidence.trust_status != TrustStatus.VERIFIED_OFFICIAL
            or evidence.freshness_status != FreshnessStatus.CURRENT
            or evidence.conflict
            or evidence.expires_at is None
            or not (evidence.published_at <= now < evidence.expires_at)
        ):
            continue
        for assessment in evidence.disaster_assessments:
            if (
                assessment.event_type != DisasterEventType.TSUNAMI
                or assessment.status != DisasterEventStatus.ACTIVE
                or assessment.area_id not in user_areas
                or assessment.tsunami_warning_class not in TRIGGER_CLASSES
            ):
                continue
            claim = claims.get(disaster_claim_key(assessment.area_id, "TSUNAMI", "status"))
            if (
                claim is None or claim.status != ClaimStateStatus.VERIFIED
                or claim.value != "ACTIVE" or evidence.id not in claim.evidence_ids
            ):
                continue
            arrival = assessment.arrival_at
            deadline = max(now, arrival - margin) if arrival is not None else now
            candidate = TsunamiTrigger(evidence.id, assessment.area_id, assessment.tsunami_warning_class,
                                       arrival, deadline, evidence.is_synthetic,
                                       evidence.published_at, evidence.expires_at)
            if best is None or candidate.deadline_at < best.deadline_at:
                best = candidate
    return best


def _stale_location_usable(state: CoreState, now: datetime) -> bool:
    location = state.profile.current_location
    if not location.area_ids:
        return False
    if location.source == LocationSource.GPS:
        observed = location.observed_at
        return observed is not None and observed <= now and now - observed <= STALE_LOCATION_MAX_AGE
    return location.source == LocationSource.USER_SELECTED


def official_stale_trigger(state: CoreState, now: datetime, policy: SafetyPolicy) -> StaleTsunamiTrigger | None:
    """The most recent official tsunami status for the user's area is still an ACTIVE warning
    whose TTL has expired (or whose source went stale) and no newer cancellation exists.
    Callers check `official_tsunami_trigger` first; this never authorizes movement."""
    if not _stale_location_usable(state, now):
        return None
    user_areas = set(state.profile.current_location.area_ids)
    latest: dict[str, tuple] = {}
    for evidence in state.evidence:
        if (
            evidence.source_class != SourceClass.OFFICIAL
            or evidence.trust_status not in STALE_TRUST
            or evidence.conflict
            or evidence.published_at > now
        ):
            continue
        for assessment in evidence.disaster_assessments:
            if (
                assessment.event_type != DisasterEventType.TSUNAMI
                or assessment.area_id not in user_areas
                or assessment.status not in SUPERSEDING_STATUSES
            ):
                continue
            previous = latest.get(assessment.area_id)
            if previous is None or evidence.published_at > previous[0].published_at:
                latest[assessment.area_id] = (evidence, assessment)
    best: StaleTsunamiTrigger | None = None
    for area_id, (evidence, assessment) in latest.items():
        if assessment.status != DisasterEventStatus.ACTIVE or assessment.tsunami_warning_class not in TRIGGER_CLASSES:
            continue
        expired = (
            evidence.expires_at is None
            or now >= evidence.expires_at
            or evidence.freshness_status != FreshnessStatus.CURRENT
            or evidence.trust_status != TrustStatus.VERIFIED_OFFICIAL
        )
        if not expired:
            continue
        candidate = StaleTsunamiTrigger(evidence.id, area_id, assessment.tsunami_warning_class,
                                        evidence.published_at, evidence.expires_at, evidence.is_synthetic)
        if best is None or (candidate.published_at, candidate.evidence_id) > (best.published_at, best.evidence_id):
            best = candidate
    return best


def resolve_distress(state: CoreState, now: datetime, policy: SafetyPolicy) -> DistressStatus:
    reports = active_distress_reports(state, now, policy)
    trigger = official_tsunami_trigger(state, now, policy)
    escalated = _ai_escalated(state, now, policy)
    if trigger is not None:
        return DistressStatus(level=DistressLevel.OFFICIAL_TSUNAMI, reports=reports,
                              trigger_evidence_ids=(trigger.evidence_id,), deadline_at=trigger.deadline_at,
                              ai_escalated=escalated, synthetic=trigger.synthetic,
                              warning_class=trigger.warning_class, last_official_at=trigger.published_at,
                              trigger_expires_at=trigger.expires_at)
    stale = official_stale_trigger(state, now, policy)
    if stale is not None:
        return DistressStatus(level=DistressLevel.OFFICIAL_STALE, reports=reports,
                              trigger_evidence_ids=(stale.evidence_id,), ai_escalated=escalated,
                              synthetic=stale.synthetic, warning_class=stale.warning_class,
                              last_official_at=stale.published_at, trigger_expires_at=stale.expires_at)
    protective = any(tag in PROTECTIVE_TAGS for report in reports for tag in report.tags)
    if protective or escalated:
        return DistressStatus(level=DistressLevel.USER_REPORTED, reports=reports, ai_escalated=escalated)
    return DistressStatus(reports=reports)


def distress_signature(state: CoreState, now: datetime, policy: SafetyPolicy) -> tuple:
    """Stable change-detection key. Never include values derived from `now` (e.g. deadline_at):
    those change every tick and would append a new plan version on every clock advance."""
    status = resolve_distress(state, now, policy)
    trigger = official_tsunami_trigger(state, now, policy)
    trigger_key = (trigger.area_id, trigger.warning_class, trigger.arrival_at) if trigger is not None else None
    if trigger is None and status.level == DistressLevel.OFFICIAL_STALE:
        trigger_key = ("STALE", status.warning_class)
    return (status.level, status.trigger_evidence_ids, trigger_key,
            tuple(sorted({tag for report in status.reports for tag in report.tags})),
            status.ai_escalated)


def record_distress_report(state: CoreState, tags, input_mode: str, now: datetime) -> CoreState:
    report = DistressReport(id=f"distress_{len(state.distress_reports) + 1:03d}_{int(now.timestamp())}",
                            tags=tuple(tags), input_mode=input_mode, reported_at=now)
    return replace(state, distress_reports=(*state.distress_reports, report)[-MAX_DISTRESS_REPORTS:])


def record_ai_escalation(state: CoreState, now: datetime) -> CoreState:
    return replace(state, ai_escalations=(*state.ai_escalations, now)[-MAX_AI_ESCALATIONS:])
