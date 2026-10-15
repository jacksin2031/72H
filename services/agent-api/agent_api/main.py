"""FastAPI endpoints for replay and bounded optional ADK planning."""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from threading import RLock
from time import monotonic
from typing import Literal
from uuid import UUID
import logging
import os
import secrets

from pydantic import BaseModel, ConfigDict
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi import Body, Depends, FastAPI, HTTPException, Header, Request, status
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
from .mock_live import MAX_MOCK_SESSIONS, MOCK_TTL, MockLiveDrillStore, MockLiveResponse, MockLiveRequest
from .simulation_advice import SimulationLocation
from .road_tile_service import RoadTileService, TileRateLimited, TileUnavailable
from .road_tiles import TileTooDense
from .historical_cases import list_historical_cases
from .place_opening import PlaceOpeningStore, PlaceOpeningResponse
from .explanation import ExplanationRequest, ExplanationResponse, ExplanationService
from .distress_extract import DistressCallBudget, DistressExtractor, ExtractRequest, ExtractResponse
from .distress_advice import AdviceRequest, DistressAdvisor, escalation_skipped


logger = logging.getLogger(__name__)

# Per API process: four public starts per rolling minute; no client/IP keys are retained.
JUDGE_STARTS_PER_WINDOW = 4
JUDGE_START_WINDOW_SECONDS = 60
JUDGE_ISHINOMAKI_AREA_IDS = ("JP-MUNI-04202", "JP-04", "JP")


class JudgeStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    language: Literal["ja", "en", "zh-TW", "zh-CN"] = "ja"


def _log_road_tile_failure(tile_id: str, status_code: int, reason: str) -> None:
    """Tile id and reason code only: never coordinates, session keys or client addresses."""
    logger.warning("road tile %s failed: status=%d reason=%s", tile_id, status_code, reason)


def create_app(
    store: ReplayStore | None = None,
    live_store: LiveStore | None = None,
    drill_store: DrillStore | None = None,
    mock_live_store: MockLiveDrillStore | None = None,
    judge_store: MockLiveDrillStore | None = None,
    place_opening_store: PlaceOpeningStore | None = None,
    explanation_service: ExplanationService | None = None,
    distress_extractor: DistressExtractor | None = None,
    distress_advisor: DistressAdvisor | None = None,
    road_tiles: RoadTileService | None = None,
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
    # Keep public judge session capacity separate while sharing planner/advisor global budgets.
    isolated_judge = judge_store or isolated_mock_live.new_session_store(max_sessions=MAX_MOCK_SESSIONS)
    application = FastAPI(
        title="72H Agent API",
        version=__version__,
        description="Phase 3 Safety Core, synthetic replay, and bounded optional Gemini/ADK intent selection. Replay data is not live official information.",
    )
    application.state.replay_store = replay_store
    application.state.live_store = live_session_store
    application.state.drill_store = isolated_drills
    application.state.mock_live_store = isolated_mock_live
    application.state.judge_store = isolated_judge
    judge_lock = RLock()
    judge_start_times: deque[float] = deque()
    # Completed markers retain 409 behavior without occupying store slots. Abandoned
    # incomplete sessions retain a slot until the existing 30-minute idle TTL; at most eight.
    judge_sessions: dict[UUID, tuple[float, bool]] = {}
    judge_starting = 0

    def _prune_judge_state(now: float) -> None:
        cutoff = now - JUDGE_START_WINDOW_SECONDS
        while judge_start_times and judge_start_times[0] <= cutoff:
            judge_start_times.popleft()
        expired = [session_id for session_id, (expires, _) in judge_sessions.items() if expires <= now]
        for session_id in expired:
            judge_sessions.pop(session_id, None)

    def _reserve_judge_start() -> None:
        now = monotonic()
        with judge_lock:
            _prune_judge_state(now)
            if len(judge_start_times) >= JUDGE_STARTS_PER_WINDOW:
                retry_after = max(1, int(JUDGE_START_WINDOW_SECONDS - (now - judge_start_times[0]) + 0.999))
                raise HTTPException(
                    status_code=429,
                    detail="Judge start rate limit exceeded",
                    headers={"Retry-After": str(retry_after)},
                )
            judge_start_times.append(now)

    def _reserve_judge_session_slot() -> None:
        nonlocal judge_starting
        now = monotonic()
        with judge_lock:
            _prune_judge_state(now)
            active = sum(not completed for _, completed in judge_sessions.values())
            if active + judge_starting >= MAX_MOCK_SESSIONS:
                raise HTTPException(status_code=503, detail="judge exercise capacity reached")
            judge_starting += 1

    def _release_judge_start_reservation() -> None:
        nonlocal judge_starting
        with judge_lock:
            judge_starting = max(0, judge_starting - 1)

    def _remember_judge_session(session_id: UUID) -> None:
        now = monotonic()
        with judge_lock:
            _prune_judge_state(now)
            if len(judge_sessions) >= MAX_MOCK_SESSIONS and session_id not in judge_sessions:
                # Prefer evicting completed markers so active sessions keep their full TTL.
                completed_id = next(
                    (key for key, (_, completed) in judge_sessions.items() if completed),
                    None,
                )
                if completed_id is None:
                    raise RuntimeError("judge session marker capacity invariant failed")
                judge_sessions.pop(completed_id)
            judge_sessions[session_id] = (now + MOCK_TTL, False)

    def _require_judge_session(session_id: UUID) -> bool:
        with judge_lock:
            now = monotonic()
            _prune_judge_state(now)
            marker = judge_sessions.get(session_id)
            if marker is None:
                raise HTTPException(status_code=404, detail="judge session not found")
            if marker[1]:
                return True
            # Refresh before awaiting store.next so a slow in-flight advance cannot
            # lose its authorization marker while the underlying store stays alive.
            judge_sessions[session_id] = (now + MOCK_TTL, False)
            return False

    def _forget_judge_session(session_id: UUID) -> None:
        with judge_lock:
            judge_sessions.pop(session_id, None)

    def _mark_judge_completed(session_id: UUID) -> None:
        with judge_lock:
            marker = judge_sessions.get(session_id)
            if marker is not None:
                judge_sessions[session_id] = (marker[0], True)

    def _refresh_judge_session(session_id: UUID) -> None:
        with judge_lock:
            marker = judge_sessions.get(session_id)
            if marker is not None and not marker[1]:
                judge_sessions[session_id] = (monotonic() + MOCK_TTL, False)
    road_tile_service = road_tiles or RoadTileService()
    application.state.road_tiles = road_tile_service

    @application.get("/api/roads/tile/{tile_id}")
    async def road_tile(tile_id: str, request: Request, x_road_session: str | None = Header(default=None)):
        """Reference-only OSM road tile. Never a route-safety or passability verdict."""
        if request.url.query:
            return JSONResponse(status_code=400, content={"detail": "ROAD_TILE_QUERY_NOT_ALLOWED"})
        session_key = (x_road_session or "").strip()[:64] or "anonymous"
        try:
            graph = await road_tile_service.get(tile_id, session_key)
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "ROAD_TILE_ID_INVALID"})
        except TileTooDense:
            _log_road_tile_failure(tile_id, 413, "TOO_DENSE")
            return JSONResponse(status_code=413, content={"detail": "ROAD_TILE_TOO_DENSE"})
        except TileRateLimited as exc:
            _log_road_tile_failure(tile_id, 429, exc.reason)
            return JSONResponse(status_code=429, content={"detail": "ROAD_TILE_RATE_LIMITED"})
        except TileUnavailable as exc:
            _log_road_tile_failure(tile_id, 503, exc.reason)
            return JSONResponse(status_code=503, content={"detail": "ROAD_DATA_TEMPORARILY_UNAVAILABLE"})
        return JSONResponse(content=graph, headers={"Cache-Control": "public, max-age=86400"})

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
        if path != "/api/distress/extract" and not path.endswith("/distress/advice") and not path.startswith("/api/judge/"):
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

    @application.post("/api/judge/start", response_model=MockLiveResponse, status_code=status.HTTP_201_CREATED)
    async def start_judge(request: Request, body: JudgeStartRequest | None = Body(default=None)) -> MockLiveResponse:
        if request.url.query:
            raise HTTPException(status_code=422, detail="Judge start accepts only a language field")
        _reserve_judge_start()
        observed_at = datetime.now(timezone.utc)
        exercise = MockLiveRequest(
            kind="EARTHQUAKE",
            severity=4,
            battery=80,
            network="ONLINE",
            evidence="FRESH",
            mobility="ABLE",
            language=body.language if body is not None else "ja",
            use_gemini=True,
            historical_case="tohoku-2011",
            location_context=SimulationLocation(
                area_ids=JUDGE_ISHINOMAKI_AREA_IDS,
                source="USER_SELECTED",
                observed_at=observed_at,
            ),
        )
        _reserve_judge_session_slot()
        try:
            result = await isolated_judge.start(exercise)
            _remember_judge_session(result.snapshot.session_id)
        except SessionCapacityReached as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        finally:
            _release_judge_start_reservation()
        return result

    @application.post("/api/judge/{session_id}/next", response_model=MockLiveResponse)
    async def next_judge(session_id: UUID, request: Request) -> MockLiveResponse:
        if request.url.query or await request.body():
            raise HTTPException(status_code=422, detail="Judge next does not accept request data")
        if _require_judge_session(session_id):
            raise HTTPException(status_code=409, detail="mock live exercise completed")
        try:
            result = await isolated_judge.next(session_id)
        except LiveSessionNotFound as exc:
            _forget_judge_session(session_id)
            raise HTTPException(status_code=404, detail="judge session not found") from exc
        except InvalidReplayTransition as exc:
            _mark_judge_completed(session_id)
            isolated_judge.release_session(session_id)
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if result.current_step >= result.total_steps:
            _mark_judge_completed(session_id)
            isolated_judge.release_session(session_id)
        else:
            _refresh_judge_session(session_id)
        return result

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
