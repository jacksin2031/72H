"""Per-session Mock Live source adapters feeding the *real* LiveStore.

Never use these adapters in ordinary LiveStore construction. Every mock event
remains synthetic through normalization, planning, evidence and UI projection.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from threading import RLock
from time import monotonic
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from seventytwoh_contracts.models import (
    LiveSnapshot, LiveSourceStatus, NetworkState, SelfReportedSafetyStatus, StartLiveRequest,
)
from .drill import DrillRequest
from .drill_store import _DrillCandidatePlanner
from .live import LiveSessionNotFound, LiveStore
from .live_sources import JmaEarthquakeReport, JmaPrefObservation, JmaFetchResult
from .planner import CandidatePlanner
from .scenario import load_scenario

MOCK_MODE = "MOCK_LIVE"
MOCK_JMA_NAME = "SIMULATED JMA provider (NOT official)"
MAX_MOCK_SESSIONS = 8
MOCK_TTL = 30 * 60


class MockLiveResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["MOCK_LIVE"] = MOCK_MODE
    current_step: int
    total_steps: int
    ai_modes: tuple[str, ...] = ()
    battery: int | None = None
    snapshot: LiveSnapshot


class MockJmaSource:
    """No HTTP usage. Reports have synthetic provenance and current bounded timestamps."""
    def __init__(self, request: DrillRequest) -> None:
        self.request = request
        self.stage = 0

    def fetch_latest(self) -> JmaFetchResult:
        now = datetime.now(timezone.utc)
        stage = self.stage
        if stage == 0 or self.request.evidence == "UNKNOWN":
            return JmaFetchResult(LiveSourceStatus.UNAVAILABLE, now, None, None, (),
                                  "MOCK LIVE: no official data; synthetic exercise only")
        if stage == 2 and self.request.network != "ONLINE":
            return JmaFetchResult(LiveSourceStatus.UNAVAILABLE, now, None, None, (),
                                  "MOCK LIVE: simulated source outage, no provider queried")
        published = now - timedelta(hours=2) if self.request.evidence == "STALE" else now
        status = LiveSourceStatus.STALE if self.request.evidence == "STALE" else LiveSourceStatus.FRESH
        report = JmaEarthquakeReport(
            report_id=f"mock-{stage}",
            title=f"SIMULATION L{self.request.severity}",
            published_at=published,
            occurred_at=published,
            reference_url=f"mock://72h/earthquake/{stage}",
            observations=(JmaPrefObservation(code="13", name="東京都 (MOCK)", max_intensity=None),),
        )
        return JmaFetchResult(status, now, published, None, (report,),
                              f"MOCK LIVE: simulated earthquake L{self.request.severity}; never JMA")


class MockDestinationSource:
    def fetch_latest(self):
        return (LiveSourceStatus.UNAVAILABLE, (), None, None)


class MockRouteSource:
    async def search(self, **_kwargs):
        from .live_routes import RouteFetchResult
        return RouteFetchResult(LiveSourceStatus.UNAVAILABLE, None, None, None,
                                "MOCK LIVE: route search blocked; no provider called")
    def release_session(self, _session_id: str) -> None:
        pass


class RecordingMockPlanner(_DrillCandidatePlanner):
    def __init__(self, planner: CandidatePlanner):
        super().__init__(planner)
        self.outcomes: dict[str, list[str]] = {}

    async def select(self, replay_id, context):
        outcome = await super().select(replay_id, context)
        self.outcomes.setdefault(replay_id, []).append(outcome.mode)
        return outcome

    def release_session(self, replay_id):
        self.outcomes.pop(replay_id, None)
        super().release_session(replay_id)


class MockLiveStore(LiveStore):
    """Use the existing Live reducers and planning with synthetic-only adapters."""
    def __init__(self, request: DrillRequest, planner: RecordingMockPlanner):
        self._synthetic_source_mode = True
        self.mock_source = MockJmaSource(request)
        self.mock_request = request
        super().__init__(
            jma_source=self.mock_source,
            destination_source=MockDestinationSource(),
            route_source=MockRouteSource(),
            planner=planner,
            max_sessions=1,
            ttl_seconds=MOCK_TTL,
        )

    def _event_evidence_pair(self, state, report, now):
        pair = super()._event_evidence_pair(state, report, now)
        if pair is None:
            return None
        event, evidence = pair
        event = event.model_copy(update={
            "source_name": MOCK_JMA_NAME,
            "severity_raw": f"SYNTHETIC L{self.mock_request.severity}; not real JMA seismic intensity",
            "raw_reference": report.reference_url,
            "is_synthetic": True,
        })
        evidence = evidence.model_copy(update={
            "source_name": MOCK_JMA_NAME,
            "summary": f"SYNTHETIC ONLY: emulated L{self.mock_request.severity} event in Tokyo. No verified Live JMA observation.",
            "raw_reference": report.reference_url,
            "is_synthetic": True,
            "eligible_for_high_risk": False,
        })
        return event, evidence

    def _apply_source_results_locked(self, aggregate, source_result, destinations_payload, now):
        pairs = super()._apply_source_results_locked(aggregate, source_result, destinations_payload, now)
        if self.mock_source.stage == 2 and self.mock_request.network != "ONLINE":
            aggregate.state = replace(
                aggregate.state,
                situation=aggregate.state.situation.model_copy(
                    update={"network_state": NetworkState.OFFLINE_RECENT}
                ),
            )
        elif self.mock_source.stage == 3 and self.mock_request.network == "RECONNECTING":
            aggregate.state = replace(
                aggregate.state,
                situation=aggregate.state.situation.model_copy(
                    update={"network_state": NetworkState.RECONNECTING}
                ),
            )
        return pairs

    def _snapshot(self, aggregate):
        snapshot = super()._snapshot(aggregate)
        # Never let real official origin labels be presented as actual reporting.
        simulated = snapshot.model_copy(update={
            "source": snapshot.source.model_copy(update={
                "source_name": MOCK_JMA_NAME,
                "source_url": "mock://72h/jma",
                "detail": "SIMULATION ONLY. " + snapshot.source.detail[:210],
            }),
            "destination_source": snapshot.destination_source.model_copy(update={
                "source_name": "SIMULATED shelter source (empty)",
                "source_url": "mock://72h/shelter",
                "detail": "SIMULATION ONLY. No shelters have been verified.",
            }),
            "route_source": snapshot.route_source.model_copy(update={
                "source_name": "SIMULATED route source (blocked)",
                "source_url": "mock://72h/routes",
                "detail": "SIMULATION ONLY. No route has been verified.",
            }),
        })
        if (simulated.spatial_guidance.movement_authorized
            or any(not item.is_synthetic for item in simulated.evidence)
            or any(not item.is_synthetic for item in simulated.events)
            or any(item.risk_level == "HIGH" and item.safety_decision == "ALLOW"
                   for item in simulated.plan_actions)):
            raise RuntimeError("Mock Live fail-closed integrity gate rejected unsafe projection")
        return simulated


@dataclass(slots=True)
class _MockSession:
    store: MockLiveStore
    planner: RecordingMockPlanner
    request: DrillRequest
    expires: float
    lock: asyncio.Lock


class MockLiveDrillStore:
    def __init__(self, *, planner: CandidatePlanner | None = None, max_sessions: int = MAX_MOCK_SESSIONS):
        self._planner = planner or CandidatePlanner()
        self._max = max_sessions
        self._sessions: dict[UUID, _MockSession] = {}
        self._lock = RLock()

    def _purge(self) -> None:
        expired = [k for k, s in self._sessions.items() if s.expires <= monotonic()]
        for k in expired:
            s = self._sessions.pop(k)
            s.planner.release_session(f"live-{k}")

    def _lookup(self, id: UUID) -> _MockSession:
        with self._lock:
            self._purge()
            session = self._sessions.get(id)
            if session is None:
                raise LiveSessionNotFound("mock live session not found")
            session.expires = monotonic() + MOCK_TTL
            return session

    def _response(self, session: _MockSession, snapshot: LiveSnapshot) -> MockLiveResponse:
        self._assert_not_live(snapshot)
        return MockLiveResponse(
            current_step=session.store.mock_source.stage,
            total_steps=3 if session.request.network == "RECONNECTING" else 2,
            ai_modes=tuple(session.planner.outcomes.get(f"live-{snapshot.session_id}", ())),
            battery=session.request.battery,
            snapshot=snapshot,
        )

    @staticmethod
    def _assert_not_live(snapshot: LiveSnapshot) -> None:
        if snapshot.spatial_guidance.movement_authorized or snapshot.routes or snapshot.destinations:
            raise RuntimeError("Mock Live cannot authorize real movement or places")

    async def start(self, request: DrillRequest) -> MockLiveResponse:
        with self._lock:
            self._purge()
            if len(self._sessions) >= self._max:
                from .storage import SessionCapacityReached
                raise SessionCapacityReached("mock live exercise capacity reached")
        instrumented = RecordingMockPlanner(self._planner)
        store = MockLiveStore(request, instrumented)
        # Replay sample contains area IDs that are intentionally absent in the
        # canonical Live registry. Use only registered synthetic Tokyo scope.
        base = load_scenario().profile_seed
        mock_location = base.current_location.model_copy(update={
            "label": "Tokyo exercise area (MOCK)", "lat": None, "lng": None,
            "area_ids": ("JP-13", "JP"), "observed_at": None, "source": None,
        })
        seed = base.model_copy(update={
            "current_location": mock_location,
            "accommodation_location": mock_location,
            "current_destination": None,
            "self_reported_safety_status": (SelfReportedSafetyStatus.NEEDS_ASSISTANCE if request.mobility == "CANNOT_MOVE" else SelfReportedSafetyStatus.UNCERTAIN),
            "accessibility_constraints": ("MOBILITY_SUPPORT",) if request.mobility == "CANNOT_MOVE" else (),
            "current_plan_summary": "SIMULATION ONLY",
        })
        snap = await store.start_async(StartLiveRequest(language=request.language, profile=seed))
        instrumented.register(f"live-{snap.session_id}", request)
        session = _MockSession(store, instrumented, request, monotonic() + MOCK_TTL, asyncio.Lock())
        with self._lock:
            self._purge()
            if len(self._sessions) >= self._max:
                raise RuntimeError("mock live capacity race")
            self._sessions[snap.session_id] = session
        return self._response(session, snap)

    def get(self, id: UUID) -> MockLiveResponse:
        session = self._lookup(id)
        return self._response(session, session.store.get(id))

    async def next(self, id: UUID) -> MockLiveResponse:
        session = self._lookup(id)
        async with session.lock:
            stage = session.store.mock_source.stage
            max_steps = 3 if session.request.network == "RECONNECTING" else 2
            if stage >= max_steps:
                from .storage import InvalidReplayTransition
                raise InvalidReplayTransition("mock live exercise completed")
            session.store.mock_source.stage = stage + 1
            try:
                snap = await session.store.refresh_async(id)
            except Exception:
                session.store.mock_source.stage = stage
                raise
            return self._response(session, snap)
