"""FastAPI endpoints for replay and bounded optional ADK planning."""

from __future__ import annotations

from uuid import UUID
import os
import secrets

from fastapi import Body, Depends, FastAPI, HTTPException, Header, status
from seventytwoh_contracts.models import (
    ApiVersion,
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
)
from .planner import CandidatePlanner
from .drill import DrillRequest
from .drill_store import DrillStore
from .mock_live import MockLiveDrillStore, MockLiveResponse, MockLiveRequest
from .historical_cases import list_historical_cases


def create_app(store: ReplayStore | None = None, live_store: LiveStore | None = None, drill_store: DrillStore | None = None, mock_live_store: MockLiveDrillStore | None = None) -> FastAPI:
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
    def get_mock_live(session_id: UUID, _: None = Depends(authenticate_drill)) -> MockLiveResponse:
        return _run_live(lambda: isolated_mock_live.get(session_id))

    @application.post("/api/mock-live/{session_id}/next", response_model=MockLiveResponse)
    async def next_mock_live(session_id: UUID, _: None = Depends(authenticate_drill)) -> MockLiveResponse:
        try:
            return await isolated_mock_live.next(session_id)
        except LiveSessionNotFound as exc:
            raise HTTPException(status_code=404, detail="mock live session not found") from exc
        except InvalidReplayTransition as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

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
