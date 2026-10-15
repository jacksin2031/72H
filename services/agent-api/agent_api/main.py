"""FastAPI endpoints for replay and bounded optional ADK planning."""

from __future__ import annotations

from uuid import UUID
import os
import secrets

from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi import Body, Depends, FastAPI, HTTPException, Header, status
from seventytwoh_contracts.models import (
    ApiVersion,
    DistressRequest,
    DistressTag,
    LiveLocationUpdateRequest,
    LiveProfileUpdateRequest,
    LiveSnapshot,
    ReplayScenarioOption,
    ReplaySnapshot,
    SpeedRequest,
    StartReplayRequest,
    StartLiveRequest,
    LiveRouteSearchRequest,
    TsunamiReferenceResponse,
    DisasterMapReferenceResponse,
)

from . import __version__
from .storage import (
    InvalidReplayProfile,
    InvalidReplayScenario,
    InvalidReplayTransition,
    ReplayStore,
    SessionCapacityReached,
    SessionNotFound,
)
from .live import (
    InvalidLiveLocationRequest,
    InvalidLiveProfileUpdate,
    InvalidLiveRouteRequest,
    InvalidLiveProfile,
    LiveSessionCapacityReached,
    LiveSessionNotFound,
    LiveStore,
    MAX_LIVE_TRACE_EVENTS,
)
from .domain import MAX_TRACE
from .planner import CandidatePlanner
from .drill import DrillRequest
from .drill_store import DrillStore
from .mock_live import MockLiveDrillStore, MockLiveResponse, MockLiveRequest
from .historical_cases import list_historical_cases
from .place_opening import PlaceOpeningStore, PlaceOpeningResponse
from .explanation import ExplanationRequest, ExplanationResponse, ExplanationService
from .distress_extract import DistressCallBudget, DistressExtractor, ExtractRequest, ExtractResponse
from .distress_advice import AdviceRequest, DistressAdvisor, escalation_skipped


def create_app(
    store: ReplayStore | None = None,
    live_store: LiveStore | None = None,
    drill_store: DrillStore | None = None,
    mock_live_store: MockLiveDrillStore | None = None,
    place_opening_store: PlaceOpeningStore | None = None,
    explanation_service: ExplanationService | None = None,
    distress_extractor: DistressExtractor | None = None,
    distress_advisor: DistressAdvisor | None = None,
) -> FastAPI:
    if store is None and live_store is None:
        # Preserve one process-wide Gemini/ADK call budget across replay and live.
        planner = CandidatePlanner()
        replay_store = ReplayStore(planner=planner)
        live_session_store = LiveStore(planner=planner)
    else:
        # Tests and callers that inject a store retain ownership of its planner/config.
        replay_store = store if store is not None else ReplayStore()
        live_session_store = live_store if live_store is not None else LiveStore()
    isolated_drills = drill_store or DrillStore(planner=planner if store is None and live_store is None else None)
    isolated_mock_live = mock_live_store or MockLiveDrillStore(planner=planner if store is None and live_store is None else None)
    application = FastAPI(
        title="72H Agent API",
        version=__version__,
        description="Phase 3 Safety Core, synthetic replay, and bounded optional Gemini/ADK intent selection. Replay data is not live official information.",
    )
    application.state.replay_store = replay_store
    application.state.live_store = live_session_store
    application.state.drill_store = isolated_drills
    application.state.mock_live_store = isolated_mock_live
    explanation_engine = explanation_service or ExplanationService()
    application.state.explanation_service = explanation_engine
    opening_store = place_opening_store or PlaceOpeningStore()
    # One Gemini budget for the whole distress feature (extract + advice): 6/session, 12/min.
    distress_budget = (
        distress_extractor._budget if distress_extractor is not None
        else distress_advisor._budget if distress_advisor is not None
        else DistressCallBudget()
    )
    extractor = distress_extractor or DistressExtractor(budget=distress_budget)
    advisor = distress_advisor or DistressAdvisor(budget=distress_budget)
    application.state.distress_extractor = extractor
    application.state.distress_advisor = advisor

    def _confirmed_tags(snapshot) -> tuple[str, ...]:
        return tuple(dict.fromkeys(t.value for r in snapshot.distress.reports for t in r.tags))

    def _user_signal(snapshot, request: AdviceRequest) -> bool:
        """Only the person's own active report or blocked-route hint lets AI raise the level."""
        return bool(snapshot.distress.reports) or bool((request.route_blocked_hint or "").strip())

    def _exclusion_signal(snapshot, request: AdviceRequest) -> bool:
        """Spec 13.3: AI may exclude places only on the person's own active blocked-route report or hint."""
        reported = any(t == DistressTag.ROUTE_BLOCKED_REPORTED for r in snapshot.distress.reports for t in r.tags)
        return reported or bool((request.route_blocked_hint or "").strip())

    async def _advise(session_id: UUID, snapshot, request: AdviceRequest, max_trace: int):
        # F6: check trace capacity before the model so a session that cannot record the
        # outcome never spends the shared Gemini budget (same headroom as the stores).
        return await advisor.advise(str(session_id), request, level=snapshot.distress.level,
                                    tags=_confirmed_tags(snapshot), user_signal=_user_signal(snapshot, request),
                                    exclusion_signal=_exclusion_signal(snapshot, request),
                                    trace_capacity=len(snapshot.trace) < max_trace - 8)

    @application.exception_handler(RequestValidationError)
    async def validation_handler(request, exc: RequestValidationError):
        path = request.url.path
        if path != "/api/distress/extract" and not path.endswith("/distress/advice"):
            return await request_validation_exception_handler(request, exc)
        # Never echo `input` or `ctx`: they can contain the user's words or audio.
        detail = [{"loc": list(e.get("loc", ())), "msg": str(e.get("msg", "invalid")), "type": str(e.get("type", "invalid"))} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": detail})

    def _extract_session_exists(session_id: str, drill_key: str | None) -> bool:
        """Extraction spends the shared Gemini budget, so it needs a real replay or live session;
        mock-live sessions additionally need the drill key."""
        try:
            sid = UUID(session_id)
        except ValueError:
            return False
        for lookup in (replay_store.get, live_session_store.get):
            try:
                lookup(sid)
                return True
            except (SessionNotFound, LiveSessionNotFound):
                pass
        secret = os.environ.get("DRILL_ACCESS_KEY", "")
        if len(secret) < 32 or not drill_key or len(drill_key) > 256 or not secrets.compare_digest(secret, drill_key):
            return False
        return isolated_mock_live.has_session(sid)

    @application.post("/api/distress/extract", response_model=ExtractResponse)
    async def distress_extract(request: ExtractRequest, x_drill_key: str | None = Header(default=None)) -> ExtractResponse:
        if not _extract_session_exists(request.session_id, x_drill_key):
            raise HTTPException(status_code=404, detail="session not found")
        return await extractor.extract(request)

    @application.get('/api/reference/place-opening/{partition}', response_model=PlaceOpeningResponse)
    def place_opening(partition: str) -> PlaceOpeningResponse:
        try:
            return opening_store.get(partition)
        except KeyError as exc:
            raise HTTPException(status_code=404,detail='Opening partition unsupported') from exc

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/version", response_model=ApiVersion)
    def version() -> ApiVersion:
        return ApiVersion(service="72h-agent-api", version=__version__, phase="phase-3")

    @application.get("/api/replay/scenarios", response_model=tuple[ReplayScenarioOption, ...])
    def replay_scenarios() -> tuple[ReplayScenarioOption, ...]:
        return replay_store.available_scenarios()

    @application.post("/api/replay/start", response_model=ReplaySnapshot, status_code=status.HTTP_201_CREATED)
    def start_replay(
        request: StartReplayRequest | None = Body(default=None),
    ) -> ReplaySnapshot:
        try:
            return replay_store.start(request)
        except InvalidReplayScenario as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except InvalidReplayProfile as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except SessionCapacityReached as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @application.get("/api/replay/{session_id}", response_model=ReplaySnapshot)
    def get_replay(session_id: UUID) -> ReplaySnapshot:
        return _run(lambda: replay_store.get(session_id))

    @application.post("/api/replay/{session_id}/explanation", response_model=ExplanationResponse)
    async def explain_replay(session_id: UUID, request: ExplanationRequest) -> ExplanationResponse:
        try:
            snapshot = replay_store.get(session_id)
            return await explanation_engine.explain(
                snapshot,
                request.language,
                source_mode="SYNTHETIC_REPLAY",
                latest_snapshot=lambda: replay_store.get(session_id),
            )
        except SessionNotFound as exc:
            raise HTTPException(status_code=404, detail="replay session not found") from exc

    @application.post("/api/replay/{session_id}/pause", response_model=ReplaySnapshot)
    def pause_replay(session_id: UUID) -> ReplaySnapshot:
        return _run(lambda: replay_store.pause(session_id))

    @application.post("/api/replay/{session_id}/resume", response_model=ReplaySnapshot)
    def resume_replay(session_id: UUID) -> ReplaySnapshot:
        return _run(lambda: replay_store.resume(session_id))

    @application.post("/api/replay/{session_id}/next", response_model=ReplaySnapshot)
    async def next_replay_event(session_id: UUID) -> ReplaySnapshot:
        return await _run_async(lambda: replay_store.next_async(session_id))

    @application.post("/api/replay/{session_id}/reset", response_model=ReplaySnapshot)
    def reset_replay(session_id: UUID) -> ReplaySnapshot:
        return _run(lambda: replay_store.reset(session_id))

    @application.post("/api/replay/{session_id}/speed", response_model=ReplaySnapshot)
    def set_replay_speed(session_id: UUID, request: SpeedRequest) -> ReplaySnapshot:
        return _run(lambda: replay_store.set_speed(session_id, request.speed))

    @application.post("/api/live/start", response_model=LiveSnapshot, status_code=status.HTTP_201_CREATED)
    async def start_live(request: StartLiveRequest) -> LiveSnapshot:
        try:
            return await live_session_store.start_async(request)
        except InvalidLiveProfile as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except LiveSessionCapacityReached as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @application.get("/api/live/{session_id}", response_model=LiveSnapshot)
    def get_live(session_id: UUID) -> LiveSnapshot:
        return _run_live(lambda: live_session_store.get(session_id))

    @application.post("/api/live/{session_id}/explanation", response_model=ExplanationResponse)
    async def explain_live(session_id: UUID, request: ExplanationRequest) -> ExplanationResponse:
        try:
            snapshot = live_session_store.get(session_id)
            return await explanation_engine.explain(
                snapshot,
                request.language,
                source_mode="LIVE",
                latest_snapshot=lambda: live_session_store.get(session_id),
            )
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="live session not found") from exc

    @application.get("/api/reference/tsunami", response_model=TsunamiReferenceResponse)
    def tsunami_reference() -> TsunamiReferenceResponse:
        # This endpoint is intentionally read-only with respect to live sessions;
        # only refresh/start run the Safety Core evidence and dependency pipeline.
        return live_session_store.get_tsunami_reference()

    @application.get("/api/reference/disaster-map", response_model=DisasterMapReferenceResponse)
    def get_disaster_map_reference() -> DisasterMapReferenceResponse:
        return live_session_store.get_disaster_map_reference()

    @application.post("/api/live/{session_id}/location", response_model=LiveSnapshot)
    async def update_live_location(
        session_id: UUID,
        request: LiveLocationUpdateRequest,
    ) -> LiveSnapshot:
        try:
            return await live_session_store.update_location(session_id, request)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="live session not found") from exc
        except InvalidLiveLocationRequest as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.post("/api/live/{session_id}/profile", response_model=LiveSnapshot)
    async def update_live_profile(
        session_id: UUID,
        request: LiveProfileUpdateRequest,
    ) -> LiveSnapshot:
        try:
            return await live_session_store.update_profile(session_id, request)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="live session not found") from exc
        except InvalidLiveProfileUpdate as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @application.post("/api/replay/{session_id}/distress", response_model=ReplaySnapshot)
    def replay_distress(session_id: UUID, request: DistressRequest) -> ReplaySnapshot:
        return _run(lambda: replay_store.record_distress(session_id, request))

    @application.post("/api/live/{session_id}/distress", response_model=LiveSnapshot)
    async def live_distress(session_id: UUID, request: DistressRequest) -> LiveSnapshot:
        try:
            return await live_session_store.record_distress(session_id, request)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="live session not found") from exc
        except InvalidLiveProfileUpdate as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @application.post("/api/replay/{session_id}/distress/advice")
    async def replay_distress_advice(session_id: UUID, request: AdviceRequest) -> dict:
        try:
            snapshot = replay_store.get(session_id)
            applied = await _advise(session_id, snapshot, request, MAX_TRACE)
            if applied.raised_level and not replay_store.record_ai_escalation(session_id):
                applied = escalation_skipped(applied)
            snapshot = replay_store.record_advice_trace(session_id, applied)
        except SessionNotFound as exc:
            raise HTTPException(status_code=404, detail="replay session not found") from exc
        except InvalidReplayTransition as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"advice": applied.model_dump(mode="json"), "snapshot": snapshot.model_dump(mode="json")}

    @application.post("/api/live/{session_id}/distress/advice")
    async def live_distress_advice(session_id: UUID, request: AdviceRequest) -> dict:
        try:
            snapshot = live_session_store.get(session_id)
            applied = await _advise(session_id, snapshot, request, MAX_LIVE_TRACE_EVENTS)
            if applied.raised_level and not await live_session_store.record_ai_escalation(session_id):
                applied = escalation_skipped(applied)
            snapshot = await live_session_store.record_advice_trace(session_id, applied)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="live session not found") from exc
        except InvalidLiveProfileUpdate as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"advice": applied.model_dump(mode="json"), "snapshot": snapshot.model_dump(mode="json")}

    @application.post("/api/live/{session_id}/refresh", response_model=LiveSnapshot)
    async def refresh_live(session_id: UUID) -> LiveSnapshot:
        return await _run_live_async(lambda: live_session_store.refresh_async(session_id))

    @application.post("/api/live/{session_id}/routes/search", response_model=LiveSnapshot)
    async def search_live_route(session_id: UUID, request: LiveRouteSearchRequest) -> LiveSnapshot:
        try:
            return await live_session_store.search_route(session_id, request)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="live session not found") from exc
        except InvalidLiveRouteRequest as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    def authenticate_drill(x_drill_key: str | None = Header(default=None)) -> None:
        secret = os.environ.get("DRILL_ACCESS_KEY", "")
        if len(secret) < 32:
            raise HTTPException(status_code=404, detail="Drill API disabled")
        if not x_drill_key or len(x_drill_key) > 256 or not secrets.compare_digest(secret, x_drill_key):
            raise HTTPException(status_code=403, detail="Drill access denied")

    @application.post("/api/drill/start", response_model=ReplaySnapshot, status_code=status.HTTP_201_CREATED)
    def start_drill(request: DrillRequest, _: None = Depends(authenticate_drill)) -> ReplaySnapshot:
        try:
            return isolated_drills.start(request)
        except SessionCapacityReached as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @application.get("/api/drill/{session_id}", response_model=ReplaySnapshot)
    def get_drill(session_id: UUID, _: None = Depends(authenticate_drill)) -> ReplaySnapshot:
        return _run(lambda: isolated_drills.get(session_id))

    @application.post("/api/drill/{session_id}/next", response_model=ReplaySnapshot)
    async def next_drill(session_id: UUID, _: None = Depends(authenticate_drill)) -> ReplaySnapshot:
        return await _run_async(lambda: isolated_drills.next(session_id))

    @application.get("/api/mock-live/cases")
    def list_mock_historical_cases() -> tuple[dict, ...]:
        return list_historical_cases()

    @application.post("/api/mock-live/start", response_model=MockLiveResponse, status_code=status.HTTP_201_CREATED)
    async def start_mock_live(request: MockLiveRequest, _: None = Depends(authenticate_drill)) -> MockLiveResponse:
        try:
            return await isolated_mock_live.start(request)
        except SessionCapacityReached as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    @application.get("/api/mock-live/{session_id}", response_model=MockLiveResponse)
    async def get_mock_live(session_id: UUID, _: None = Depends(authenticate_drill)) -> MockLiveResponse:
        return await _run_live_async(lambda: isolated_mock_live.get(session_id))

    @application.post("/api/mock-live/{session_id}/explanation", response_model=ExplanationResponse)
    async def explain_mock_live(
        session_id: UUID,
        request: ExplanationRequest,
        _: None = Depends(authenticate_drill),
    ) -> ExplanationResponse:
        try:
            result = await isolated_mock_live.get(session_id)

            async def latest_snapshot():
                return (await isolated_mock_live.get(session_id)).snapshot

            return await explanation_engine.explain(
                result.snapshot,
                request.language,
                source_mode="MOCK_LIVE",
                latest_snapshot=latest_snapshot,
            )
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="mock live session not found") from exc

    @application.post("/api/mock-live/{session_id}/next", response_model=MockLiveResponse)
    async def next_mock_live(session_id: UUID, _: None = Depends(authenticate_drill)) -> MockLiveResponse:
        try:
            return await isolated_mock_live.next(session_id)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="mock live session not found") from exc
        except InvalidReplayTransition as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @application.post("/api/mock-live/{session_id}/distress", response_model=MockLiveResponse)
    async def mock_live_distress(session_id: UUID, request: DistressRequest, _: None = Depends(authenticate_drill)) -> MockLiveResponse:
        try:
            return await isolated_mock_live.record_distress(session_id, request)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="mock live session not found") from exc
        except InvalidLiveProfileUpdate as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @application.post("/api/mock-live/{session_id}/distress/advice")
    async def mock_live_distress_advice(
        session_id: UUID, request: AdviceRequest, _: None = Depends(authenticate_drill),
    ) -> dict:
        try:
            snapshot = (await isolated_mock_live.get(session_id)).snapshot
            applied = await _advise(session_id, snapshot, request, MAX_LIVE_TRACE_EVENTS)
            if applied.raised_level and not await isolated_mock_live.record_ai_escalation(session_id):
                applied = escalation_skipped(applied)
            result = await isolated_mock_live.record_advice_trace(session_id, applied)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="mock live session not found") from exc
        except InvalidLiveProfileUpdate as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return {"advice": applied.model_dump(mode="json"), "snapshot": result.model_dump(mode="json")}

    return application


def _run_live(operation):
    try:
        return operation()
    except LiveSessionNotFound as exc:
        raise HTTPException(status_code=404, detail="live session not found") from exc


async def _run_live_async(operation):
    try:
        return await operation()
    except LiveSessionNotFound as exc:
        raise HTTPException(status_code=404, detail="live session not found") from exc


def _run(operation):
    try:
        return operation()
    except SessionNotFound as exc:
        raise HTTPException(status_code=404, detail="replay session not found") from exc
    except InvalidReplayTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


async def _run_async(operation):
    try:
        return await operation()
    except SessionNotFound as exc:
        raise HTTPException(status_code=404, detail="replay session not found") from exc
    except InvalidReplayTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


app = create_app()
