"""Bounded in-memory replay sessions for the local synthetic demo."""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import RLock
from time import monotonic
from uuid import UUID, uuid4

from seventytwoh_contracts.models import (
    IncidentStatus,
    Language,
    NetworkState,
    ProfileSeed,
    ReplayScenario,
    ReplayScenarioOption,
    ReplaySession,
    ReplaySnapshot,
    ReplayStatus,
    Situation,
    StartReplayRequest,
    UserProfile,
    validate_location_area_path,
)

from .domain import CoreState, reduce_event, reduce_event_with_planner
from .planning import evidence_projections
from .planner import CandidatePlanner
from .scenario import (
    DEFAULT_SCENARIO_KEY,
    load_registered_scenarios,
    scenario_options,
    timeline_event,
)
from .safety import SafetyPolicy, derive_claim_states

SESSION_TTL_SECONDS = 6 * 60 * 60
MAX_SESSIONS = 64
MODE_LABEL = "Synthetic replay data; not live official information"
DETERMINISTIC_SEED = "72h-phase1-replay-v1"


class SessionNotFound(KeyError):
    pass


class InvalidReplayTransition(ValueError):
    pass


class SessionCapacityReached(RuntimeError):
    pass


class InvalidReplayProfile(ValueError):
    pass


class InvalidReplayScenario(ValueError):
    pass


@dataclass(slots=True)
class SessionAggregate:
    session: ReplaySession
    state: CoreState
    scenario: ReplayScenario
    profile_seed: ProfileSeed
    expires_at: float
    lock: RLock = field(default_factory=RLock)


class ReplayStore:
    """Session-isolated store with bounded count and inactivity TTL."""

    def __init__(
        self,
        scenario: ReplayScenario | None = None,
        *,
        policy: SafetyPolicy | None = None,
        planner: CandidatePlanner | None = None,
        max_sessions: int = MAX_SESSIONS,
        ttl_seconds: int = SESSION_TTL_SECONDS,
    ) -> None:
        self._scenarios = (
            {scenario.key: scenario}
            if scenario is not None
            else load_registered_scenarios()
        )
        self._default_scenario_key = (
            scenario.key if scenario is not None else DEFAULT_SCENARIO_KEY
        )
        if self._default_scenario_key not in self._scenarios:
            raise ValueError("default replay scenario is not registered")
        self._policy = policy or SafetyPolicy.from_env()
        self._planner = planner or CandidatePlanner()
        self._max_sessions = max_sessions
        self._ttl_seconds = ttl_seconds
        self._sessions: dict[UUID, SessionAggregate] = {}
        self._lock = RLock()

    def start(self, request: StartReplayRequest | None = None) -> ReplaySnapshot:
        language = request.language if request else Language.TRADITIONAL_CHINESE
        scenario_key = (
            request.scenario_key
            if request and request.scenario_key is not None
            else self._default_scenario_key
        )
        scenario = self._scenarios.get(scenario_key)
        if scenario is None:
            raise InvalidReplayScenario("scenario_key is not present in the server registry")
        profile_seed = request.profile if request and request.profile is not None else scenario.profile_seed
        try:
            area_by_id = {area.id: area for area in scenario.area_catalog}
            for location in (
                profile_seed.current_location,
                profile_seed.accommodation_location,
                profile_seed.current_destination,
            ):
                if location is not None:
                    validate_location_area_path(location, area_by_id)
        except ValueError as exc:
            raise InvalidReplayProfile(f"profile location is outside the scenario area catalog: {exc}") from exc
        with self._lock:
            self._purge_expired_locked()
            if len(self._sessions) >= self._max_sessions:
                raise SessionCapacityReached("replay session capacity reached")
            session_id = uuid4()
            situation_id = f"sit_{session_id.hex}"
            initial = self._initial_state(session_id, situation_id, language, profile_seed, scenario)
            session = ReplaySession(
                id=session_id,
                scenario_key=scenario.key,
                status=ReplayStatus.RUNNING,
                speed=1,
                started_at=scenario.start_time,
                current_time=scenario.start_time,
                current_event_index=0,
                deterministic_seed=DETERMINISTIC_SEED,
                situation_id=situation_id,
                mode="SYNTHETIC_REPLAY",
                mode_label=MODE_LABEL,
                planning_mode="DETERMINISTIC_REPLAY_ONLY",
                next_event_delay_seconds=0.0,
            )
            aggregate = SessionAggregate(
                session=session,
                state=initial,
                scenario=scenario,
                profile_seed=profile_seed,
                expires_at=monotonic() + self._ttl_seconds,
            )
            self._sessions[session_id] = aggregate
            return self._snapshot(aggregate)

    def available_scenarios(self) -> tuple[ReplayScenarioOption, ...]:
        return scenario_options(self._scenarios)

    def get(self, session_id: UUID) -> ReplaySnapshot:
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            self._touch(aggregate)
            return self._snapshot(aggregate)

    def pause(self, session_id: UUID) -> ReplaySnapshot:
        return self._set_status(
            session_id,
            allowed={ReplayStatus.RUNNING, ReplayStatus.PAUSED},
            target=ReplayStatus.PAUSED,
        )

    def resume(self, session_id: UUID) -> ReplaySnapshot:
        return self._set_status(
            session_id,
            allowed={ReplayStatus.READY, ReplayStatus.PAUSED, ReplayStatus.RUNNING},
            target=ReplayStatus.RUNNING,
        )

    def set_speed(self, session_id: UUID, speed: int) -> ReplaySnapshot:
        if speed not in {1, 2, 4}:
            raise InvalidReplayTransition("speed must be one of 1, 2, or 4")
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            if aggregate.session.status == ReplayStatus.COMPLETED:
                raise InvalidReplayTransition("completed replay must be reset before changing speed")
            aggregate.session = aggregate.session.model_copy(update={"speed": speed})
            self._touch(aggregate)
            return self._snapshot(aggregate)

    def next(self, session_id: UUID) -> ReplaySnapshot:
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            if aggregate.session.status not in {ReplayStatus.RUNNING, ReplayStatus.PAUSED}:
                raise InvalidReplayTransition("replay must be running or paused before advancing")
            index = aggregate.session.current_event_index
            if index >= len(aggregate.scenario.events):
                raise InvalidReplayTransition("replay has no remaining events")

            # Compute the entire next value first. If validation/reduction fails, the session is unchanged.
            event = aggregate.scenario.events[index]
            new_state = reduce_event(aggregate.state, event, self._policy)
            new_index = index + 1
            new_status = aggregate.session.status
            if new_index == len(aggregate.scenario.events):
                new_status = ReplayStatus.COMPLETED
            new_session = aggregate.session.model_copy(
                update={
                    "status": new_status,
                    "current_event_index": new_index,
                    "current_time": event.occurred_at,
                }
            )
            aggregate.state = new_state
            aggregate.session = new_session
            self._touch(aggregate)
            return self._snapshot(aggregate)

    async def next_async(self, session_id: UUID) -> ReplaySnapshot:
        """Advance one event, publishing only after optional candidate validation."""
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            if aggregate.session.status not in {ReplayStatus.RUNNING, ReplayStatus.PAUSED}:
                raise InvalidReplayTransition("replay must be running or paused before advancing")
            index = aggregate.session.current_event_index
            if index >= len(aggregate.scenario.events):
                raise InvalidReplayTransition("replay has no remaining events")
            captured_session = aggregate.session
            captured_state = aggregate.state
            event = aggregate.scenario.events[index]

        new_state, planning_mode = await reduce_event_with_planner(
            captured_state,
            event,
            self._planner,
            str(captured_session.id),
            self._policy,
        )
        new_index = index + 1
        new_status = (
            ReplayStatus.COMPLETED
            if new_index == len(aggregate.scenario.events)
            else captured_session.status
        )
        with aggregate.lock:
            if aggregate.state is not captured_state or aggregate.session != captured_session:
                raise InvalidReplayTransition("replay changed while candidate planning was in progress")
            aggregate.state = new_state
            aggregate.session = captured_session.model_copy(
                update={
                    "status": new_status,
                    "current_event_index": new_index,
                    "current_time": event.occurred_at,
                    "planning_mode": planning_mode or captured_session.planning_mode,
                }
            )
            self._touch(aggregate)
            return self._snapshot(aggregate)

    def reset(self, session_id: UUID) -> ReplaySnapshot:
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            situation_id = aggregate.session.situation_id
            user_id = aggregate.state.profile.id
            language = aggregate.state.profile.preferred_language
            aggregate.state = self._initial_state(
                aggregate.session.id,
                situation_id,
                language,
                aggregate.profile_seed,
                aggregate.scenario,
                user_id=user_id,
            )
            aggregate.session = aggregate.session.model_copy(
                update={
                    "status": ReplayStatus.READY,
                    "speed": 1,
                    "current_event_index": 0,
                    "current_time": aggregate.scenario.start_time,
                    "planning_mode": "DETERMINISTIC_REPLAY_ONLY",
                    "next_event_delay_seconds": 0.0,
                }
            )
            self._touch(aggregate)
            return self._snapshot(aggregate)

    def _set_status(
        self,
        session_id: UUID,
        *,
        allowed: set[ReplayStatus],
        target: ReplayStatus,
    ) -> ReplaySnapshot:
        aggregate = self._get_aggregate(session_id)
        with aggregate.lock:
            if aggregate.session.status not in allowed:
                raise InvalidReplayTransition(
                    f"cannot change replay from {aggregate.session.status.value} to {target.value}"
                )
            aggregate.session = aggregate.session.model_copy(update={"status": target})
            self._touch(aggregate)
            return self._snapshot(aggregate)

    def _get_aggregate(self, session_id: UUID) -> SessionAggregate:
        with self._lock:
            self._purge_expired_locked()
            aggregate = self._sessions.get(session_id)
            if aggregate is None:
                raise SessionNotFound(str(session_id))
            self._touch(aggregate)
            return aggregate

    def _touch(self, aggregate: SessionAggregate) -> None:
        aggregate.expires_at = monotonic() + self._ttl_seconds

    def _purge_expired_locked(self) -> None:
        now = monotonic()
        expired = [key for key, value in self._sessions.items() if value.expires_at <= now]
        for key in expired:
            self._sessions.pop(key, None)
            self._planner.release_session(str(key))

    def _snapshot(self, aggregate: SessionAggregate) -> ReplaySnapshot:
        session = aggregate.session
        if session.status != ReplayStatus.COMPLETED and session.current_event_index < len(aggregate.scenario.events):
            previous_offset = (
                aggregate.scenario.events[session.current_event_index - 1].offset_seconds
                if session.current_event_index > 0
                else 0
            )
            next_offset = aggregate.scenario.events[session.current_event_index].offset_seconds
            delay = max(0.0, (next_offset - previous_offset) / session.speed)
        else:
            delay = None
        session_for_snapshot = session.model_copy(
            update={"next_event_delay_seconds": delay}
        )
        return ReplaySnapshot(
            profile=aggregate.state.profile,
            area_catalog=aggregate.scenario.area_catalog,
            situation=aggregate.state.situation,
            events=aggregate.state.events,
            evidence=aggregate.state.evidence,
            evidence_projections=evidence_projections(
                aggregate.state.evidence,
                aggregate.state.situation,
                aggregate.state.current_time,
                self._policy,
                events=aggregate.state.events,
            ),
            plans=aggregate.state.plans,
            plan_actions=aggregate.state.plan_actions,
            trace=aggregate.state.trace,
            replay=session_for_snapshot,
            scenario_events=tuple(timeline_event(event) for event in aggregate.scenario.events),
            mobility=aggregate.state.mobility,
            plan_evaluations=aggregate.state.plan_evaluations,
        )

    def _initial_state(
        self,
        session_id: UUID,
        situation_id: str,
        language: Language,
        profile_seed: ProfileSeed,
        scenario: ReplayScenario,
        *,
        user_id: str | None = None,
    ) -> CoreState:
        user_id = user_id or f"user_demo_{session_id.hex}"
        initial_time = scenario.start_time
        profile = UserProfile(
            id=user_id,
            preferred_language=language,
            **profile_seed.model_dump(),
            created_at=initial_time,
            updated_at=initial_time,
        )
        situation = Situation(
            id=situation_id,
            user_id=user_id,
            incident_status=IncidentStatus.IDLE,
            network_state=NetworkState.ONLINE_VERIFIED,
            created_at=initial_time,
            updated_at=initial_time,
        )
        initial_claim_states, _, _ = derive_claim_states(
            situation, (), initial_time, self._policy
        )
        situation = situation.model_copy(update={"claim_states": initial_claim_states})
        return CoreState(
            profile=profile,
            situation=situation,
            current_time=initial_time,
            scenario_key=scenario.key,
            area_catalog=scenario.area_catalog,
        )
