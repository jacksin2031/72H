"""Per-session Mock Live source adapters feeding the *real* LiveStore.

Never use these adapters in ordinary LiveStore construction. Every mock event
remains synthetic through normalization, planning, evidence and UI projection.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace, field
from datetime import datetime, timedelta, timezone
from threading import RLock
from time import monotonic
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StrictBool, model_validator
from seventytwoh_contracts.models import (
    LiveSnapshot, LiveSourceStatus, NetworkState, SelfReportedSafetyStatus, StartLiveRequest,
    TsunamiOperation,LocationSource,
)
from .drill import DrillRequest
from .historical_cases import CASES, HistoricalId, HistoricCase, list_historical_cases
from .live import LiveSessionNotFound, LiveStore
from .live_sources import JmaEarthquakeReport, JmaPrefObservation, JmaFetchResult, JmaTsunamiFetchResult
from .planner import CandidatePlanner
from .scenario import load_scenario
from .simulation_advice import SimulationLocation,SimulationConditions,SimulationAdvisor,SimulationAssessment,build_advice_envelope
from .area_registry import load_japan_area_registry

MOCK_MODE = "MOCK_LIVE"
MOCK_JMA_NAME = "SIMULATED JMA provider (NOT official)"
MAX_MOCK_SESSIONS = 8
MOCK_TTL = 30 * 60


class MockLiveRequest(DrillRequest):
    use_gemini: StrictBool = False
    location_context: SimulationLocation | None = None
    conditions: SimulationConditions = SimulationConditions()
    historical_case: HistoricalId | None = None
    historical_start_jst: datetime | None = None
    historical_end_jst: datetime | None = None

    @model_validator(mode="after")
    def validate_historical_window(self) -> "MockLiveRequest":
        begin, end = self.historical_start_jst, self.historical_end_jst
        if begin is None and end is None:
            return self
        if self.historical_case is None or begin is None or end is None:
            raise ValueError("Historical time range requires case, start and end")
        if begin.utcoffset() != timedelta(hours=9) or end.utcoffset() != timedelta(hours=9):
            raise ValueError("Historical time selection must include JST +09:00 offset")
        if begin > end:
            raise ValueError("Historical range start must not exceed end")
        case = CASES[self.historical_case]
        first = datetime.fromisoformat(case.milestones[0].at_jst)
        last = datetime.fromisoformat(case.milestones[-1].at_jst)
        if begin < first or end > last:
            raise ValueError("Historical range must be within the selected case")
        if not any(begin <= datetime.fromisoformat(m.at_jst) <= end for m in case.milestones):
            raise ValueError("Selected historical range has no milestones")
        return self


def selected_milestones(request: MockLiveRequest):
    if request.historical_case is None:
        return ()
    case = CASES[request.historical_case]
    if request.historical_start_jst is None:
        return case.milestones
    return tuple(m for m in case.milestones if
                 request.historical_start_jst <= datetime.fromisoformat(m.at_jst) <= request.historical_end_jst)


class HistoricalView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_id: HistoricalId
    title: dict[str, str]
    source_url: str
    magnitude: str
    max_intensity: str
    milestones: tuple[dict, ...]
    current_milestone: dict | None = None
    advisory_is_not_safety_core_input: bool = True


class MockLiveResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["MOCK_LIVE"] = MOCK_MODE
    current_step: int
    total_steps: int
    ai_modes: tuple[str, ...] = ()
    battery: int | None = None
    snapshot: LiveSnapshot
    historical: HistoricalView | None = None
    movement_assessment: SimulationAssessment | None = None
    movement_assessment_history: tuple[SimulationAssessment,...] = ()


class MockJmaSource:
    """No HTTP usage. Reports have synthetic provenance and current bounded timestamps."""
    def __init__(self, request: MockLiveRequest) -> None:
        self.request = request
        self.historic = CASES.get(request.historical_case) if request.historical_case else None
        self.milestones = selected_milestones(request)
        self.stage = 0

    def fetch_latest(self) -> JmaFetchResult:
        now = datetime.now(timezone.utc)
        stage = self.stage
        if stage == 0 or self.request.evidence == "UNKNOWN":
            return JmaFetchResult(LiveSourceStatus.UNAVAILABLE, now, None, None, (),
                                  "MOCK LIVE: no official data; synthetic exercise only")
        if self.historic and stage <= len(self.milestones):
            milestone = self.milestones[stage - 1]
            # The actual 2011 etc timestamps live in the historic metadata; the
            # official-source deadline evaluator uses the synthetic runtime clock.
            if milestone.kind not in {"EARTHQUAKE", "AFTERSHOCK"}:
                if self.request.network == "OFFLINE":
                    return JmaFetchResult(LiveSourceStatus.UNAVAILABLE, now, None, None, (),
                                          "MOCK historical timeline: simulated outage; no fresh feed.")
                return JmaFetchResult(LiveSourceStatus.FRESH, now, now, None, (),
                                      f"MOCK historical supplemental event {milestone.kind}: unsupported by earthquake Safety Core.")
            published = now - timedelta(hours=2) if self.request.evidence == "STALE" else now
            result_status = LiveSourceStatus.STALE if self.request.evidence == "STALE" else LiveSourceStatus.FRESH
            report = JmaEarthquakeReport(
                report_id=f"historical-{self.historic.id}-{stage}",
                title=f"HISTORICAL EXERCISE: {milestone.en}",
                published_at=published,
                occurred_at=published,
                reference_url=f"mock://72h/historical/{self.historic.id}/{stage}",
                observations=(JmaPrefObservation(code=self.historic.area_code,
                                                 name=f"{self.historic.area_ja} (MOCK)",
                                                 max_intensity=self.historic.max_intensity),),
            )
            return JmaFetchResult(result_status, now, published, None, (report,),
                                  f"MOCK LIVE historical {self.historic.id}; archived {milestone.at_jst}; not live JMA.")
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


class MockTsunamiSource:
    """Keep Mock Live isolated from the real JMA tsunami adapter and network."""

    def fetch_latest(self) -> JmaTsunamiFetchResult:
        now = datetime.now(timezone.utc)
        return JmaTsunamiFetchResult(
            status=LiveSourceStatus.UNSUPPORTED,
            retrieved_at=now,
            last_published_at=None,
            next_retry_at=None,
            operation=TsunamiOperation.UNKNOWN,
            serial=None,
            bulletins=(),
            forecast_areas=(),
            conflict=False,
            detail="MOCK LIVE: no official tsunami data is requested or simulated.",
        )


class MockRouteSource:
    async def search(self, **_kwargs):
        from .live_routes import RouteFetchResult
        return RouteFetchResult(LiveSourceStatus.UNAVAILABLE, None, None, None,
                                "MOCK LIVE: route search blocked; no provider called")
    def release_session(self, _session_id: str) -> None:
        pass


class MockLiveStore(LiveStore):
    """Use the existing Live reducers and planning with synthetic-only adapters."""
    def __init__(self, request: MockLiveRequest, planner: CandidatePlanner):
        self._synthetic_source_mode = True
        self.mock_source = MockJmaSource(request)
        self.mock_request = request
        super().__init__(
            jma_source=self.mock_source,
            tsunami_source=MockTsunamiSource(),
            destination_source=MockDestinationSource(),
            route_source=MockRouteSource(),
            planner=planner,
            max_sessions=1,
            ttl_seconds=MOCK_TTL,
        )

    def _event_evidence_pair(self, state, report, now, legacy_metadata=None):
        pair = super()._event_evidence_pair(state, report, now, legacy_metadata)
        if pair is None:
            return None
        event, evidence = pair
        historic = self.mock_source.historic
        event = event.model_copy(update={
            "source_name": MOCK_JMA_NAME,
            "severity_raw": (f"HISTORICAL EXERCISE max intensity {historic.max_intensity} (not live)"
                             if historic else f"SYNTHETIC L{self.mock_request.severity}; not real JMA seismic intensity"),
            "raw_reference": report.reference_url,
            "is_synthetic": True,
        })
        evidence = evidence.model_copy(update={
            "source_name": MOCK_JMA_NAME,
            "summary": (f"SYNTHETIC HISTORICAL EXERCISE: {historic.id}, archived maximum JMA intensity {historic.max_intensity}, replayed on an artificial runtime clock."
                        if historic else f"SYNTHETIC ONLY: emulated L{self.mock_request.severity} event in Tokyo. No verified Live JMA observation."),
            "raw_reference": report.reference_url,
            "is_synthetic": True,
            "eligible_for_high_risk": False,
        })
        return event, evidence

    def _apply_source_results_locked(self, aggregate, source_result, tsunami_result, destinations_payload, now, legacy_metadata):
        pairs, aliases = super()._apply_source_results_locked(
            aggregate, source_result, tsunami_result, destinations_payload, now, legacy_metadata
        )
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
        return pairs, aliases

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
    planner: CandidatePlanner
    request: MockLiveRequest
    expires: float
    lock: asyncio.Lock
    assessments: list[SimulationAssessment] = field(default_factory=list)


class MockLiveDrillStore:
    def __init__(self, *, planner: CandidatePlanner | None = None, max_sessions: int = MAX_MOCK_SESSIONS, advisor: SimulationAdvisor | None = None):
        self._planner = planner or CandidatePlanner()
        self._max = max_sessions
        self._sessions: dict[UUID, _MockSession] = {}
        self._lock = RLock()
        self._advisor = advisor or SimulationAdvisor()

    def _purge(self) -> None:
        expired = [k for k, s in self._sessions.items() if s.expires <= monotonic()]
        for k in expired:
            s = self._sessions.pop(k)
            s.planner.release_session(f"live-{k}")
            self._advisor.release_session(str(k))

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
            total_steps=(len(session.store.mock_source.milestones)
                         if session.request.historical_case else 3 if session.request.network == "RECONNECTING" else 2),
            ai_modes=(),
            battery=session.request.battery,
            snapshot=snapshot,
            historical=self._historical_view(session),
            movement_assessment=session.assessments[-1] if session.assessments else None,
            movement_assessment_history=tuple(session.assessments),
        )

    @staticmethod
    def _historical_view(session: _MockSession) -> HistoricalView | None:
        if not session.request.historical_case:
            return None
        case = CASES[session.request.historical_case]
        milestones = session.store.mock_source.milestones
        step = session.store.mock_source.stage
        return HistoricalView(
            case_id=case.id, title={"ja": case.ja, "zh-TW": case.zh, "en": case.en},
            source_url=case.source_url, magnitude=case.magnitude,
            max_intensity=case.max_intensity,
            milestones=tuple(m.public() for m in milestones),
            current_milestone=(milestones[step - 1].public() if 0 < step <= len(milestones) else None),
        )

    @staticmethod
    def _assert_not_live(snapshot: LiveSnapshot) -> None:
        if snapshot.spatial_guidance.movement_authorized or snapshot.routes or snapshot.destinations:
            raise RuntimeError("Mock Live cannot authorize real movement or places")

    async def start(self, request: MockLiveRequest) -> MockLiveResponse:
        with self._lock:
            self._purge()
            if len(self._sessions) >= self._max:
                from .storage import SessionCapacityReached
                raise SessionCapacityReached("mock live exercise capacity reached")
        instrumented = self._planner
        store = MockLiveStore(request, instrumented)
        # Replay sample contains area IDs that are intentionally absent in the
        # canonical Live registry. Use only registered synthetic Tokyo scope.
        base = load_scenario().profile_seed
        historical = CASES.get(request.historical_case) if request.historical_case else None
        area = f"JP-{historical.area_code}" if historical else "JP-13"
        mock_location = base.current_location.model_copy(update={
            "label": f"{historical.area_ja} exercise area (MOCK)" if historical else "Tokyo exercise area (MOCK)",
            "lat": None, "lng": None,
            "area_ids": (area, "JP"), "observed_at": None, "source": None,
        })
        if request.use_gemini:
            mock_location=mock_location.model_copy(update={'label':'所在地未設定 (MOCK)','area_ids':()})
        if request.location_context and (request.location_context.source!='GPS'
                or datetime.now(timezone.utc)-request.location_context.observed_at<timedelta(seconds=120)):
            location=request.location_context
            label=next(a.label for a in load_japan_area_registry() if a.id==location.area_ids[0])
            mock_location=mock_location.model_copy(update={'label':label,'area_ids':location.area_ids,
                'source':LocationSource(location.source),'observed_at':location.observed_at})
        seed = base.model_copy(update={
            "current_location": mock_location,
            "accommodation_location": (base.accommodation_location.model_copy(update={'label':'未設定 (MOCK)',
                'lat':None,'lng':None,'area_ids':(),'observed_at':None,'source':None}) if request.use_gemini else mock_location),
            "current_destination": None,
            "self_reported_safety_status": (SelfReportedSafetyStatus.NEEDS_ASSISTANCE if request.mobility == "CANNOT_MOVE" else SelfReportedSafetyStatus.UNCERTAIN),
            "accessibility_constraints": ("MOBILITY_SUPPORT",) if request.mobility == "CANNOT_MOVE" else (),
            "current_plan_summary": "SIMULATION ONLY",
        })
        snap = await store.start_async(StartLiveRequest(language=request.language, profile=seed))
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
            max_steps = (len(session.store.mock_source.milestones)
                         if session.request.historical_case else 3 if session.request.network == "RECONNECTING" else 2)
            if stage >= max_steps:
                from .storage import InvalidReplayTransition
                raise InvalidReplayTransition("mock live exercise completed")
            session.store.mock_source.stage = stage + 1
            try:
                snap = await session.store.refresh_async(id)
            except Exception:
                session.store.mock_source.stage = stage
                raise
            if session.request.use_gemini:
                kind=(session.store.mock_source.milestones[stage].kind if session.request.historical_case else 'EARTHQUAKE')
                envelope=build_advice_envelope(session.request.location_context,session.request.conditions,
                    event_kind=kind,mobility=session.request.mobility,network=session.request.network,evidence=session.request.evidence,
                    step=stage+1,session_id=str(id),plan_id=str(snap.situation.current_plan_id) if snap.situation.current_plan_id else None,
                    tsunami_active=any(m.kind in ('TSUNAMI_WARNING','TSUNAMI_UPGRADE') for m in session.store.mock_source.milestones[:stage+1]),
                    now=datetime.now(timezone.utc))
                session.assessments.append(await self._advisor.assess(envelope))
            return self._response(session, snap)
