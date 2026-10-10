"""Isolated live sessions backed by server-owned source adapters."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from threading import RLock
from time import monotonic
from types import SimpleNamespace
from uuid import UUID, uuid4

from seventytwoh_contracts.models import (
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
    TraceEvent,
    TraceStatus,
    TrustStatus,
    UserProfile,
    validate_location_area_path,
)

from .domain import apply_live_evidence_batch, apply_live_evidence_batch_with_planner, replan_live_transition_with_planner
from .area_registry import base_japan_area_catalog, catalog_for_state, load_japan_area_registry
from .live_sources import (
    JMA_EVIDENCE_TTL_SECONDS,
    JMA_FEED_URL,
    JMA_SOURCE_KEY,
    JMA_SOURCE_NAME,
    TOKYO_SHELTER_PUBLISHED_AT,
    TOKYO_SHELTER_SOURCE_KEY,
    TOKYO_SHELTER_SOURCE_NAME,
    TOKYO_SHELTER_URL,
    JmaEarthquakeReport,
    JmaEarthquakeSource,
    jma_status_at_publication_deadline,
    TokyoShelterSource,
)
from .planning import evidence_projections
from .location_freshness import gps_observation_is_fresh
from .safety import DEFAULT_POLICY, SafetyPolicy, claims_from_disaster_assessments, derive_claim_states
from .state import CoreState
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


@dataclass(slots=True)
class LiveAggregate:
    session_id: UUID
    state: CoreState
    source: LiveSourceProjection
    destination_source: LiveSourceProjection
    route_source: LiveSourceProjection
    expires_at: float
    lock: RLock = field(default_factory=RLock)
    operation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def build_live_area_catalog() -> tuple[AreaDefinition, ...]:
    return base_japan_area_catalog()


class LiveStore:
    """Session isolation around shared, rate-limited process-level source adapters."""

    def __init__(
        self,
        *,
        jma_source: JmaEarthquakeSource | None = None,
        destination_source: TokyoShelterSource | None = None,
        route_source: EkispertRouteSource | None = None,
        planner: CandidatePlanner | None = None,
        policy: SafetyPolicy | None = None,
        max_sessions: int = MAX_LIVE_SESSIONS,
        ttl_seconds: int = SESSION_TTL_SECONDS,
        now=None,
    ) -> None:
        self._jma = jma_source or JmaEarthquakeSource()
        self._destinations = destination_source or TokyoShelterSource()
        self._routes = route_source or EkispertRouteSource()
        self._planner = planner or CandidatePlanner()
        self._policy = policy or SafetyPolicy.from_env()
        self._max_sessions = max_sessions
        self._ttl_seconds = ttl_seconds
        self._now = now or (lambda: datetime.now(timezone.utc))
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
                    if len(before.trace) >= MAX_LIVE_TRACE_EVENTS - 8:
                        raise InvalidLiveLocationRequest("live trace capacity reached")
                    transition_time = max(now, before.current_time)
                    event_id = f"live-location-refresh-{len(before.trace) + 1}-{int(transition_time.timestamp())}"
                    trace = TraceEvent(
                        id=f"trace_{len(before.trace) + 1:03d}",
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
                    profile = before.profile.model_copy(
                        update={"current_location": location, "updated_at": transition_time}
                    )
                    after = replace(
                        before,
                        profile=profile,
                        current_time=transition_time,
                        trace=(*before.trace, trace),
                    )
                    event = SimpleNamespace(id=event_id)
                    from .planning import evaluate_and_replan

                    aggregate.state = evaluate_and_replan(
                        before,
                        after,
                        event,
                        self._policy,
                    )
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

            from .domain import replan_live_transition_with_planner
            from .planning import evaluate_and_replan

            event = SimpleNamespace(id=event_id)
            planned, _planning_mode = await replan_live_transition_with_planner(
                before,
                after,
                self._planner,
                f"live-{aggregate.session_id}",
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

            event = SimpleNamespace(id=event_id)
            planned, _planning_mode = await replan_live_transition_with_planner(
                before,
                after,
                self._planner,
                f"live-{aggregate.session_id}",
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
            source_result = self._jma.fetch_latest()
            destinations_payload = self._destinations.fetch_latest()
            now = self._now()
            pairs = self._apply_source_results_locked(aggregate, source_result, destinations_payload, now)
            aggregate.state = apply_live_evidence_batch(aggregate.state, pairs, now, self._policy, synthetic_mode=getattr(self, "_synthetic_source_mode", False))
            self._touch(aggregate)
            return self._snapshot(aggregate)

    async def refresh_async(self, session_id: UUID) -> LiveSnapshot:
        aggregate = self._get_aggregate(session_id)
        async with aggregate.operation_lock:
            source_result, destinations_payload = await asyncio.gather(
                asyncio.to_thread(self._jma.fetch_latest),
                asyncio.to_thread(self._destinations.fetch_latest),
            )
            with aggregate.lock:
                now = self._now()
                pairs = self._apply_source_results_locked(aggregate, source_result, destinations_payload, now)
                prepared = aggregate.state
            after, _planning_mode = await apply_live_evidence_batch_with_planner(
                prepared,
                pairs,
                max(now, prepared.current_time),
                self._planner,
                f"live-{aggregate.session_id}",
                self._policy,
                synthetic_mode=getattr(self, "_synthetic_source_mode", False),
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

    def _apply_source_results_locked(self, aggregate, source_result, destinations_payload, now):
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
        )
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
        network_state = (
            NetworkState.ONLINE_VERIFIED
            if source_result.status == LiveSourceStatus.FRESH
            else NetworkState.ONLINE_DEGRADED
        )
        aggregate.state = replace(
            aggregate.state,
            situation=aggregate.state.situation.model_copy(update={"network_state": network_state}),
        )
        if source_result.status not in {LiveSourceStatus.FRESH, LiveSourceStatus.STALE}:
            return ()
        return tuple(
            pair for report in source_result.reports
            if (pair := self._event_evidence_pair(aggregate.state, report, now)) is not None
        )

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

    def _event_evidence_pair(
        self,
        state: CoreState,
        report: JmaEarthquakeReport,
        now: datetime,
    ) -> tuple[DisasterEvent, Evidence] | None:
        event_id = f"jma-{report.report_id}"
        evidence_id = f"ev_{event_id}"
        if any(item.id == event_id for item in state.events) or any(item.id == evidence_id for item in state.evidence):
            return None
        observations = report.observations
        area_ids = tuple(dict.fromkeys(item.area_id for item in observations if item.area_id is not None))
        names = tuple(dict.fromkeys(item.name for item in observations))
        assessments = tuple(
            DisasterAssessment(
                area_id=area_id,
                event_type=DisasterEventType.EARTHQUAKE,
                level=None,
                status=DisasterEventStatus.ACTIVE,
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
            occurred_at=report.occurred_at,
            received_at=now,
            affected_areas=names[:20],
            affected_area_ids=area_ids,
            source_name=JMA_SOURCE_NAME,
            source_class=SourceClass.OFFICIAL,
            severity_raw="JMA earthquake intensity observations; no 72H severity mapping",
            status=DisasterEventStatus.ACTIVE,
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
                "JMA reported earthquake intensity by prefecture. All reported disaster assessments are retained; "
                f"exact intensity claims are retained only for profile areas {sorted(retained_intensity_area_ids) or 'none'}. "
                "72H severity is not inferred."
            ),
            raw_reference=report.reference_url,
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
        projections = evidence_projections(state.evidence, state.situation, state.current_time, self._policy)
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
        return LiveSnapshot(
            session_id=aggregate.session_id,
            mode="LIVE",
            source=source,
            destination_source=aggregate.destination_source,
            route_source=aggregate.route_source,
            profile=state.profile,
            area_catalog=catalog_for_state(state, self._area_registry),
            situation=state.situation,
            events=state.events,
            evidence=state.evidence,
            evidence_projections=projections,
            plans=state.plans,
            plan_actions=state.plan_actions,
            trace=state.trace,
            plan_evaluations=state.plan_evaluations,
            destinations=state.destinations,
            routes=state.routes,
            spatial_guidance=spatial,
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
