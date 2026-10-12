"""Validated official bulletin identity and pure, product-independent lifecycle.

JMA's 2026 header table overrides guide 2.1.3 for earthquake/tsunami:
Title + Status + EventID combination identify a unit, even after office failover.
Control.DateTime orders its bulletins. Serial is retained, never used to order.
Cancellation withdraws that information unit, not the underlying disaster.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from hashlib import sha256
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StrictStr, model_validator
from seventytwoh_contracts.models import ContractModel


class BulletinOperation(StrEnum):
    ISSUE = "ISSUE"
    CANCEL = "CANCEL"


class BulletinValidity(StrEnum):
    CURRENT = "CURRENT"
    STALE = "STALE"
    CANCELLED = "CANCELLED"
    CONFLICT = "CONFLICT"


class OfficialBulletin(ContractModel):
    schema_version: Literal[1] = 1
    parser_version: Literal["jma-lifecycle-v1"] = "jma-lifecycle-v1"
    product: Literal["VXSE53", "VTSE41"]
    info_kind_version: Literal["1.0_1"]
    code_mapping_version: Literal["72h-jma-code-projection-v1"] = "72h-jma-code-projection-v1"
    title: Annotated[StrictStr, Field(min_length=1, max_length=80)]
    editorial_office: Annotated[StrictStr, Field(min_length=1, max_length=80)]
    publishing_office: Annotated[StrictStr, Field(min_length=1, max_length=160)]
    status: Literal["通常"]
    event_id: Annotated[StrictStr, Field(min_length=1, max_length=512, pattern=r"^[A-Za-z0-9_ -]+$")]
    serial: Annotated[StrictStr, Field(max_length=16)] | None = None
    operation: BulletinOperation
    issued_at: AwareDatetime  # Control.DateTime: bulletin ordering, including revisions
    reported_at: AwareDatetime  # Head.ReportDateTime: business announcement time
    target_at: AwareDatetime | None = None
    valid_until: AwareDatetime | None = None  # Only when officially provided
    occurred_at: AwareDatetime | None = None
    occurrence_times: Annotated[tuple[AwareDatetime, ...], Field(max_length=8)] = ()
    received_at: AwareDatetime
    reference_url: Annotated[StrictStr, Field(min_length=1, max_length=300)]
    raw_sha256: Annotated[StrictStr, Field(pattern=r"^[0-9a-f]{64}$")]
    target_codes: Annotated[tuple[Annotated[StrictStr, Field(min_length=1, max_length=32)], ...], Field(max_length=128)] = ()

    @model_validator(mode="after")
    def validate_source_times_and_url(self):
        from urllib.parse import urlparse

        url = urlparse(self.reference_url)
        if (
            url.scheme != "https" or url.netloc != "www.data.jma.go.jp"
            or not url.path.startswith("/developer/xml/data/") or url.query or url.fragment
        ):
            raise ValueError("official bulletin detail URL is outside the allowlisted host/path")
        if self.issued_at > self.received_at or self.reported_at > self.received_at:
            raise ValueError("official bulletin publication time is in the future")
        if self.reported_at > self.issued_at:
            raise ValueError("business announcement follows system publication")
        if self.occurred_at is not None and self.occurred_at > self.reported_at:
            raise ValueError("official occurrence follows announcement")
        if any(item > self.reported_at for item in self.occurrence_times):
            raise ValueError("official occurrence follows announcement")
        if self.valid_until is not None and self.valid_until <= self.reported_at:
            raise ValueError("invalid official validity interval")
        if self.valid_until is not None and self.product == "VXSE53":
            raise ValueError("VXSE53 does not provide ValidDateTime")
        import re
        event_ids = self.event_id.split()
        if not 1 <= len(event_ids) <= 8 or len(set(event_ids)) != len(event_ids) or any(not re.fullmatch(r"\d{14}", item) for item in event_ids):
            raise ValueError("official earthquake identifiers must be unique 14-digit numbers")
        if self.product == "VXSE53" and (len(event_ids) != 1 or self.serial is None or not re.fullmatch(r"[1-9]\d{0,15}", self.serial)):
            raise ValueError("invalid VXSE53 event identifier or serial")
        if self.product == "VTSE41" and self.serial is not None:
            raise ValueError("VTSE41 does not use serial numbers")
        if self.editorial_office not in {"気象庁本庁", "大阪管区気象台"} or self.publishing_office != "気象庁":
            raise ValueError("unsupported JMA earthquake/tsunami publishing office")
        return self

    @property
    def group_id(self) -> str:
        # Exact EventID combination: no partial matches between compound units.
        # Retain office provenance while permitting the documented failover.
        import json

        key = json.dumps(
            (self.product, self.title, self.status, tuple(sorted(self.event_id.split()))),
            ensure_ascii=False, separators=(",", ":"),
        )
        return sha256(key.encode()).hexdigest()[:24]

    @property
    def report_id(self) -> str:
        return f"{self.group_id}--{self.raw_sha256[:24]}"


@dataclass(frozen=True, slots=True)
class OfficialEventState:
    head: OfficialBulletin
    history: tuple[OfficialBulletin, ...]
    conflict: bool = False

    def validity(self, now: datetime, ttl_seconds: int) -> BulletinValidity:
        if self.conflict:
            return BulletinValidity.CONFLICT
        # Cancel is retained as a tombstone even after its evidence TTL expires.
        # It cannot support a statement that an area is now safe.
        if self.head.operation == BulletinOperation.CANCEL:
            return BulletinValidity.CANCELLED
        deadline = self.head.issued_at + timedelta(seconds=ttl_seconds)
        if self.head.valid_until is not None:
            deadline = min(deadline, self.head.valid_until)
        return BulletinValidity.STALE if now >= deadline else BulletinValidity.CURRENT


def reduce_official_bulletin(
    previous: OfficialEventState | None, incoming: OfficialBulletin,
) -> OfficialEventState:
    """No IO/clock mutation. Conflicts persist until a strictly newer bulletin."""
    if previous is None:
        return OfficialEventState(incoming, (incoming,))
    if previous.head.group_id != incoming.group_id:
        raise ValueError("cannot reduce different official information units")
    if any(item.raw_sha256 == incoming.raw_sha256 for item in previous.history):
        return previous  # Retrieval cannot refresh times or clear a conflict.
    if len(previous.history) >= 256:
        raise ValueError("official bulletin history limit reached; reconciliation required")
    history = (*previous.history, incoming)
    if incoming.issued_at < previous.head.issued_at:
        return OfficialEventState(previous.head, history, previous.conflict)
    if incoming.issued_at == previous.head.issued_at:
        return OfficialEventState(previous.head, history, True)
    return OfficialEventState(incoming, history)



def official_event_group(event_identity: str) -> str | None:
    """Internal event projection identity, including pre-lifecycle quake IDs.

    Keep unmigrated legacy units separate while waiting for their own fresh proof.
    This legacy key does not replace the source envelope's richer group identity.
    """
    import re

    group, separator, _revision = event_identity.partition("--")
    if separator and group.startswith(("jma-tsunami-", "jma-earthquake-")):
        return group
    legacy = re.fullmatch(r"(jma-\d{14})-[A-Za-z0-9_-]+", event_identity)
    return legacy.group(1) if legacy else None
