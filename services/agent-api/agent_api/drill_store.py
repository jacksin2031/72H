"""A separate bounded store for synthetic full-pipeline agent exercises."""
from __future__ import annotations

from threading import RLock
from time import monotonic
from uuid import UUID

from seventytwoh_contracts.models import ReplaySnapshot, StartReplayRequest

from .drill import DrillRequest, compile_drill
from .planner import CandidatePlanner
from .storage import (
    InvalidReplayTransition, ReplayStore, SessionCapacityReached, SessionNotFound,
)


class _DrillCandidatePlanner:
    """Inject allowlisted synthetic conditions into genuine candidate selection."""

    def __init__(self, planner: CandidatePlanner) -> None:
        self._planner = planner
        self._conditions: dict[str, dict[str, object]] = {}

    def register(self, replay_id: str, request: DrillRequest) -> None:
        self._conditions[replay_id] = {
            "simulation_only": True, "battery_percent": request.battery,
            "simulated_network": request.network, "mobility": request.mobility,
            "hazard": request.kind, "severity": f"L{request.severity}",
            "simulated_evidence": request.evidence,
        }

    async def select(self, replay_id: str, context: dict[str, object]):
        exercise = self._conditions.get(replay_id)
        if not exercise:
            raise ValueError("exercise context was not registered")
        return await self._planner.select(replay_id, {**context, "exercise_conditions": exercise})

    def release_session(self, replay_id: str) -> None:
        self._conditions.pop(replay_id, None)
        self._planner.release_session(replay_id)


class DrillStore:
    def __init__(self, *, planner: CandidatePlanner | None = None, max_sessions: int = 8, ttl_seconds: int = 1800) -> None:
        self._planner = _DrillCandidatePlanner(planner or CandidatePlanner())
        self._max = max_sessions
        self._ttl = ttl_seconds
        self._sessions: dict[UUID, tuple[ReplayStore, float]] = {}
        self._lock = RLock()

    def start(self, request: DrillRequest) -> ReplaySnapshot:
        scenario = compile_drill(request)
        with self._lock:
            self._purge()
            if len(self._sessions) >= self._max:
                raise SessionCapacityReached("synthetic drill capacity reached")
            store = ReplayStore(scenario=scenario, planner=self._planner, max_sessions=1, ttl_seconds=self._ttl)
            snapshot = store.start(StartReplayRequest(
                language=request.language, scenario_key=scenario.key,
            ))
            self._planner.register(str(snapshot.replay.id), request)
            self._sessions[snapshot.replay.id] = (store, monotonic() + self._ttl)
            return snapshot

    def get(self, session_id: UUID) -> ReplaySnapshot:
        return self._lookup(session_id).get(session_id)

    async def next(self, session_id: UUID) -> ReplaySnapshot:
        return await self._lookup(session_id).next_async(session_id)

    def _lookup(self, session_id: UUID) -> ReplayStore:
        with self._lock:
            self._purge()
            entry = self._sessions.get(session_id)
            if not entry:
                raise SessionNotFound("drill session not found")
            self._sessions[session_id] = (entry[0], monotonic() + self._ttl)
            return entry[0]

    def _purge(self) -> None:
        now = monotonic()
        expired = [key for key, (_, deadline) in self._sessions.items() if deadline <= now]
        for key in expired:
            self._sessions.pop(key, None)
            self._planner.release_session(str(key))
