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
    Evidence,
    EvidenceProjection,
    FreshnessStatus,
    Situation,
    SituationClaim,
    TrustStatus,
)

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
    user_report_ttl_seconds: int = 10 * 60
    general_update_ttl_seconds: int = 15 * 60

    def __post_init__(self) -> None:
        for name, value in (
            ("official_disaster_ttl_seconds", self.official_disaster_ttl_seconds),
            ("transport_ttl_seconds", self.transport_ttl_seconds),
            ("user_report_ttl_seconds", self.user_report_ttl_seconds),
            ("general_update_ttl_seconds", self.general_update_ttl_seconds),
        ):
            if type(value) is not int or not 1 <= value <= 86400:
                raise ValueError(f"{name} must be between 1 and 86400 seconds")

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

    return (
        tuple(states),
        tuple(conflict_keys),
        tuple(sorted(conflicting_evidence_ids)),
    )


def current_claim_value(state: SituationClaim | None):
    if state is None:
        return ClaimStateStatus.UNKNOWN.value
    if state.status != ClaimStateStatus.VERIFIED:
        return state.status.value
    return state.value
