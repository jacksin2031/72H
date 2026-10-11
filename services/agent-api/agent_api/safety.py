"""Pure evidence freshness and trusted claim projection rules."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from typing import Mapping

from seventytwoh_contracts.models import (
    Claim,
    ClaimStateStatus,
    DisasterAssessment,
    DisasterEvent,
    DisasterEventStatus,
    DisasterEventType,
    Evidence,
    EvidenceProjection,
    FreshnessStatus,
    Situation,
    SituationClaim,
    TrustStatus,
)

from .live_sources import JMA_TSUNAMI_SOURCE_KEY

TRUSTED_STATUSES = {TrustStatus.VERIFIED_OFFICIAL, TrustStatus.VERIFIED_PARTNER}


def disaster_claim_key(area_id: str, event_type: str, measure: str) -> str:
    if measure not in {"status", "severity"}:
        raise ValueError("unsupported disaster assessment measure")
    return f"disaster.{event_type}.{area_id}.{measure}"


def route_claim_key(origin_area_id: str, destination_area_id: str) -> str:
    route_identity = f"{origin_area_id}>{destination_area_id}".encode("utf-8")
    return f"route.{sha256(route_identity).hexdigest()}"


def claims_from_disaster_assessments(
    assessments: tuple[DisasterAssessment, ...],
) -> tuple[Claim, ...]:
    result: list[Claim] = []
    for assessment in assessments:
        result.append(
            Claim(
                key=disaster_claim_key(
                    assessment.area_id,
                    assessment.event_type.value,
                    "status",
                ),
                value=assessment.status.value,
            )
        )
        if assessment.level is not None:
            result.append(
                Claim(
                    key=disaster_claim_key(
                        assessment.area_id,
                        assessment.event_type.value,
                        "severity",
                    ),
                    value=assessment.level.value,
                )
            )
    return tuple(result)


@dataclass(frozen=True, slots=True)
class SafetyPolicy:
    official_disaster_ttl_seconds: int = 15 * 60
    transport_ttl_seconds: int = 5 * 60
    destination_ttl_seconds: int = 5 * 60
    route_ttl_seconds: int = 5 * 60
    movement_directive_ttl_seconds: int = 5 * 60
    user_report_ttl_seconds: int = 10 * 60
    general_update_ttl_seconds: int = 15 * 60
    movement_directive_source_keys: tuple[str, ...] = ()
    destination_status_source_keys: tuple[str, ...] = ()
    route_status_source_keys: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        for name, value in (
            ("official_disaster_ttl_seconds", self.official_disaster_ttl_seconds),
            ("transport_ttl_seconds", self.transport_ttl_seconds),
            ("destination_ttl_seconds", self.destination_ttl_seconds),
            ("route_ttl_seconds", self.route_ttl_seconds),
            ("movement_directive_ttl_seconds", self.movement_directive_ttl_seconds),
            ("user_report_ttl_seconds", self.user_report_ttl_seconds),
            ("general_update_ttl_seconds", self.general_update_ttl_seconds),
        ):
            if type(value) is not int or not 1 <= value <= 86400:
                raise ValueError(f"{name} must be between 1 and 86400 seconds")
        for name, values in (
            ("movement_directive_source_keys", self.movement_directive_source_keys),
            ("destination_status_source_keys", self.destination_status_source_keys),
            ("route_status_source_keys", self.route_status_source_keys),
        ):
            if (
                not isinstance(values, tuple)
                or len(values) > 32
                or len(values) != len(set(values))
                or any(not isinstance(key, str) or not key or len(key) > 96 for key in values)
            ):
                raise ValueError(f"{name} must be a tuple of up to 32 unique source keys")

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "SafetyPolicy":
        source = environ if environ is not None else os.environ

        def setting(name: str, default: int) -> int:
            raw = source.get(name)
            if raw is None:
                return default
            try:
                return int(raw)
            except ValueError as exc:
                raise ValueError(f"{name} must be an integer number of seconds") from exc

        return cls(
            official_disaster_ttl_seconds=setting(
                "72H_EVIDENCE_TTL_OFFICIAL_SECONDS", 15 * 60
            ),
            transport_ttl_seconds=setting("72H_EVIDENCE_TTL_TRANSPORT_SECONDS", 5 * 60),
            destination_ttl_seconds=setting("72H_EVIDENCE_TTL_DESTINATION_SECONDS", 5 * 60),
            route_ttl_seconds=setting("72H_EVIDENCE_TTL_ROUTE_SECONDS", 5 * 60),
            movement_directive_ttl_seconds=setting(
                "72H_EVIDENCE_TTL_MOVEMENT_DIRECTIVE_SECONDS", 5 * 60
            ),
            user_report_ttl_seconds=setting("72H_EVIDENCE_TTL_USER_REPORT_SECONDS", 10 * 60),
            general_update_ttl_seconds=setting("72H_EVIDENCE_TTL_GENERAL_SECONDS", 15 * 60),
        )

    def ttl_for(self, evidence: Evidence) -> int:
        return self.ttl_for_claim_type(evidence.claim_type.value)

    def ttl_for_claim_type(self, claim_type: str) -> int:
        if claim_type == "DISASTER_STATUS":
            return self.official_disaster_ttl_seconds
        if claim_type == "TRANSPORT_STATUS":
            return self.transport_ttl_seconds
        if claim_type == "DESTINATION_STATUS":
            return self.destination_ttl_seconds
        if claim_type == "ROUTE_STATUS":
            return self.route_ttl_seconds
        if claim_type == "MOVEMENT_DIRECTIVE":
            return self.movement_directive_ttl_seconds
        if claim_type == "USER_REPORT":
            return self.user_report_ttl_seconds
        return self.general_update_ttl_seconds


DEFAULT_POLICY = SafetyPolicy()


def expires_at_for(evidence: Evidence, policy: SafetyPolicy) -> datetime:
    ttl_expiry = evidence.published_at + timedelta(seconds=policy.ttl_for(evidence))
    if evidence.expires_at is not None:
        return min(evidence.expires_at, ttl_expiry)
    return ttl_expiry


def project_evidence(
    evidence: Evidence,
    current_time: datetime,
    policy: SafetyPolicy,
    *,
    conflict: bool = False,
) -> EvidenceProjection:
    if current_time.tzinfo is None or current_time.utcoffset() is None:
        raise ValueError("current_time must be timezone aware")
    if current_time < evidence.published_at:
        raise ValueError("evidence cannot be projected before its published_at")
    expires_at = expires_at_for(evidence, policy)
    age_seconds = int((current_time - evidence.published_at).total_seconds())
    if evidence.freshness_status == FreshnessStatus.UNKNOWN:
        freshness = FreshnessStatus.UNKNOWN
    elif evidence.freshness_status == FreshnessStatus.STALE or current_time >= expires_at:
        freshness = FreshnessStatus.STALE
    else:
        freshness = FreshnessStatus.CURRENT
    eligible_claims = (
        evidence.trust_status in TRUSTED_STATUSES
        and freshness == FreshnessStatus.CURRENT
        and not evidence.conflict
        and not conflict
    )
    return EvidenceProjection(
        evidence_id=evidence.id,
        freshness_status=freshness,
        age_seconds=age_seconds,
        ttl_seconds=policy.ttl_for(evidence),
        expires_at=expires_at,
        conflict=evidence.conflict or conflict,
        eligible_for_claims=eligible_claims,
        eligible_for_high_risk=eligible_claims and not evidence.is_synthetic,
    )


def derive_claim_states(
    previous: Situation,
    evidence: tuple[Evidence, ...],
    current_time: datetime,
    policy: SafetyPolicy,
    *,
    events: tuple[DisasterEvent, ...] = (),
) -> tuple[tuple[SituationClaim, ...], tuple[str, ...], tuple[str, ...]]:
    """Return claim states, the keys in conflict, and evidence IDs in a conflict."""
    projections = {
        item.id: project_evidence(item, current_time, policy)
        for item in evidence
    }
    keys: set[str] = set()
    keys.update(claim.key for item in evidence for claim in item.claims)
    keys.update(item.key for item in previous.claim_states)

    states: list[SituationClaim] = []
    conflict_keys: list[str] = []
    conflicting_evidence_ids: set[str] = set()
    for key in sorted(keys):
        candidates: list[tuple[Evidence, object]] = []
        stale_support: list[str] = []
        for item in evidence:
            claim = next((candidate for candidate in item.claims if candidate.key == key), None)
            if claim is None or item.trust_status not in TRUSTED_STATUSES or item.conflict:
                continue
            projection = projections[item.id]
            if projection.eligible_for_claims:
                candidates.append((item, claim.value))
            elif projection.freshness_status == FreshnessStatus.STALE:
                stale_support.append(item.id)

        if not candidates:
            states.append(
                SituationClaim(
                    key=key,
                    status=ClaimStateStatus.UNKNOWN,
                    value=None,
                    evidence_ids=tuple(sorted(set(stale_support))),
                    updated_at=current_time,
                )
            )
            continue

        latest_published_at = max(item.published_at for item, _ in candidates)
        latest = [(item, value) for item, value in candidates if item.published_at == latest_published_at]
        distinct_values = {(type(value).__name__, value) for _, value in latest}
        latest_ids = tuple(sorted(item.id for item, _ in latest))
        if len(distinct_values) > 1:
            states.append(
                SituationClaim(
                    key=key,
                    status=ClaimStateStatus.CONFLICT,
                    value=None,
                    evidence_ids=latest_ids,
                    updated_at=current_time,
                )
            )
            conflict_keys.append(key)
            conflicting_evidence_ids.update(latest_ids)
        else:
            states.append(
                SituationClaim(
                    key=key,
                    status=ClaimStateStatus.VERIFIED,
                    value=latest[0][1],
                    evidence_ids=latest_ids,
                    updated_at=current_time,
                )
            )

    states, conflict_keys, conflicting_evidence_ids = _aggregate_active_jma_tsunami_claims(
        previous,
        evidence,
        events,
        projections,
        current_time,
        states,
        conflict_keys,
    )
    return tuple(states), tuple(sorted(set(conflict_keys))), tuple(sorted(conflicting_evidence_ids))


def _aggregate_active_jma_tsunami_claims(
    situation: Situation,
    evidence: tuple[Evidence, ...],
    events: tuple[DisasterEvent, ...],
    projections: dict[str, EvidenceProjection],
    current_time: datetime,
    states: list[SituationClaim],
    conflict_keys: list[str],
) -> tuple[list[SituationClaim], list[str], set[str]]:
    """Keep a cancellation for one JMA EventID from resolving another active EventID."""
    active_ids = set(situation.active_event_ids)
    evidence_by_id = {item.id: item for item in evidence}
    active_by_group: dict[str, tuple[DisasterEvent, Evidence]] = {}
    for event in events:
        if (
            event.id not in active_ids
            or event.event_type != DisasterEventType.TSUNAMI
            or event.is_synthetic
            or event.source_class.value != "OFFICIAL"
        ):
            continue
        event_group, separator, _revision = event.id.partition("--")
        if not separator or not event_group.startswith("jma-tsunami-"):
            continue
        evidence_item = evidence_by_id.get(f"ev_{event.id}")
        if evidence_item is None or evidence_item.source_key != JMA_TSUNAMI_SOURCE_KEY:
            continue
        previous = active_by_group.get(event_group)
        previous_evidence = previous[1] if previous is not None else None
        if previous_evidence is None or (
            evidence_item.published_at,
            evidence_item.received_at,
            evidence_item.id,
        ) > (
            previous_evidence.published_at,
            previous_evidence.received_at,
            previous_evidence.id,
        ):
            active_by_group[event_group] = (event, evidence_item)

    if not active_by_group:
        state_by_key = {item.key: item for item in states}
        conflict_ids = {
            evidence_id
            for key in conflict_keys
            if key in state_by_key
            for evidence_id in state_by_key[key].evidence_ids
        }
        return states, conflict_keys, conflict_ids

    groups_by_area: dict[str, list[tuple[DisasterEvent, Evidence]]] = {}
    for event, evidence_item in active_by_group.values():
        for area_id in set(event.affected_area_ids) | set(evidence_item.affected_area_ids):
            groups_by_area.setdefault(area_id, []).append((event, evidence_item))

    state_by_key = {item.key: item for item in states}
    for area_id, groups in groups_by_area.items():
        key = disaster_claim_key(area_id, DisasterEventType.TSUNAMI.value, "status")
        supporting_active: list[str] = []
        supporting_resolved: list[str] = []
        unresolved_support: list[str] = []
        for _event, evidence_item in groups:
            claim = next((item for item in evidence_item.claims if item.key == key), None)
            assessment = next(
                (
                    item for item in evidence_item.disaster_assessments
                    if item.area_id == area_id and item.event_type == DisasterEventType.TSUNAMI
                ),
                None,
            )
            projection = projections.get(evidence_item.id)
            if (
                claim is not None
                and claim.value == DisasterEventStatus.ACTIVE.value
                and assessment is not None
                and assessment.status == DisasterEventStatus.ACTIVE
                and projection is not None
                and projection.eligible_for_claims
            ):
                supporting_active.append(evidence_item.id)
            elif (
                claim is not None
                and claim.value == DisasterEventStatus.RESOLVED.value
                and assessment is not None
                and assessment.status == DisasterEventStatus.RESOLVED
                and projection is not None
                and projection.eligible_for_claims
            ):
                supporting_resolved.append(evidence_item.id)
            else:
                unresolved_support.append(evidence_item.id)

        if supporting_active:
            state_by_key[key] = SituationClaim(
                key=key,
                status=ClaimStateStatus.VERIFIED,
                value=DisasterEventStatus.ACTIVE.value,
                evidence_ids=tuple(sorted(set(supporting_active))),
                updated_at=current_time,
            )
            conflict_keys[:] = [candidate for candidate in conflict_keys if candidate != key]
        elif supporting_resolved and not unresolved_support:
            state_by_key[key] = SituationClaim(
                key=key,
                status=ClaimStateStatus.VERIFIED,
                value=DisasterEventStatus.RESOLVED.value,
                evidence_ids=tuple(sorted(set(supporting_resolved))),
                updated_at=current_time,
            )
        else:
            state_by_key[key] = SituationClaim(
                key=key,
                status=ClaimStateStatus.UNKNOWN,
                value=None,
                evidence_ids=tuple(sorted(set(unresolved_support))),
                updated_at=current_time,
            )

    remaining_conflict_ids = {
        evidence_id
        for key in conflict_keys
        if key in state_by_key
        for evidence_id in state_by_key[key].evidence_ids
    }
    return [state_by_key[key] for key in sorted(state_by_key)], conflict_keys, remaining_conflict_ids


def current_claim_value(state: SituationClaim | None):
    if state is None:
        return ClaimStateStatus.UNKNOWN.value
    if state.status != ClaimStateStatus.VERIFIED:
        return state.status.value
    return state.value
