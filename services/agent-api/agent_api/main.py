"""FastAPI endpoints for replay and bounded optional ADK planning."""

from __future__ import annotations

from uuid import UUID

from fastapi import Body, FastAPI, HTTPException, status
from seventytwoh_contracts.models import (
    ApiVersion,
    ReplaySnapshot,
    SpeedRequest,
    StartReplayRequest,
)

from . import __version__
from .storage import (
    InvalidReplayTransition,
    ReplayStore,
    SessionCapacityReached,
    SessionNotFound,
)


def create_app(store: ReplayStore | None = None) -> FastAPI:
    replay_store = store or ReplayStore()
    application = FastAPI(
        title="72H Agent API",
        version=__version__,
        description="Phase 3 Safety Core, synthetic replay, and bounded optional Gemini/ADK intent selection. Replay data is not live official information.",
    )
    application.state.replay_store = replay_store

    @application.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @application.get("/version", response_model=ApiVersion)
    def version() -> ApiVersion:
        return ApiVersion(service="72h-agent-api", version=__version__, phase="phase-3")

    @application.post("/api/replay/start", response_model=ReplaySnapshot, status_code=status.HTTP_201_CREATED)
    def start_replay(
        request: StartReplayRequest | None = Body(default=None),
    ) -> ReplaySnapshot:
        try:
            return replay_store.start(request)
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

    return application


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
