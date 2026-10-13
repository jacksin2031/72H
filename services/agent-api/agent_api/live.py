"""Isolated live sessions backed by server-owned source adapters."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import re
from threading import RLock
from time import monotonic
from types import SimpleNamespace
from uuid import UUID, uuid4

from seventytwoh_contracts.models import (
    DistressLevel,
    DistressRequest,
    AgentName,
    AreaDefinition,
    Claim,
    ClaimType,
    Coordinate,
    DestinationEligibility,
    DestinationOpenStatus,
    DestinationProjection,
    DisasterAssessment,
    DisasterEvent,
    DisasterEventStatus,
    DisasterEventType,
    Evidence,
    FreshnessStatus,
    IncidentStatus,
    Language,
    LiveLocationUpdateRequest,
    LiveProfileUpdateRequest,
    LiveSnapshot,
    LiveSourceProjection,
    OfficialReportReference,
    LiveSourceStatus,
    NetworkState,
    Location,
    LocationSource,
    PlanActionStatus,
    PlanStatus,
    ProfileSeed,
    RoutePresentation,
    RoutePresentationStatus,
    Situation,
    SpatialActionKind,
    SpatialGuidanceProjection,
    SourceClass,
    StartLiveRequest,
    TsunamiAreaStatus,
    TsunamiWarningClass,
    TsunamiOperation,
    TsunamiReferenceResponse,
    TraceEvent,
    TraceStatus,
    TrustStatus,
    UserProfile,
    validate_location_area_path,
)

from .domain import apply_live_evidence_batch, replan_live_transition
from .area_registry import base_japan_area_catalog, catalog_for_state, load_japan_area_registry
from .live_sources import (
    JMA_EVIDENCE_TTL_SECONDS,
    JMA_FEED_URL,
    JMA_SOURCE_KEY,
    JMA_SOURCE_NAME,
    JMA_PREFECTURES,
    JMA_TSUNAMI_SOURCE_KEY,
    JMA_TSUNAMI_SOURCE_NAME,
    JmaTsunamiBulletin,
    JmaTsunamiSource,
    JmaTsunamiFetchResult,
    TOKYO_SHELTER_PUBLISHED_AT,
    TOKYO_SHELTER_SOURCE_KEY,
    TOKYO_SHELTER_SOURCE_NAME,
    TOKYO_SHELTER_URL,
    JmaEarthquakeReport,
    JmaEarthquakeSource,
    jma_status_at_publication_deadline,
    jma_report_deadline,
    tsunami_reference_from_result,
    TokyoShelterSource,
)
from .planning import evidence_projections
from .distress import resolve_distress
from .location_freshness import gps_observation_is_fresh
from .safety import DEFAULT_POLICY, SafetyPolicy, claims_from_disaster_assessments, derive_claim_states
from .state import CoreState
from .official_events import OfficialBulletin
from .live_routes import EKISPERT_MCP_ENDPOINT, EKISPERT_ROUTE_SOURCE_KEY, EKISPERT_ROUTE_SOURCE_NAME, EkispertRouteSource
from .planner import CandidatePlanner
from .spatial import evaluated_spatial_guidance

SESSION_TTL_SECONDS = 6 * 60 * 60
MAX_LIVE_SESSIONS = 64
MAX_LIVE_EVENTS = 64
MAX_LIVE_TRACE_EVENTS = 512


class LiveSessionNotFound(KeyError):
    pass


class LiveSessionCapacityReached(RuntimeError):
    pass


class InvalidLiveProfile(ValueError):
    pass


class InvalidLiveRouteRequest(ValueError):
    pass


class InvalidLiveLocationRequest(ValueError):
    pass


class InvalidLiveProfileUpdate(ValueError):
    pass


class _UnsupportedTsunamiSource:
    """Avoid external tsunami HTTP when a synthetic/test earthquake source is injected."""

    def __init__(self, now) -> None:
        self._now = now

    def fetch_latest(self) -> JmaTsunamiFetchResult:
        return JmaTsunamiFetchResult(
            status=LiveSourceStatus.UNSUPPORTED,
            retrieved_at=self._now(),
            last_published_at=None,
            next_retry_at=None,
            operation=TsunamiOperation.UNKNOWN,
            serial=None,
            bulletins=(),
            forecast_areas=(),
            conflict=False,
            detail="Tsunami source is not configured for an injected earthquake source.",
        )


@dataclass(slots=True)
class LiveAggregate:
    session_id: UUID
    state: CoreState
    source: LiveSourceProjection
    destination_source: LiveSourceProjection
    route_source: LiveSourceProjection
    expires_at: float
    official_reports: tuple[OfficialReportReference, ...] = ()
    tsunami_source: LiveSourceProjection | None = None
    tsunami_deadlines: tuple[datetime, ...] = ()
    lock: RLock = field(default_factory=RLock)
    operation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def build_live_area_catalog() -> tuple[AreaDefinition, ...]:
    return base_japan_area_catalog()


_TSUNAMI_WARNING_RANK = {
    TsunamiWarningClass.MAJOR_WARNING: 4,
    TsunamiWarningClass.WARNING: 3,
    TsunamiWarningClass.ADVISORY: 2,
    TsunamiWarningClass.FORECAST: 1,
    TsunamiWarningClass.NONE: 0,
    TsunamiWarningClass.UNKNOWN: -1,
}


class LiveStore:
    """Session isolation around shared, rate-limited process-level source adapters."""

    def __init__(
        self,
        *,
        jma_source: JmaEarthquakeSource | None = None,
        tsunami_source: JmaTsunamiSource | None = None,
        destination_source: TokyoShelterSource | None = None,
        route_source: EkispertRouteSource | None = None,
        planner: CandidatePlanner | None = None,
        policy: SafetyPolicy | None = None,
        max_sessions: int = MAX_LIVE_SESSIONS,
        ttl_seconds: int = SESSION_TTL_SECONDS,
        now=None,
    ) -> None:
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._jma = jma_source or JmaEarthquakeSource()
        if tsunami_source is not None:
            self._tsunami = tsunami_source
        elif jma_source is None:
            self._tsunami = JmaTsunamiSource()
        else:
            self._tsunami = _UnsupportedTsunamiSource(self._now)
        self._destinations = destination_source or TokyoShelterSource()
        self._routes = route_source or EkispertRouteSource()
        self._planner = planner or CandidatePlanner()
        self._policy = policy or SafetyPolicy.from_env()
        self._max_sessions = max_sessions
        self._ttl_seconds = ttl_seconds
        self._sessions: dict[UUID, LiveAggregate] = {}
        self._lock = RLock()
        self._area_registry = load_japan_area_registry()
        self._area_by_id = {area.id: area for area in self._area_registry}
        self._area_catalog = base_japan_area_catalog(self._area_registry)

    def start(self, request: StartLiveRequest) -> LiveSnapshot:
        aggregate = self._create_session(request)
        return self.refresh(aggregate.session_id)

    async def start_async(self, request: StartLiveRequest) -> LiveSnapshot:
        aggregate = self._create_session(request)
        return await self.refresh_async(aggregate.session_id)

    def _create_session(self, request: StartLiveRequest) -> LiveAggregate:
        if not isinstance(request, StartLiveRequest):
            request = StartLiveRequest.model_validate(request)
        now = self._now()
        try:
            for location in (
                request.profile.current_location,
                request.profile.accommodation_location,
                request.profile.current_destination,
            ):
                if location is not None:
                    validate_location_area_path(location, self._area_by_id)
                    if location.source == LocationSource.GPS and not gps_observation_is_fresh(
                        location.observed_at, now
                    ):
                        raise ValueError("GPS location must be observed within the last two minutes")
        except ValueError as exc:
            raise InvalidLiveProfile(f"profile location is outside the live area catalog: {exc}") from exc
        profile_seed = self._canonicalize_profile_locations(request.profile)

        session_id = uuid4()
        user_id = f"user_live_{session_id.hex}"
        profile = UserProfile(
            id=user_id,
            preferred_language=request.language,
            **profile_seed.model_dump(),
            created_at=now,
            updated_at=now,
        )
        situation = Situation(
            id=f"sit_{session_id.hex}",
            user_id=user_id,
            incident_status=IncidentStatus.IDLE,
            network_state=NetworkState.ONLINE_VERIFIED,
            created_at=now,
            updated_at=now,
        )
        claims, _, _ = derive_claim_states(situation, (), now, self._policy)
        situation = situation.model_copy(update={"claim_states": claims})
        state = CoreState(
            profile=profile,
            situation=situation,
            current_time=now,
            scenario_key="live-jma-eqvol",
            area_catalog=self._area_catalog,
        )
        state = replace(state, area_catalog=catalog_for_state(state, self._area_registry))
        source = self._empty_jma_projection()
        destination_source = self._empty_destination_projection()
        route_source = self._empty_route_projection()
        aggregate = LiveAggregate(
            session_id=session_id,
            state=state,
            source=source,
            destination_source=destination_source,
            route_source=route_source,
            expires_at=monotonic() + self._ttl_seconds,
        )
        with self._lock:
            self._purge_expired_locked()
            if len(self._sessions) >= self._max_sessions:
                raise LiveSessionCapacityReached("live session capacity reached")
            self._sessions[session_id] = aggregate
        return aggregate

    def get(self, session_id: UUID) -> LiveSnapshot:
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            self._advance_time_locked(aggregate, self._now())
            self._touch(aggregate)
            return self._snapshot(aggregate)

    async def update_location(
        self,
        session_id: UUID,
        request: LiveLocationUpdateRequest,
    ) -> LiveSnapshot:
        """Update a live profile's canonical area scope and re-evaluate its plan."""
        aggregate = self._get_aggregate(session_id)
        if not isinstance(request, LiveLocationUpdateRequest):
            try:
                request = LiveLocationUpdateRequest.model_validate(request)
            except ValueError as exc:
                raise InvalidLiveLocationRequest(str(exc)) from exc

        async with aggregate.operation_lock:
            with aggregate.lock:
                now = self._now()
                self._validate_location_timestamp(request, now)
                try:
                    validate_location_area_path(
                        Location(
                            label=self._area_by_id[request.area_ids[0]].label,
                            area_ids=request.area_ids,
                            observed_at=request.observed_at,
                            source=request.source,
                        ),
                        self._area_by_id,
                    )
                except (KeyError, ValueError) as exc:
                    raise InvalidLiveLocationRequest(
                        "area_ids must be a registered, contiguous specific-to-ancestor path"
                    ) from exc

                before = aggregate.state
                location = Location(
                    label=self._area_by_id[request.area_ids[0]].label,
                    area_ids=request.area_ids,
                    observed_at=request.observed_at,
                    source=request.source,
                )
                if location.area_ids == before.profile.current_location.area_ids:
                    if location == before.profile.current_location:
                        self._touch(aggregate)
                        return self._snapshot(aggregate)
                    # A same-area fix refreshes only location metadata. Retain route
                    # and source evidence; the normal evaluator still enforces their
                    # own TTLs at the new current time.
                    transition_time = max(now, before.current_time)
                    profile = before.profile.model_copy(
                        update={"current_location": location, "updated_at": transition_time}
                    )
                    from .planning import evaluate_and_replan

                    def refreshed(position: int, prior_trace: tuple) -> CoreState:
                        event_id = f"live-location-refresh-{position}-{int(transition_time.timestamp())}"
                        trace = TraceEvent(
                            id=f"trace_{position:03d}",
                            situation_id=before.situation.id,
                            timestamp=transition_time,
                            agent=AgentName.SITUATION_AGENT,
                            event_type="PROFILE_LOCATION_REFRESHED",
                            input_refs=(event_id,),
                            output_refs=request.area_ids,
                            status=TraceStatus.SUCCESS,
                            public_summary=(
                                f"Current area location timestamp refreshed from {request.source.value}: "
                                f"{location.label}. Area scope and source evidence were not changed."
                            ),
                        )
                        after = replace(before, profile=profile, current_time=transition_time,
                                        trace=(*prior_trace, trace))
                        return evaluate_and_replan(before, after, SimpleNamespace(id=event_id), self._policy)

                    # F3: a refresh that produces no plan evaluation replaces the previous
                    # PROFILE_LOCATION_REFRESHED trace in place (same id and position), so a
                    # long run of same-area refreshes never grows the trace toward its cap.
                    previous = before.trace[-1] if before.trace else None
                    if previous is not None and previous.event_type == "PROFILE_LOCATION_REFRESHED":
                        candidate = refreshed(len(before.trace), before.trace[:-1])
                        candidate = replace(candidate, trace=(
                            *candidate.trace[:len(before.trace) - 1],
                            candidate.trace[len(before.trace) - 1].model_copy(update={"id": previous.id}),
                            *candidate.trace[len(before.trace):],
                        ))
                        if (
                            len(candidate.plan_evaluations) == len(before.plan_evaluations)
                            and len(candidate.trace) == len(before.trace)
                        ):
                            aggregate.state = candidate
                            self._touch(aggregate)
                            return self._snapshot(aggregate)
                    if len(before.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                        raise InvalidLiveLocationRequest("live trace capacity reached")
                    aggregate.state = refreshed(len(before.trace) + 1, before.trace)
                    self._touch(aggregate)
                    return self._snapshot(aggregate)

                if location == before.profile.current_location:
                    self._touch(aggregate)
                    return self._snapshot(aggregate)
                if len(before.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                    raise InvalidLiveLocationRequest("live trace capacity reached")

                transition_time = max(now, before.current_time)
                event_id = f"live-location-{len(before.trace) + 1}-{int(transition_time.timestamp())}"
                trace = TraceEvent(
                    id=f"trace_{len(before.trace) + 1:03d}",
                    situation_id=before.situation.id,
                    timestamp=transition_time,
                    agent=AgentName.SITUATION_AGENT,
                    event_type="PROFILE_LOCATION_UPDATED",
                    input_refs=(event_id,),
                    output_refs=request.area_ids,
                    status=TraceStatus.SUCCESS,
                    public_summary=(
                        f"Current area updated from {request.source.value}: {location.label}. "
                        "This does not verify disaster information or movement safety."
                    ),
                )
                after = self._location_transition(before, location, transition_time, trace)
                try:
                    after = replace(
                        after,
                        area_catalog=catalog_for_state(after, self._area_registry),
                    )
                except ValueError as exc:
                    raise InvalidLiveLocationRequest(str(exc)) from exc

            from .planning import evaluate_and_replan

            planned = replan_live_transition(
                before,
                after,
                self._policy,
                event_id=event_id,
            )
            with aggregate.lock:
                if aggregate.state is before:
                    aggregate.state = planned
                else:
                    latest = aggregate.state
                    latest_time = max(transition_time, latest.current_time)
                    latest_after = self._location_transition(
                        latest,
                        location,
                        latest_time,
                        trace.model_copy(
                            update={
                                "id": f"trace_{len(latest.trace) + 1:03d}",
                                "timestamp": latest_time,
                            }
                        ),
                    )
                    latest_after = replace(
                        latest_after,
                        area_catalog=catalog_for_state(latest_after, self._area_registry),
                    )
                    aggregate.state = evaluate_and_replan(
                        latest,
                        latest_after,
                        event,
                        self._policy,
                    )
                self._touch(aggregate)
                return self._snapshot(aggregate)

    async def update_profile(
        self,
        session_id: UUID,
        request: LiveProfileUpdateRequest,
    ) -> LiveSnapshot:
        """Update non-location profile metadata without changing current GPS state."""
        aggregate = self._get_aggregate(session_id)
        if not isinstance(request, LiveProfileUpdateRequest):
            try:
                request = LiveProfileUpdateRequest.model_validate(request)
            except ValueError as exc:
                raise InvalidLiveProfileUpdate(str(exc)) from exc

        async with aggregate.operation_lock:
            with aggregate.lock:
                now = self._now()
                accommodation = request.accommodation_location
                try:
                    validate_location_area_path(accommodation, self._area_by_id)
                except ValueError as exc:
                    raise InvalidLiveProfileUpdate(
                        "accommodation location must use a registered, contiguous specific-to-ancestor path"
                    ) from exc
                if accommodation.area_ids:
                    accommodation = accommodation.model_copy(
                        update={"label": self._area_by_id[accommodation.area_ids[0]].label}
                    )

                before = aggregate.state
                profile = before.profile
                profile_values = {
                    "accommodation_location": accommodation,
                    "party_size": request.party_size,
                    "self_reported_safety_status": request.self_reported_safety_status,
                    "accessibility_constraints": request.accessibility_constraints,
                }
                if all(getattr(profile, key) == value for key, value in profile_values.items()):
                    self._advance_time_locked(
                        aggregate,
                        now,
                        allow_network_reconciliation=False,
                    )
                    self._touch(aggregate)
                    return self._snapshot(aggregate)
                if len(before.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                    raise InvalidLiveProfileUpdate("live trace capacity reached")

                transition_time = max(now, before.current_time)
                event_id = f"live-profile-{len(before.trace) + 1}-{int(transition_time.timestamp())}"
                trace = TraceEvent(
                    id=f"trace_{len(before.trace) + 1:03d}",
                    situation_id=before.situation.id,
                    timestamp=transition_time,
                    agent=AgentName.SITUATION_AGENT,
                    event_type="PROFILE_METADATA_UPDATED",
                    input_refs=(event_id,),
                    output_refs=accommodation.area_ids,
                    status=TraceStatus.SUCCESS,
                    public_summary=(
                        "User profile settings were updated. Current location, network state, and source evidence were preserved."
                    ),
                )
                updated_profile = profile.model_copy(
                    update={**profile_values, "updated_at": transition_time}
                )
                updated_situation = before.situation.model_copy(
                    update={"updated_at": transition_time}
                )
                after = replace(
                    before,
                    profile=updated_profile,
                    situation=updated_situation,
                    current_time=transition_time,
                    trace=(*before.trace, trace),
                )
                try:
                    after = replace(
                        after,
                        area_catalog=catalog_for_state(after, self._area_registry),
                    )
                except ValueError as exc:
                    raise InvalidLiveProfileUpdate(str(exc)) from exc

            planned = replan_live_transition(
                before,
                after,
                self._policy,
                event_id=event_id,
                allow_network_reconciliation=False,
            )
            from .planning import evaluate_and_replan

            with aggregate.lock:
                if aggregate.state is before:
                    aggregate.state = planned
                else:
                    latest = aggregate.state
                    latest_time = max(transition_time, latest.current_time)
                    latest_profile = latest.profile.model_copy(
                        update={**profile_values, "updated_at": latest_time}
                    )
                    latest_trace = trace.model_copy(
                        update={
                            "id": f"trace_{len(latest.trace) + 1:03d}",
                            "timestamp": latest_time,
                        }
                    )
                    latest_after = replace(
                        latest,
                        profile=latest_profile,
                        situation=latest.situation.model_copy(update={"updated_at": latest_time}),
                        current_time=latest_time,
                        trace=(*latest.trace, latest_trace),
                    )
                    latest_after = replace(
                        latest_after,
                        area_catalog=catalog_for_state(latest_after, self._area_registry),
                    )
                    aggregate.state = evaluate_and_replan(
                        latest,
                        latest_after,
                        event,
                        self._policy,
                        allow_network_reconciliation=False,
                    )
                self._touch(aggregate)
                return self._snapshot(aggregate)

    async def record_distress(self, session_id: UUID, request: DistressRequest) -> LiveSnapshot:
        """Record a user-reported distress signal and re-plan; it can only make guidance more protective."""
        from .distress import record_distress_report
        from .planning import evaluate_and_replan

        aggregate = self._get_aggregate(session_id)

        def reported_state(base, at):
            reported = record_distress_report(base, request.tags, request.input_mode, at)
            report_id = reported.distress_reports[-1].id
            trace = TraceEvent(
                id=f"trace_{len(reported.trace) + 1:03d}",
                situation_id=reported.situation.id,
                timestamp=at,
                agent=AgentName.SITUATION_AGENT,
                event_type="DISTRESS_REPORTED",
                input_refs=(report_id,),
                output_refs=tuple(tag.value for tag in request.tags),
                status=TraceStatus.SUCCESS,
                public_summary="The user reported distress. It can only make guidance more protective.",
            )
            return replace(
                reported,
                situation=reported.situation.model_copy(update={"updated_at": at}),
                current_time=at,
                trace=(*reported.trace, trace),
            ), report_id

        async with aggregate.operation_lock:
            with aggregate.lock:
                before = aggregate.state
                if len(before.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                    raise InvalidLiveProfileUpdate("live trace capacity reached")
                transition_time = max(self._now(), before.current_time)
                after, report_id = reported_state(before, transition_time)

            planned = replan_live_transition(
                before,
                after,
                self._policy,
                event_id=report_id,
                allow_network_reconciliation=False,
            )

            with aggregate.lock:
                if aggregate.state is before:
                    aggregate.state = planned
                else:
                    latest = aggregate.state
                    if len(latest.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                        raise InvalidLiveProfileUpdate("live trace capacity reached")
                    latest_time = max(transition_time, latest.current_time)
                    latest_after, latest_report_id = reported_state(latest, latest_time)
                    aggregate.state = evaluate_and_replan(
                        latest,
                        latest_after,
                        SimpleNamespace(id=latest_report_id),
                        self._policy,
                        allow_network_reconciliation=False,
                    )
                self._touch(aggregate)
                return self._snapshot(aggregate)

    async def record_ai_escalation(self, session_id: UUID) -> bool:
        """Core-approved AI escalation NONE -> USER_REPORTED, then re-plan; it can only add protection.
        Returns False (no trace, no re-plan) when the Core level is no longer NONE."""
        from .distress_advice import ai_escalated_state
        from .planning import evaluate_and_replan

        aggregate = self._get_aggregate(session_id)

        def escalated_state(base, at):
            escalated = ai_escalated_state(base, at)
            return replace(
                escalated,
                situation=escalated.situation.model_copy(update={"updated_at": at}),
                current_time=at,
            ), escalated.trace[-1].id

        def still_none(state, at) -> bool:
            return resolve_distress(state, at, self._policy).level == DistressLevel.NONE

        async with aggregate.operation_lock:
            with aggregate.lock:
                before = aggregate.state
                transition_time = max(self._now(), before.current_time)
                if not still_none(before, transition_time):
                    return False
                if len(before.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                    raise InvalidLiveProfileUpdate("live trace capacity reached")
                after, event_id = escalated_state(before, transition_time)

            planned = replan_live_transition(
                before,
                after,
                self._policy,
                event_id=event_id,
                allow_network_reconciliation=False,
            )

            with aggregate.lock:
                if aggregate.state is before:
                    aggregate.state = planned
                else:
                    latest = aggregate.state
                    if len(latest.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                        raise InvalidLiveProfileUpdate("live trace capacity reached")
                    latest_time = max(transition_time, latest.current_time)
                    if not still_none(latest, latest_time):
                        return False
                    latest_after, latest_event_id = escalated_state(latest, latest_time)
                    aggregate.state = evaluate_and_replan(
                        latest,
                        latest_after,
                        SimpleNamespace(id=latest_event_id),
                        self._policy,
                        allow_network_reconciliation=False,
                    )
                self._touch(aggregate)
                return True

    async def record_advice_trace(self, session_id: UUID, applied) -> LiveSnapshot:
        """Append the advice outcome trace (field names only, never model text)."""
        from .distress_advice import advice_needs_trace, advice_traced_state

        aggregate = self._get_aggregate(session_id)
        async with aggregate.operation_lock:
            with aggregate.lock:
                state = aggregate.state
                if not advice_needs_trace(applied):
                    self._touch(aggregate)
                    return self._snapshot(aggregate)
                if len(state.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                    raise InvalidLiveProfileUpdate("live trace capacity reached")
                aggregate.state = advice_traced_state(state, applied, max(self._now(), state.current_time))
                self._touch(aggregate)
                return self._snapshot(aggregate)

    @staticmethod
    def _validate_location_timestamp(request: LiveLocationUpdateRequest, now: datetime) -> None:
        if request.observed_at > now:
            raise InvalidLiveLocationRequest("observed_at cannot be in the future")
        if request.source == LocationSource.GPS and not gps_observation_is_fresh(
            request.observed_at, now
        ):
            raise InvalidLiveLocationRequest("GPS location is older than two minutes")

    def _canonicalize_profile_locations(self, profile: ProfileSeed) -> ProfileSeed:
        def canonical(location):
            if location is None or not location.area_ids:
                return location
            return location.model_copy(
                update={"label": self._area_by_id[location.area_ids[0]].label}
            )

        return profile.model_copy(
            update={
                "current_location": canonical(profile.current_location),
                "accommodation_location": canonical(profile.accommodation_location),
                "current_destination": canonical(profile.current_destination),
            }
        )

    def _location_transition(self, state, location: Location, now: datetime, trace: TraceEvent):
        routes = tuple(
            route.model_copy(
                update={
                    "status": RoutePresentationStatus.EXPIRED,
                    "freshness_status": FreshnessStatus.STALE,
                }
            )
            for route in state.routes
        )
        profile = state.profile.model_copy(
            update={"current_location": location, "updated_at": now}
        )
        situation = state.situation.model_copy(update={"updated_at": now})
        return replace(
            state,
            profile=profile,
            situation=situation,
            current_time=now,
            routes=routes,
            trace=(*state.trace, trace),
        )

    async def search_route(self, session_id: UUID, request) -> LiveSnapshot:
        aggregate = self._get_aggregate(session_id)
        if request.origin.lat is None or request.origin.lng is None:
            raise InvalidLiveRouteRequest("origin must include paired latitude and longitude")
        try:
            validate_location_area_path(request.origin, self._area_by_id)
        except ValueError as exc:
            raise InvalidLiveRouteRequest("origin area is outside the live area catalog") from exc
        with aggregate.lock:
            destination = next((item for item in aggregate.state.destinations if item.id == request.destination_id), None)
            if destination is None:
                raise InvalidLiveRouteRequest("destination is not present in this server-loaded live session")
        result = await self._routes.search(
            latitude=request.origin.lat,
            longitude=request.origin.lng,
            destination_latitude=destination.coordinates.lat,
            destination_longitude=destination.coordinates.lng,
            destination_id=destination.id,
            origin_area_id=request.origin.area_ids[0] if request.origin.area_ids else None,
            session_id=f"live-{aggregate.session_id}",
        )
        with aggregate.lock:
            now = self._now()
            aggregate.route_source = LiveSourceProjection(
                source_key=EKISPERT_ROUTE_SOURCE_KEY,
                source_name=EKISPERT_ROUTE_SOURCE_NAME,
                source_url=EKISPERT_MCP_ENDPOINT,
                status=result.status,
                retrieved_at=result.retrieved_at,
                next_retry_at=result.next_retry_at,
                record_count=1 if result.route is not None else 0,
                detail=result.detail,
            )
            if result.route is not None:
                routes = tuple(item for item in aggregate.state.routes if item.id != result.route.id)
                aggregate.state = replace(aggregate.state, routes=(*routes, result.route))
                self._advance_time_locked(aggregate, max(now, result.route.checked_at), event_id=f"live-route-{result.route.id}")
            else:
                self._advance_time_locked(aggregate, now, event_id="live-route-search")
            self._touch(aggregate)
            return self._snapshot(aggregate)

    def refresh(self, session_id: UUID) -> LiveSnapshot:
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            legacy_metadata = self._resolve_snapshot_metadata(aggregate.state)
            source_result = self._jma.fetch_latest()
            tsunami_result = self._tsunami.fetch_latest()
            destinations_payload = self._destinations.fetch_latest()
            now = max(self._now(), aggregate.state.current_time)
            pairs, aliases = self._apply_source_results_locked(
                aggregate, source_result, tsunami_result, destinations_payload, now, legacy_metadata,
            )
            aggregate.state = apply_live_evidence_batch(
                aggregate.state, pairs, now, self._policy,
                synthetic_mode=getattr(self, "_synthetic_source_mode", False),
                official_aliases=aliases,
            )
            self._touch(aggregate)
            return self._snapshot(aggregate)

    async def refresh_async(self, session_id: UUID) -> LiveSnapshot:
        aggregate = self._get_aggregate(session_id)
        async with aggregate.operation_lock:
            with aggregate.lock:
                legacy_state = aggregate.state
            legacy_metadata = await asyncio.to_thread(self._resolve_snapshot_metadata, legacy_state)
            source_result, tsunami_result, destinations_payload = await asyncio.gather(
                asyncio.to_thread(self._jma.fetch_latest),
                asyncio.to_thread(self._tsunami.fetch_latest),
                asyncio.to_thread(self._destinations.fetch_latest),
            )
            with aggregate.lock:
                now = self._now()
                pairs, aliases = self._apply_source_results_locked(
                    aggregate, source_result, tsunami_result, destinations_payload, now, legacy_metadata
                )
                prepared = aggregate.state
            after = apply_live_evidence_batch(
                prepared,
                pairs,
                max(now, prepared.current_time),
                self._policy,
                synthetic_mode=getattr(self, "_synthetic_source_mode", False),
                official_aliases=aliases,
            )
            with aggregate.lock:
                if aggregate.state is not prepared:
                    # A concurrent read may have advanced expiry while Gemini was running.
                    aggregate.state = apply_live_evidence_batch(
                        aggregate.state,
                        pairs,
                        max(now, aggregate.state.current_time),
                        self._policy,
                        synthetic_mode=getattr(self, "_synthetic_source_mode", False),
                        official_aliases=aliases,
                    )
                    after = aggregate.state
                aggregate.state = after
                published_at = self._now()
                if published_at > aggregate.state.current_time:
                    self._advance_time_locked(
                        aggregate,
                        published_at,
                        event_id=f"live-refresh-published-{int(published_at.timestamp())}",
                    )
                self._touch(aggregate)
                return self._snapshot(aggregate)

    def get_tsunami_reference(self) -> TsunamiReferenceResponse:
        """Fetch the latest read-only JMA reference without mutating live sessions."""
        return tsunami_reference_from_result(self._tsunami.fetch_latest())

    def get_disaster_map_reference(self):
        from .disaster_map import project_disaster_map
        return project_disaster_map(self._jma.fetch_latest(), self._tsunami.fetch_latest(), self._now())

    def _apply_source_results_locked(self, aggregate, source_result, tsunami_result, destinations_payload, now, legacy_metadata):
        # Old snapshots lack Control.DateTime; use recovered original official
        # XML only. Business/receipt clocks never substitute for system ordering.
        if source_result.status in {LiveSourceStatus.FRESH, LiveSourceStatus.STALE} and any(
            item.bulletin is not None and self._legacy_ordering_unknown(aggregate.state, item.bulletin, legacy_metadata)
            for item in source_result.reports
        ):
            source_result = replace(source_result, status=LiveSourceStatus.INVALID_RESPONSE,
                detail="Legacy official XML identity/ordering could not be verified; prior evidence is unavailable for current claims.")
        if tsunami_result.status in {LiveSourceStatus.FRESH, LiveSourceStatus.STALE} and any(
            item.bulletin is not None and self._legacy_ordering_unknown(aggregate.state, item.bulletin, legacy_metadata)
            for item in tsunami_result.bulletins
        ):
            tsunami_result = replace(tsunami_result, status=LiveSourceStatus.INVALID_RESPONSE,
                detail="Legacy official XML identity/ordering could not be verified; current tsunami status is UNKNOWN.")
        projected_status = jma_status_at_publication_deadline(
            source_result.status,
            source_result.last_published_at,
            now,
        )
        if projected_status != source_result.status:
            source_result = replace(
                source_result,
                status=projected_status,
                detail="JMA publication freshness deadline elapsed; original publication/retrieval timestamps were retained.",
            )
        destination_status, all_destinations, destination_retrieved, destination_retry = destinations_payload
        aggregate.source = LiveSourceProjection(
            source_key=JMA_SOURCE_KEY,
            source_name=JMA_SOURCE_NAME,
            source_url=JMA_FEED_URL,
            status=source_result.status,
            retrieved_at=source_result.retrieved_at,
            last_published_at=source_result.last_published_at,
            next_retry_at=source_result.next_retry_at,
            record_count=len(source_result.reports),
            detail=source_result.detail,
            recovery=source_result.recovery,
        )
        aggregate.tsunami_source = LiveSourceProjection(
            source_key=JMA_TSUNAMI_SOURCE_KEY, source_name=JMA_TSUNAMI_SOURCE_NAME, source_url=JMA_FEED_URL,
            status=tsunami_result.status, retrieved_at=tsunami_result.retrieved_at,
            last_published_at=tsunami_result.last_published_at, next_retry_at=tsunami_result.next_retry_at,
            record_count=len(tsunami_result.bulletins), detail=tsunami_result.detail, recovery=tsunami_result.recovery)
        aggregate.tsunami_deadlines = tuple(jma_report_deadline(item) for item in tsunami_result.bulletins)
        aggregate.official_reports = tuple(
            item.model_copy(update={"lifecycle": "UNKNOWN"})
            if item.lifecycle == "CURRENT" and result.status != LiveSourceStatus.FRESH else item
            for result in (source_result, tsunami_result) for item in result.references[:64])
        if destination_status == LiveSourceStatus.FRESH:
            destination_status = LiveSourceStatus.STALE
        area_scope = set(aggregate.state.profile.current_location.area_ids)
        area_scope.update(aggregate.state.profile.accommodation_location.area_ids)
        if aggregate.state.profile.current_destination:
            area_scope.update(aggregate.state.profile.current_destination.area_ids)
        relevant_destinations = (
            tuple(item for item in all_destinations if item.area_id in area_scope)[:512]
            if "JP-13" in area_scope
            else ()
        )
        aggregate.state = replace(aggregate.state, destinations=relevant_destinations)
        aggregate.destination_source = LiveSourceProjection(
            source_key=TOKYO_SHELTER_SOURCE_KEY,
            source_name=TOKYO_SHELTER_SOURCE_NAME,
            source_url=TOKYO_SHELTER_URL,
            status=destination_status,
            retrieved_at=destination_retrieved,
            last_published_at=TOKYO_SHELTER_PUBLISHED_AT,
            next_retry_at=destination_retry,
            record_count=len(relevant_destinations),
            detail="Tokyo designation catalog excerpt (up to 512 records; basis 2021-04-01, not complete-area coverage); current opening and capacity are UNKNOWN.",
        )
        if source_result.status in {
            LiveSourceStatus.BACKOFF,
            LiveSourceStatus.CIRCUIT_OPEN,
            LiveSourceStatus.INVALID_RESPONSE,
            LiveSourceStatus.UNAVAILABLE,
        }:
            self._mark_jma_evidence_stale(aggregate, now)
        # The reconnect evidence watermark is the pending barrier. It remains
        # present until Safety Core emits RECONCILIATION_COMPLETED, including
        # while a hazard is conflicting or a verified cancellation removes all
        # currently active event IDs.
        reconnect_pending = (
            aggregate.state.reconnect_evidence_count is not None
            or aggregate.state.situation.network_state == NetworkState.RECONNECTING
        )
        recovery_ready = all(result.recovery is None or result.recovery.scan_status == "WINDOW_VERIFIED"
                             for result in (source_result, tsunami_result))
        network_state = (
            NetworkState.RECONNECTING
            if reconnect_pending
            else NetworkState.ONLINE_VERIFIED
            if source_result.status == LiveSourceStatus.FRESH and recovery_ready
            else NetworkState.ONLINE_DEGRADED
        )
        aggregate.state = replace(
            aggregate.state,
            official_recovery_ready=recovery_ready,
            situation=aggregate.state.situation.model_copy(update={"network_state": network_state}),
        )
        if source_result.status not in {LiveSourceStatus.FRESH, LiveSourceStatus.STALE}:
            earthquake_pairs = ()
        else:
            earthquake_pairs = tuple(
            pair for report in source_result.reports
            if (pair := self._event_evidence_pair(aggregate.state, report, now, legacy_metadata)) is not None
            )

        active_tsunami_event_ids = {
            item.id for item in aggregate.state.events
            if item.source_name == JMA_TSUNAMI_SOURCE_NAME
            and item.event_type == DisasterEventType.TSUNAMI
            and item.status in {DisasterEventStatus.ACTIVE, DisasterEventStatus.UNKNOWN}
        }
        active_tsunami = bool(active_tsunami_event_ids & set(aggregate.state.situation.active_event_ids))
        if tsunami_result.conflict:
            self._mark_tsunami_evidence_stale(aggregate, conflict=True)
            if active_tsunami and not reconnect_pending:
                aggregate.state = replace(
                    aggregate.state,
                    situation=aggregate.state.situation.model_copy(
                        update={"network_state": NetworkState.ONLINE_DEGRADED}
                    ),
                )
            tsunami_pairs = ()
        elif tsunami_result.status == LiveSourceStatus.FRESH:
            tsunami_pairs = tuple(
                pair
                for bulletin in tsunami_result.bulletins
                if now < jma_report_deadline(bulletin)
                and (pair := self._tsunami_event_evidence_pair(aggregate.state, bulletin, now, legacy_metadata)) is not None
            )
        elif tsunami_result.status in {
            LiveSourceStatus.STALE,
            LiveSourceStatus.BACKOFF,
            LiveSourceStatus.CIRCUIT_OPEN,
            LiveSourceStatus.INVALID_RESPONSE,
            LiveSourceStatus.UNAVAILABLE,
        } or (tsunami_result.status == LiveSourceStatus.UNSUPPORTED and active_tsunami):
            self._mark_tsunami_evidence_stale(aggregate)
            if active_tsunami and not reconnect_pending:
                aggregate.state = replace(
                    aggregate.state,
                    situation=aggregate.state.situation.model_copy(
                        update={"network_state": NetworkState.ONLINE_DEGRADED}
                    ),
                )
            tsunami_pairs = ()
        else:
            tsunami_pairs = ()
        pairs = (*earthquake_pairs, *tsunami_pairs)
        metadata = {
            f"jma-earthquake-{item.bulletin.report_id}": item.bulletin
            for item in source_result.reports if item.bulletin is not None
        }
        metadata.update({
            f"jma-tsunami-{item.bulletin.report_id}": item.bulletin
            for item in tsunami_result.bulletins if item.bulletin is not None
        })
        aliases = {
            event.id: tuple(previous.id for previous, _ in self._prior_official_records(aggregate.state, metadata[event.id]))
            for event, _ in pairs if event.id in metadata
        }
        return pairs, aliases

    def _mark_tsunami_evidence_stale(self, aggregate, *, conflict: bool = False) -> None:
        evidence = tuple(
            item.model_copy(update={
                "trust_status": TrustStatus.CONFLICTING if conflict else TrustStatus.STALE,
                "freshness_status": FreshnessStatus.UNKNOWN if conflict else FreshnessStatus.STALE,
                "conflict": conflict,
            })
            if item.source_key == JMA_TSUNAMI_SOURCE_KEY
            else item
            for item in aggregate.state.evidence
        )
        tsunami_event_ids = {
            item.id for item in aggregate.state.events
            if item.source_name == JMA_TSUNAMI_SOURCE_NAME and item.status == DisasterEventStatus.ACTIVE
        }
        events = tuple(
            item.model_copy(update={"status": DisasterEventStatus.UNKNOWN})
            if item.id in tsunami_event_ids
            else item
            for item in aggregate.state.events
        )
        aggregate.state = replace(aggregate.state, evidence=evidence, events=events)

    def _mark_jma_evidence_stale(self, aggregate, now) -> None:
        evidence = tuple(
            item.model_copy(update={"trust_status": TrustStatus.STALE, "freshness_status": FreshnessStatus.STALE})
            if item.source_key == JMA_SOURCE_KEY
            else item
            for item in aggregate.state.evidence
        )
        jma_event_ids = {
            item.id for item in aggregate.state.events
            if item.source_name == JMA_SOURCE_NAME and item.status == DisasterEventStatus.ACTIVE
        }
        events = tuple(
            item.model_copy(update={"status": DisasterEventStatus.UNKNOWN})
            if item.id in jma_event_ids
            else item
            for item in aggregate.state.events
        )
        aggregate.state = replace(aggregate.state, evidence=evidence, events=events)

    def add_route(self, session_id: UUID, route: RoutePresentation) -> LiveSnapshot:
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            if route.status.value == "VERIFIED_USABLE":
                raise ValueError("route provider candidates cannot be promoted to VERIFIED_USABLE")
            now = self._now()
            if route.checked_at > now + timedelta(seconds=5):
                raise ValueError("route check timestamp is in the future")
            previous = tuple(item for item in aggregate.state.routes if item.id != route.id)
            aggregate.state = replace(aggregate.state, routes=(*previous, route))
            self._advance_time_locked(aggregate, now, event_id=f"live-route-{route.id}")
            self._touch(aggregate)
            return self._snapshot(aggregate)

    @staticmethod
    def _prior_official_records(
        state: CoreState, metadata: OfficialBulletin,
    ) -> tuple[tuple[DisasterEvent, Evidence], ...]:
        """Match canonical units and pre-lifecycle IDs using verified provenance.

        Legacy parsers accepted one EventID only and normal product status.
        Omitted title/clock provenance must be recovered from the original
        official XML before a legacy alias can be retired.
        Never partially match compound tsunami EventID combinations.
        """
        earthquake = metadata.product == "VXSE53"
        event_type = DisasterEventType.EARTHQUAKE if earthquake else DisasterEventType.TSUNAMI
        source_key = JMA_SOURCE_KEY if earthquake else JMA_TSUNAMI_SOURCE_KEY
        source_name = JMA_SOURCE_NAME if earthquake else JMA_TSUNAMI_SOURCE_NAME
        prefix = "jma-earthquake-" if earthquake else "jma-tsunami-"
        canonical = f"{prefix}{metadata.group_id}--"
        tokens = metadata.event_id.split()
        legacy = None
        if len(tokens) == 1:
            legacy = (
                rf"jma-{re.escape(tokens[0])}-[A-Za-z0-9_-]+" if earthquake else
                rf"jma-tsunami-{sha256(tokens[0].encode()).hexdigest()[:16]}--[A-Za-z0-9_-]+"
            )
        proofs = {item.id: item for item in state.evidence}
        records = []
        for event in state.events:
            proof = proofs.get(f"ev_{event.id}")
            if (
                event.event_type == event_type and event.source_name == source_name
                and event.source_class == SourceClass.OFFICIAL and not event.is_synthetic
                and proof is not None and proof.source_key == source_key
                and proof.source_class == SourceClass.OFFICIAL and not proof.is_synthetic
                and (event.id.startswith(canonical) or (legacy is not None and event.id in state.situation.active_event_ids and re.fullmatch(legacy, event.id)))
            ):
                records.append((event, proof))
        return tuple(records)

    def _resolve_snapshot_metadata(self, state: CoreState) -> dict[str, OfficialBulletin]:
        recovered: dict[str, OfficialBulletin] = {}
        proofs = {item.id: item for item in state.evidence}
        active = set(state.situation.active_event_ids)
        for event_type, source, source_key, source_name in (
            (DisasterEventType.EARTHQUAKE, self._jma, JMA_SOURCE_KEY, JMA_SOURCE_NAME),
            (DisasterEventType.TSUNAMI, self._tsunami, JMA_TSUNAMI_SOURCE_KEY, JMA_TSUNAMI_SOURCE_NAME),
        ):
            events = []
            pattern = (
                r"jma-\d{14}-[A-Za-z0-9_-]+" if event_type == DisasterEventType.EARTHQUAKE else
                r"jma-tsunami-[a-f0-9]{16}--[A-Za-z0-9_-]+"
            )
            for event in state.events:
                proof = proofs.get(f"ev_{event.id}")
                if (
                    event.id in active and event.event_type == event_type and event.source_name == source_name
                    and not event.is_synthetic and event.source_class == SourceClass.OFFICIAL
                    and proof is not None and proof.source_key == source_key
                    and proof.source_class == SourceClass.OFFICIAL and not proof.is_synthetic
                    and event.raw_reference == proof.raw_reference and re.fullmatch(pattern, event.id)
                ):
                    events.append(event)
            resolver = getattr(source, "fetch_snapshot_metadata", None)
            if not events or resolver is None:
                continue
            by_url = resolver(tuple(event.raw_reference for event in events))
            for event in events:
                metadata = by_url.get(event.raw_reference)
                proof = proofs[f"ev_{event.id}"]
                if metadata is None or len(metadata.event_id.split()) != 1:
                    continue
                legacy_id = (
                    f"jma-{metadata.event_id}-{metadata.serial}" if event_type == DisasterEventType.EARTHQUAKE else
                    f"jma-tsunami-{sha256(metadata.event_id.encode()).hexdigest()[:16]}--{metadata.serial or 'none'}-{int(metadata.reported_at.timestamp())}"
                )
                if (metadata.product == ("VXSE53" if event_type == DisasterEventType.EARTHQUAKE else "VTSE41")
                    and metadata.reference_url == event.raw_reference and metadata.reported_at == proof.published_at
                    and legacy_id == event.id):
                    recovered[event.id] = metadata
        return recovered

    @classmethod
    def _legacy_ordering_unknown(cls, state: CoreState, metadata: OfficialBulletin, recovered) -> bool:
        canonical = f"jma-{'earthquake' if metadata.product == 'VXSE53' else 'tsunami'}-{metadata.group_id}--"
        for event, _ in cls._prior_official_records(state, metadata):
            if event.id.startswith(canonical):
                continue
            prior = recovered.get(event.id)
            if (prior is None or prior.group_id != metadata.group_id
                or (prior.issued_at == metadata.issued_at and prior.raw_sha256 != metadata.raw_sha256)):
                return True
        return False

    @classmethod
    def _prior_official_is_newer_or_unordered(cls, state: CoreState, metadata: OfficialBulletin, recovered) -> bool:
        canonical = f"jma-{'earthquake' if metadata.product == 'VXSE53' else 'tsunami'}-{metadata.group_id}--"
        return cls._legacy_ordering_unknown(state, metadata, recovered) or any(
            (proof.published_at if event.id.startswith(canonical) else recovered[event.id].issued_at) > metadata.issued_at
            for event, proof in cls._prior_official_records(state, metadata)
        )

    def _event_evidence_pair(
        self,
        state: CoreState,
        report: JmaEarthquakeReport,
        now: datetime,
        legacy_metadata: dict[str, OfficialBulletin] | None = None,
    ) -> tuple[DisasterEvent, Evidence] | None:
        event_id = f"jma-earthquake-{report.report_id}" if report.bulletin else f"jma-{report.report_id}"
        evidence_id = f"ev_{event_id}"
        if any(item.id == event_id for item in state.events) or any(item.id == evidence_id for item in state.evidence):
            return None
        previous = self._prior_official_records(state, report.bulletin) if report.bulletin else ()
        if report.bulletin and self._prior_official_is_newer_or_unordered(state, report.bulletin, legacy_metadata or {}):
            return None  # A cold adapter must not resurrect an older snapshot revision.
        observations = report.observations
        scoped_observations = (*observations, *report.withdrawn_observations)
        area_ids = tuple(dict.fromkeys(item.area_id for item in scoped_observations if item.area_id is not None))
        names = tuple(dict.fromkeys(item.name for item in scoped_observations))
        cancelled = report.bulletin is not None and report.bulletin.operation.value == "CANCEL"
        current_area_ids = {item.area_id for item in observations} if not cancelled else set()
        occurred_at = report.occurred_at
        if previous:
            area_ids = tuple(dict.fromkeys((*area_ids, *(area for event, _ in previous for area in event.affected_area_ids))))
            names = tuple(dict.fromkeys((*names, *(name for event, _ in previous for name in event.affected_areas))))
            if occurred_at is None and cancelled:
                occurred_at = max(previous, key=lambda item: item[1].published_at)[0].occurred_at
        if occurred_at is None or not area_ids:
            # A bodyless cancellation with no earlier official scope is retained
            # by the source ledger, never turned into fabricated event data.
            return None
        assessments = tuple(
            DisasterAssessment(
                area_id=area_id,
                event_type=DisasterEventType.EARTHQUAKE,
                level=None,
                status=DisasterEventStatus.ACTIVE if area_id in current_area_ids else DisasterEventStatus.UNKNOWN,
            )
            for area_id in area_ids
        )
        claims = list(claims_from_disaster_assessments(assessments))
        profile_area_ids = {
            location.area_ids[0]
            for location in (
                state.profile.current_location,
                state.profile.accommodation_location,
                state.profile.current_destination,
            )
            if location is not None and location.area_ids
        }
        retained_intensity_area_ids: set[str] = set()
        for observation in observations:
            if observation.area_id in profile_area_ids and observation.max_intensity:
                key = f"jma.earthquake.max_intensity.{observation.area_id.lower()}"
                if key not in {claim.key for claim in claims}:
                    claims.append(Claim(key=key, value=observation.max_intensity))
                    retained_intensity_area_ids.add(observation.area_id)
        expires_at = report.published_at + timedelta(seconds=JMA_EVIDENCE_TTL_SECONDS)
        freshness = FreshnessStatus.CURRENT if now < expires_at else FreshnessStatus.STALE
        event = DisasterEvent(
            id=event_id,
            situation_id=state.situation.id,
            event_type=DisasterEventType.EARTHQUAKE,
            occurred_at=occurred_at,
            received_at=now,
            affected_areas=names[:20],
            affected_area_ids=area_ids,
            source_name=JMA_SOURCE_NAME,
            source_class=SourceClass.OFFICIAL,
            severity_raw="JMA earthquake intensity observations; no 72H severity mapping",
            status=DisasterEventStatus.UNKNOWN if cancelled else DisasterEventStatus.ACTIVE,
            raw_reference=report.reference_url,
            is_synthetic=False,
        )
        evidence = Evidence(
            id=evidence_id,
            situation_id=state.situation.id,
            source_key=JMA_SOURCE_KEY,
            source_name=JMA_SOURCE_NAME,
            source_class=SourceClass.OFFICIAL,
            trust_status=TrustStatus.VERIFIED_OFFICIAL,
            freshness_status=freshness,
            published_at=report.published_at,
            received_at=now,
            expires_at=expires_at,
            relevant_areas=names[:20],
            affected_area_ids=area_ids,
            disaster_assessments=assessments,
            claim_type=ClaimType.DISASTER_STATUS,
            claims=tuple(claims),
            summary=(
                ("JMA withdrew an information unit; current earthquake status remains UNKNOWN. " if cancelled else
                 "JMA reported earthquake intensity by prefecture. Withdrawn scopes remain UNKNOWN; ") +
                f"exact intensity claims are retained only for profile areas {sorted(retained_intensity_area_ids) or 'none'}. "
                "72H severity is not inferred."
            ),
            raw_reference=report.reference_url,
            is_synthetic=False,
        )
        return event, evidence

    def _tsunami_event_evidence_pair(
        self,
        state: CoreState,
        bulletin: JmaTsunamiBulletin,
        now: datetime,
        legacy_metadata: dict[str, OfficialBulletin] | None = None,
    ) -> tuple[DisasterEvent, Evidence] | None:
        """Create SafetyCore evidence only for exact prefecture-level JMA areas."""
        previous = self._prior_official_records(state, bulletin.bulletin) if bulletin.bulletin else ()
        if bulletin.bulletin and self._prior_official_is_newer_or_unordered(state, bulletin.bulletin, legacy_metadata or {}):
            return None
        occurred_at = bulletin.occurred_at
        if occurred_at is None and bulletin.info_type == "取消" and previous:
            occurred_at = max(previous, key=lambda item: item[1].published_at)[0].occurred_at
        if occurred_at is None:
            # A cancellation without the prior event cached cannot be attached to
            # a safety scope; it remains visible only in the reference response.
            return None
        assessments = []
        names = []
        for area in bulletin.forecast_areas:
            prefecture = next(
                (code for code, name in JMA_PREFECTURES.items() if area.name == name),
                None,
            )
            if prefecture is None:
                continue
            assessment_status = DisasterEventStatus.UNKNOWN if bulletin.info_type == "取消" else {
                TsunamiAreaStatus.ACTIVE: DisasterEventStatus.ACTIVE,
                TsunamiAreaStatus.CANCELLED: DisasterEventStatus.RESOLVED,
                TsunamiAreaStatus.UNKNOWN: DisasterEventStatus.UNKNOWN,
            }[area.status]
            # Only an ACTIVE official area may carry class/arrival (feeds level-2 logic).
            carries_warning = bulletin.info_type != "取消" and area.status == TsunamiAreaStatus.ACTIVE
            assessment = DisasterAssessment(
                area_id=f"JP-{prefecture}",
                event_type=DisasterEventType.TSUNAMI,
                level=None,
                status=assessment_status,
                tsunami_warning_class=area.warning_class if carries_warning else None,
                arrival_at=area.arrival_at if carries_warning else None,
                # InfoType 取消 withdraws the information unit: deterministic cancellation marker.
                withdrawn=bulletin.info_type == "取消",
            )
            existing = next((i for i, item in enumerate(assessments) if item.area_id == assessment.area_id), None)
            if existing is None:
                assessments.append(assessment)
            else:
                # Class/arrival are None on non-ACTIVE areas, so only ACTIVE areas contribute.
                # Status: ACTIVE wins over UNKNOWN wins over RESOLVED (conservative).
                prior = assessments[existing]
                status_rank = {DisasterEventStatus.ACTIVE: 2, DisasterEventStatus.UNKNOWN: 1}
                merged_status = max((prior.status, assessment.status), key=lambda v: status_rank.get(v, 0))
                stronger = _TSUNAMI_WARNING_RANK.get(assessment.tsunami_warning_class, -2) > _TSUNAMI_WARNING_RANK.get(
                    prior.tsunami_warning_class, -2
                )
                arrivals = [t for t in (prior.arrival_at, assessment.arrival_at) if t is not None]
                assessments[existing] = prior.model_copy(update={
                    "status": merged_status,
                    "withdrawn": prior.withdrawn and assessment.withdrawn and merged_status == DisasterEventStatus.UNKNOWN,
                    "tsunami_warning_class": assessment.tsunami_warning_class if stronger else prior.tsunami_warning_class,
                    "arrival_at": min(arrivals) if arrivals else None,
                })
            names.append(area.name)
        # Preserve withdrawn verified scope directly; never invent a forecast code.
        for previous_event, proof in previous:
            for assessment in proof.disaster_assessments:
                if assessment.event_type == DisasterEventType.TSUNAMI and all(item.area_id != assessment.area_id for item in assessments):
                    # The newer bulletin of the same unit no longer issues this area: withdrawn.
                    assessments.append(assessment.model_copy(update={"status": DisasterEventStatus.UNKNOWN, "level": None, "tsunami_warning_class": None, "arrival_at": None, "withdrawn": True}))
            names.extend(previous_event.affected_areas)
        if not assessments:
            return None

        assessment_statuses = {item.status for item in assessments}
        if DisasterEventStatus.ACTIVE in assessment_statuses:
            event_status = DisasterEventStatus.ACTIVE
        elif assessment_statuses == {DisasterEventStatus.RESOLVED}:
            event_status = DisasterEventStatus.RESOLVED
        else:
            event_status = DisasterEventStatus.UNKNOWN
        assessment_tuple = tuple(assessments)
        claims = claims_from_disaster_assessments(assessment_tuple)
        area_ids = tuple(item.area_id for item in assessments)
        group = bulletin.bulletin.group_id if bulletin.bulletin else sha256(bulletin.event_id.encode("utf-8")).hexdigest()[:16]
        revision = bulletin.serial or "none"
        event_id = (
            f"jma-tsunami-{bulletin.bulletin.report_id}" if bulletin.bulletin else
            f"jma-tsunami-{group}--{revision}-{int(bulletin.published_at.timestamp())}"
        )
        evidence_id = f"ev_{event_id}"
        if any(item.id == event_id for item in state.events) or any(item.id == evidence_id for item in state.evidence):
            return None
        expires_at = jma_report_deadline(bulletin)
        freshness = FreshnessStatus.CURRENT if now < expires_at else FreshnessStatus.STALE
        if freshness == FreshnessStatus.STALE and event_status == DisasterEventStatus.ACTIVE:
            event_status = DisasterEventStatus.UNKNOWN
        event = DisasterEvent(
            id=event_id,
            situation_id=state.situation.id,
            event_type=DisasterEventType.TSUNAMI,
            occurred_at=occurred_at,
            received_at=now,
            affected_areas=tuple(dict.fromkeys(names))[:20],
            affected_area_ids=area_ids,
            source_name=JMA_TSUNAMI_SOURCE_NAME,
            source_class=SourceClass.OFFICIAL,
            severity_raw=(
                "JMA VTSE41 tsunami warning classes: "
                + ",".join(sorted({item.warning_class.value for item in bulletin.forecast_areas}))[:42]
            ),
            status=event_status,
            raw_reference=bulletin.reference_url,
            is_synthetic=False,
        )
        evidence = Evidence(
            id=evidence_id,
            situation_id=state.situation.id,
            source_key=JMA_TSUNAMI_SOURCE_KEY,
            source_name=JMA_TSUNAMI_SOURCE_NAME,
            source_class=SourceClass.OFFICIAL,
            trust_status=TrustStatus.VERIFIED_OFFICIAL,
            freshness_status=freshness,
            published_at=bulletin.published_at,
            received_at=now,
            expires_at=expires_at,
            relevant_areas=tuple(dict.fromkeys(names))[:20],
            affected_area_ids=area_ids,
            disaster_assessments=assessment_tuple,
            claim_type=ClaimType.DISASTER_STATUS,
            claims=claims,
            summary=(
                "JMA VTSE41 tsunami forecast area/status was normalized only for exact prefecture-name matches. "
                "Tsunami height is not converted to earthquake L0-L4; area reference does not authorize movement."
            ),
            raw_reference=bulletin.reference_url,
            is_synthetic=False,
        )
        return event, evidence

    def _advance_time_locked(
        self,
        aggregate: LiveAggregate,
        now: datetime,
        event_id: str | None = None,
        *,
        allow_network_reconciliation: bool = True,
    ) -> None:
        if now < aggregate.state.current_time:
            now = aggregate.state.current_time
        if now == aggregate.state.current_time and event_id is None:
            return
        from .planning import evaluate_and_replan

        before = aggregate.state
        after = replace(before, current_time=now)
        situation = after.situation.model_copy(update={"updated_at": now})
        after = replace(after, situation=situation)
        clock_event = SimpleNamespace(id=event_id or f"live-clock-{int(now.timestamp())}")
        aggregate.state = evaluate_and_replan(
            before,
            after,
            clock_event,
            self._policy,
            allow_network_reconciliation=allow_network_reconciliation,
        )

    def _snapshot(self, aggregate: LiveAggregate) -> LiveSnapshot:
        state = aggregate.state
        projections = evidence_projections(
            state.evidence,
            state.situation,
            state.current_time,
            self._policy,
            events=state.events,
        )
        spatial = evaluated_spatial_guidance(state, state.current_time, self._policy)
        source = aggregate.source
        projected_source_status = jma_status_at_publication_deadline(
            source.status,
            source.last_published_at,
            state.current_time,
        )
        if projected_source_status != source.status:
            source = source.model_copy(
                update={
                    "status": projected_source_status,
                    "detail": "JMA publication freshness deadline elapsed; publication and retrieval timestamps are unchanged.",
                }
            )
        tsunami_source = aggregate.tsunami_source
        if tsunami_source:
            tsunami_status = jma_status_at_publication_deadline(tsunami_source.status, tsunami_source.last_published_at, state.current_time)
            if tsunami_status == LiveSourceStatus.FRESH and aggregate.tsunami_deadlines and not any(state.current_time < deadline for deadline in aggregate.tsunami_deadlines):
                tsunami_status = LiveSourceStatus.STALE
            tsunami_source = tsunami_source.model_copy(update={"status": tsunami_status})
        freshness_by_id = {item.evidence_id: item.freshness_status for item in projections}
        expired_event_ids = {item.id.removeprefix("ev_") for item in state.evidence
                            if freshness_by_id.get(item.id) == FreshnessStatus.STALE}
        # Project observation validity at read time, without rewriting stored
        # evidence, event history or prior plan versions.
        public_evidence = tuple(item.model_copy(update={"freshness_status": freshness_by_id[item.id]})
            if item.freshness_status == FreshnessStatus.CURRENT and freshness_by_id.get(item.id) in {FreshnessStatus.STALE, FreshnessStatus.UNKNOWN}
            else item for item in state.evidence)
        public_events = tuple(item.model_copy(update={"status": DisasterEventStatus.UNKNOWN})
            if item.id in expired_event_ids else item for item in state.events)
        return LiveSnapshot(
            session_id=aggregate.session_id,
            mode="LIVE",
            source=source,
            destination_source=aggregate.destination_source,
            route_source=aggregate.route_source,
            profile=state.profile,
            area_catalog=catalog_for_state(state, self._area_registry),
            situation=state.situation,
            events=public_events,
            evidence=public_evidence,
            evidence_projections=projections,
            plans=state.plans,
            plan_actions=state.plan_actions,
            trace=state.trace,
            plan_evaluations=state.plan_evaluations,
            distress=resolve_distress(state, state.current_time, self._policy),
            destinations=state.destinations,
            routes=state.routes,
            spatial_guidance=spatial,
            official_reports=tuple(item.model_copy(update={"lifecycle": "STALE"})
                if item.lifecycle == "CURRENT" and state.current_time >= item.evidence_expires_at else item
                for item in aggregate.official_reports),
            official_sources=(source, *((tsunami_source,) if tsunami_source else ())),
        )

    def _empty_jma_projection(self) -> LiveSourceProjection:
        return LiveSourceProjection(
            source_key=JMA_SOURCE_KEY,
            source_name=JMA_SOURCE_NAME,
            source_url=JMA_FEED_URL,
            status=LiveSourceStatus.UNAVAILABLE,
            detail="Live JMA source has not been queried yet.",
        )

    def _empty_destination_projection(self) -> LiveSourceProjection:
        return LiveSourceProjection(
            source_key=TOKYO_SHELTER_SOURCE_KEY,
            source_name=TOKYO_SHELTER_SOURCE_NAME,
            source_url=TOKYO_SHELTER_URL,
            status=LiveSourceStatus.UNAVAILABLE,
            last_published_at=TOKYO_SHELTER_PUBLISHED_AT,
            detail="Designation source has not been queried; current opening and capacity remain UNKNOWN.",
        )

    def _empty_route_projection(self) -> LiveSourceProjection:
        return LiveSourceProjection(
            source_key=EKISPERT_ROUTE_SOURCE_KEY,
            source_name=EKISPERT_ROUTE_SOURCE_NAME,
            source_url=EKISPERT_MCP_ENDPOINT,
            status=LiveSourceStatus.UNAVAILABLE,
            detail="Route provider has not been queried; transport data cannot determine route safety.",
        )

    def _get_aggregate(self, session_id: UUID) -> LiveAggregate:
        with self._lock:
            self._purge_expired_locked()
            aggregate = self._sessions.get(session_id)
            if aggregate is None:
                raise LiveSessionNotFound(str(session_id))
            self._touch(aggregate)
            return aggregate

    def _touch(self, aggregate: LiveAggregate) -> None:
        aggregate.expires_at = monotonic() + self._ttl_seconds

    def _purge_expired_locked(self) -> None:
        now = monotonic()
        expired = [key for key, aggregate in self._sessions.items() if aggregate.expires_at <= now]
        for key in expired:
            self._sessions.pop(key, None)
            self._planner.release_session(f"live-{key}")
            release_route_session = getattr(self._routes, "release_session", None)
            if callable(release_route_session):
                release_route_session(f"live-{key}")
