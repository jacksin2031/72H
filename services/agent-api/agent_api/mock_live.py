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
    DistressRequest, LiveSnapshot, LiveSourceStatus, NetworkState, SelfReportedSafetyStatus, StartLiveRequest,
    TsunamiAreaStatus, TsunamiMaxHeight, TsunamiOperation, TsunamiWarningClass, LocationSource,
)
from .drill import DrillRequest
from .historical_cases import CASES, TSUNAMI_KINDS, HistoricalId, HistoricCase, list_historical_cases
from .live import LiveSessionNotFound, LiveStore
from .live_sources import (
    JMA_PREFECTURES, JMA_TSUNAMI_SOURCE_KEY, JmaEarthquakeReport, JmaPrefObservation, JmaFetchResult,
    JmaTsunamiArea, JmaTsunamiBulletin, JmaTsunamiFetchResult, _aggregate_tsunami_forecast_areas, jma_report_deadline,
)
from .planner import CandidatePlanner
from .scenario import load_scenario
from .simulation_advice import SimulationLocation,SimulationConditions,SimulationAdvisor,SimulationAssessment,build_advice_envelope
from .area_registry import load_japan_area_registry

MOCK_MODE = "MOCK_LIVE"
MOCK_JMA_NAME = "SIMULATED JMA provider (NOT official)"
MOCK_JMA_TSUNAMI_NAME = "SIMULATED JMA tsunami provider (NOT official)"
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
    # Assessments replaced because the Safety Core plan changed after they were made (oldest first).
    movement_assessment_superseded: tuple[SimulationAssessment,...] = ()


MAX_SUPERSEDED_ASSESSMENTS = 24
PLAN_CHANGED = "PLAN_CHANGED"


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
                detail = ("MOCK historical tsunami event: no new earthquake report; the synthetic tsunami source carries it."
                          if milestone.kind in TSUNAMI_KINDS else
                          f"MOCK historical background event {milestone.kind}: not a Safety Core input.")
                return JmaFetchResult(LiveSourceStatus.FRESH, now, now, None, (), detail)
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
    """Synthetic tsunami bulletins for historical exercises; never the real JMA adapter or network.

    It reads the replay stage from the shared MockJmaSource. Once a TSUNAMI_WARNING /
    TSUNAMI_UPGRADE milestone has been reached it returns the latest synthetic bulletin
    for that event (ISSUE, then UPDATE), as the live VTSE41 adapter keeps one bulletin
    per information unit. Publication time is fixed on the runtime clock when the
    milestone is first reached and never refreshed, so the normal JMA evidence deadline
    makes it STALE and the Live reducers stop treating it as current.
    """

    def __init__(self, jma: "MockJmaSource | None" = None, *, now=None) -> None:
        self.jma = jma
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._published: dict[int, datetime] = {}

    @staticmethod
    def _empty(now: datetime, detail: str, status=LiveSourceStatus.UNSUPPORTED) -> JmaTsunamiFetchResult:
        return JmaTsunamiFetchResult(
            status=status, retrieved_at=now, last_published_at=None, next_retry_at=None,
            operation=TsunamiOperation.UNKNOWN, serial=None, bulletins=(), forecast_areas=(),
            conflict=False, detail=detail,
        )

    def fetch_latest(self) -> JmaTsunamiFetchResult:
        now = self._now()
        jma = self.jma
        historic = jma.historic if jma is not None else None
        reached = tuple(
            (index + 1, milestone) for index, milestone in enumerate(jma.milestones[:jma.stage])
            if milestone.kind in TSUNAMI_KINDS
        ) if historic else ()
        if not reached:
            return self._empty(now, "MOCK LIVE: no synthetic tsunami bulletin at this exercise stage.")
        if jma.request.network == "OFFLINE" or jma.request.evidence == "UNKNOWN":
            return self._empty(now, "MOCK historical timeline: simulated outage; no fresh tsunami feed.",
                               LiveSourceStatus.UNAVAILABLE)
        for item_stage, _ in reached:
            self._published.setdefault(item_stage, now - timedelta(hours=2) if jma.request.evidence == "STALE" else now)
        stage, milestone = reached[-1]
        published = self._published[stage]
        bulletin = JmaTsunamiBulletin(
            event_id=f"historical-{historic.id}-tsunami",
            serial=str(len(reached)),
            info_type="発表",
            operation=TsunamiOperation.UPDATE if len(reached) > 1 else TsunamiOperation.ISSUE,
            published_at=published,
            occurred_at=self._published[reached[0][0]],
            # Case-absolute milestone index, so a time window never changes the provenance path.
            reference_url=f"mock://72h/historical/{historic.id}/{historic.milestones.index(milestone) + 1}/tsunami",
            forecast_areas=tuple(
                JmaTsunamiArea(
                    # Synthetic 9xx code (9 + prefecture code): never presented as a real JMA forecast-area code.
                    code="9" + next(code for code, pref in JMA_PREFECTURES.items() if pref == name),
                    name=name,
                    status=TsunamiAreaStatus.ACTIVE,
                    warning_class=TsunamiWarningClass(warning_class),
                    max_height=TsunamiMaxHeight(),
                    arrival_at=None,
                )
                for name, warning_class in milestone.tsunami_areas
            ),
        )
        areas, conflict = _aggregate_tsunami_forecast_areas((bulletin,), now)
        return JmaTsunamiFetchResult(
            status=LiveSourceStatus.FRESH if now < jma_report_deadline(bulletin) else LiveSourceStatus.STALE,
            retrieved_at=now,
            last_published_at=published,
            next_retry_at=None,
            operation=bulletin.operation,
            serial=bulletin.serial,
            bulletins=(bulletin,),
            forecast_areas=areas,
            conflict=conflict,
            detail=(f"HISTORICAL EXERCISE tsunami bulletin for {historic.id} (archived {milestone.at_jst}); "
                    "synthetic, replayed on the runtime clock; not live JMA."),
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
            tsunami_source=MockTsunamiSource(self.mock_source),
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

    def _tsunami_event_evidence_pair(self, state, bulletin, now, legacy_metadata=None):
        pair = super()._tsunami_event_evidence_pair(state, bulletin, now, legacy_metadata)
        if pair is None:
            return None
        event, evidence = pair
        case = self.mock_source.historic.id if self.mock_source.historic else "custom"
        event = event.model_copy(update={
            "source_name": MOCK_JMA_TSUNAMI_NAME,
            "severity_raw": "HISTORICAL EXERCISE " + event.severity_raw.removeprefix("JMA VTSE41 ")[:40],
            "raw_reference": bulletin.reference_url,
            "is_synthetic": True,
        })
        evidence = evidence.model_copy(update={
            "source_name": MOCK_JMA_TSUNAMI_NAME,
            "summary": (f"SYNTHETIC HISTORICAL EXERCISE: {case} tsunami warning replayed on an artificial runtime clock; "
                        "not live JMA. Prefecture-level area only; it does not authorize movement or identify safe places."),
            "raw_reference": bulletin.reference_url,
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
        def simulated_source(item):
            tsunami = item.source_key == JMA_TSUNAMI_SOURCE_KEY
            return item.model_copy(update={
                "source_name": MOCK_JMA_TSUNAMI_NAME if tsunami else MOCK_JMA_NAME,
                "source_url": "mock://72h/jma-tsunami" if tsunami else "mock://72h/jma",
                "detail": "SIMULATION ONLY. " + item.detail[:210],
            })
        simulated = snapshot.model_copy(update={
            "source": simulated_source(snapshot.source),
            "official_sources": tuple(simulated_source(item) for item in snapshot.official_sources),
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
            or any(not item.source_url.startswith("mock://") for item in (simulated.source, *simulated.official_sources))
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
    store_session_id: UUID | None = None
    assessments: list[SimulationAssessment] = field(default_factory=list)
    superseded: list[SimulationAssessment] = field(default_factory=list)
    assessment_lock: RLock = field(default_factory=RLock)


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

    @staticmethod
    def _advice_envelope(session: _MockSession, step: int, plan_id: str | None, now: datetime) -> dict:
        milestones = session.store.mock_source.milestones
        return build_advice_envelope(
            session.request.location_context, session.request.conditions,
            event_kind=milestones[step - 1].kind if session.request.historical_case else "EARTHQUAKE",
            mobility=session.request.mobility, network=session.request.network, evidence=session.request.evidence,
            step=step, session_id=str(session.store_session_id), plan_id=plan_id,
            tsunami_active=any(m.kind in TSUNAMI_KINDS for m in milestones[:step]),
            now=now,
        )

    def _rebind_assessment(self, session: _MockSession, snapshot: LiveSnapshot) -> None:
        """Keep the current assessment bound to the current Safety Core plan.

        When the plan changes after an assessment was made (a distress report, an AI escalation,
        or plan expiry), the old assessment no longer describes the current plan. It is moved to the
        superseded log, never rewritten, and the step's current entry becomes a deterministic NOT_RUN
        assessment bound to the new plan: no model call and no model decision is claimed.
        """
        plan_id = str(snapshot.situation.current_plan_id) if snapshot.situation.current_plan_id else None
        with session.assessment_lock:
            # Only the current step's assessment may be rebound: while a `next` is between advancing the
            # stage and appending the new step's assessment, the previous step's entry must stay as it is.
            if (not session.assessments or session.assessments[-1].plan_id == plan_id
                    or session.assessments[-1].step != session.store.mock_source.stage):
                return
            old = session.assessments[-1]
            envelope = self._advice_envelope(session, old.step, plan_id, datetime.now(timezone.utc))
            rebound = SimulationAssessment(
                **{key: envelope[key] for key in ("version", "session_id", "step", "plan_id", "area_ids", "area_label",
                                                 "location_source", "location_observed_at", "created_at", "expires_at",
                                                 "allowed_decisions", "facts", "limitation_ids")},
                decision="UNKNOWN", fact_ids=tuple(f["id"] for f in envelope["facts"]),
                ai_mode="NOT_RUN", reason_code=PLAN_CHANGED,
            )
            session.superseded = [*session.superseded, old][-MAX_SUPERSEDED_ASSESSMENTS:]
            session.assessments[-1] = rebound

    def _response(self, session: _MockSession, snapshot: LiveSnapshot, *, rebind: bool = True) -> MockLiveResponse:
        self._assert_not_live(snapshot)
        if rebind:
            self._rebind_assessment(session, snapshot)
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
            movement_assessment_superseded=tuple(session.superseded),
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
            advisory_is_not_safety_core_input=not (0 < step <= len(milestones) and milestones[step - 1].public()["fed_to_safety_core"]),
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
        session = _MockSession(store, instrumented, request, monotonic() + MOCK_TTL, asyncio.Lock(),
                               store_session_id=snap.session_id)
        with self._lock:
            self._purge()
            if len(self._sessions) >= self._max:
                raise RuntimeError("mock live capacity race")
            self._sessions[snap.session_id] = session
        return self._response(session, snap)

    def get(self, id: UUID) -> MockLiveResponse:
        session = self._lookup(id)
        # GET is synchronous and cannot await session.lock. While a mutation holds it, that mutation's own
        # response performs the rebind; GET never rebinds concurrently with it.
        return self._response(session, session.store.get(id), rebind=not session.lock.locked())

    async def record_distress(self, id: UUID, request: DistressRequest) -> MockLiveResponse:
        session = self._lookup(id)
        async with session.lock:
            snap = await session.store.record_distress(id, request)
            return self._response(session, snap)

    async def record_ai_escalation(self, id: UUID) -> bool:
        session = self._lookup(id)
        async with session.lock:
            return await session.store.record_ai_escalation(id)

    async def record_advice_trace(self, id: UUID, applied) -> MockLiveResponse:
        session = self._lookup(id)
        async with session.lock:
            snap = await session.store.record_advice_trace(id, applied)
            return self._response(session, snap)

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
                plan_id = str(snap.situation.current_plan_id) if snap.situation.current_plan_id else None
                envelope = self._advice_envelope(session, stage + 1, plan_id, datetime.now(timezone.utc))
                assessment = await self._advisor.assess(envelope)
                with session.assessment_lock:
                    session.assessments.append(assessment)
            return self._response(session, snap)
