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


class DrillStore:
    def __init__(self, *, planner: CandidatePlanner | None = None, max_sessions: int = 8, ttl_seconds: int = 1800) -> None:
        self._planner = planner or CandidatePlanner()
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
