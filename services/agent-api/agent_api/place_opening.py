"""Replaceable municipal opening boundary. No municipal feed is configured by default.

The catalog and this read-only projection do not enter Safety Core evidence or
authorize movement. Adapters must provide an independently reviewed exact GSI-ID
crosswalk and source scope; a name/coordinate similarity is insufficient.
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal, Protocol
from urllib.parse import urlparse

from pydantic import AwareDatetime, Field, StrictStr, model_validator
from seventytwoh_contracts.models import ContractModel, DestinationOpenStatus, Identifier

AreaId = Annotated[StrictStr, Field(pattern=r'^JP-MUNI-\d{5}$')]
SourceUrl = Annotated[StrictStr, Field(min_length=1,max_length=500)]


class OpeningAuthority(ContractModel):
    source_key: Identifier
    area_id: AreaId
    source_url: SourceUrl
    destination_ids: Annotated[tuple[Identifier,...],Field(min_length=1,max_length=512)]
    reviewed_at: AwareDatetime
    review_due_at: AwareDatetime

    @model_validator(mode='after')
    def review_and_url(self):
        url=urlparse(self.source_url)
        if url.scheme!='https' or not url.hostname or url.username or url.password or url.fragment:
            raise ValueError('Opening authority requires a reviewed HTTPS URL')
        if self.review_due_at<=self.reviewed_at or len(set(self.destination_ids))!=len(self.destination_ids):
            raise ValueError('Invalid opening authority review/crosswalk')
        return self


class OpeningObservation(ContractModel):
    id: Identifier
    destination_id: Identifier
    area_id: AreaId
    source_key: Identifier
    source_url: SourceUrl
    status: DestinationOpenStatus
    published_at: AwareDatetime
    received_at: AwareDatetime
    valid_until: AwareDatetime
    restrictions: Annotated[tuple[Annotated[StrictStr,Field(min_length=1,max_length=500)],...],Field(max_length=16)]=()

    @model_validator(mode='after')
    def clocks(self):
        if self.valid_until<=self.published_at or self.received_at<self.published_at:
            raise ValueError('Invalid opening observation clocks')
        return self


class PlaceOpeningRecord(ContractModel):
    destination_id: Identifier
    status: DestinationOpenStatus
    reason: Literal['VERIFIED','STALE','CONFLICT','AUTHORITY_REVIEW_EXPIRED','SOURCE_UNKNOWN']
    source_key: Identifier
    source_url: SourceUrl
    published_at: AwareDatetime
    received_at: AwareDatetime
    expires_at: AwareDatetime
    evidence_ids: Annotated[tuple[Identifier,...],Field(max_length=64)]
    restrictions: Annotated[tuple[Annotated[StrictStr,Field(min_length=1,max_length=500)],...],Field(max_length=16)]
    safe_location_verified: Literal[False]=False
    route_authorized: Literal[False]=False


class PlaceOpeningResponse(ContractModel):
    mode: Literal['LIVE_REFERENCE']='LIVE_REFERENCE'
    area_id: AreaId
    generated_at: AwareDatetime
    fetched_at: AwareDatetime | None=None
    source_status: Literal['UNCONFIGURED','AVAILABLE','FAILED']
    records: Annotated[tuple[PlaceOpeningRecord,...],Field(max_length=512)]=()
    authority: Literal['REFERENCE_ONLY']='REFERENCE_ONLY'
    safe_location_verified: Literal[False]=False
    route_authorized: Literal[False]=False


def project_opening(authority: OpeningAuthority, observations: tuple[OpeningObservation,...], now: datetime) -> tuple[PlaceOpeningRecord,...]:
    if now.tzinfo is None or not isinstance(observations,tuple) or len(observations)>512:
        raise ValueError('Opening batch time/capacity invalid')
    # Validate again even if a caller used model_copy without validation.
    authority=OpeningAuthority.model_validate(authority.model_dump())
    grouped: dict[str,list[OpeningObservation]]={}
    for raw in observations:
        if not isinstance(raw,OpeningObservation):
            raise ValueError('Opening adapter must supply validated observations')
        observation=OpeningObservation.model_validate(raw.model_dump())
        if (observation.source_key!=authority.source_key or observation.source_url!=authority.source_url
            or observation.area_id!=authority.area_id or observation.destination_id not in authority.destination_ids
            or observation.published_at>now or observation.received_at>now):
            raise ValueError('Opening authority/scope/identity/time mismatch')
        grouped.setdefault(observation.destination_id,[]).append(observation)
    result=[]
    for destination_id, reports in sorted(grouped.items()):
        newest=max(o.published_at for o in reports)
        heads=[o for o in reports if o.published_at==newest]
        if len(heads)>64:
            raise ValueError('Opening evidence capacity exceeded')
        first=heads[0]
        expiry=min(min(o.valid_until,o.published_at+timedelta(seconds=300)) for o in heads)
        # Same-time status or restrictions disagreement cannot become OPEN.
        conflict=len({(o.status,o.restrictions) for o in heads})>1 or len({o.id for o in heads})!=len(heads)
        reason=('AUTHORITY_REVIEW_EXPIRED' if not authority.reviewed_at<=now<authority.review_due_at else
            'CONFLICT' if conflict else 'STALE' if now>=expiry else
            'SOURCE_UNKNOWN' if first.status==DestinationOpenStatus.UNKNOWN else 'VERIFIED')
        result.append(PlaceOpeningRecord(destination_id=destination_id,
            status=first.status if reason=='VERIFIED' else DestinationOpenStatus.UNKNOWN,reason=reason,
            source_key=authority.source_key,source_url=authority.source_url,published_at=newest,
            received_at=max(o.received_at for o in heads),expires_at=expiry,
            evidence_ids=tuple(sorted({o.id for o in heads})),restrictions=first.restrictions))
    return tuple(result)


class OpeningAdapter(Protocol):
    authority: OpeningAuthority
    def fetch(self,now: datetime) -> tuple[OpeningObservation,...]: ...


class PlaceOpeningStore:
    """No stale fallback or environment-provided arbitrary URL ingestion."""
    def __init__(self, *, adapters: dict[str,OpeningAdapter] | None=None, clock=None):
        self.adapters=dict(adapters or {})
        self.clock=clock or (lambda:datetime.now(timezone.utc))

    def get(self, partition: str) -> PlaceOpeningResponse:
        if partition not in {'04202'}:
            raise KeyError(partition)
        now=self.clock(); area=f'JP-MUNI-{partition}'; adapter=self.adapters.get(partition)
        if adapter is None:
            return PlaceOpeningResponse(area_id=area,generated_at=now,source_status='UNCONFIGURED')
        try:
            if adapter.authority.area_id!=area:
                raise ValueError('Opening partition mismatch')
            records=project_opening(adapter.authority,adapter.fetch(now),now)
            return PlaceOpeningResponse(area_id=area,generated_at=now,fetched_at=now,source_status='AVAILABLE',records=records)
        except (ValueError, OSError, TimeoutError):
            return PlaceOpeningResponse(area_id=area,generated_at=now,source_status='FAILED')
