# P1.6 — Isolated Mock Live Source Adapter

Date: 2026-10-10 JST
Status: local implementation and validation; Production HOLD.

## Why this exists

P1.5 executes synthetic Replay scenarios through the real deterministic Safety Core and Gemini candidate selector. P1.6 replaces the **Live source adapter inputs**, then exercises the **same LiveStore.refresh_async** and its normalized events, Live Safety Core planning, and Gemini/ADK selector. Real HTTP JMA, Tokyo shelter, and Ekispert route adapter calls must never occur in this exercise.

## Architecture and scope

- Backend `MockLiveDrillStore` owns isolated per-exercise `MockLiveStore` objects that inherit the actual `LiveStore`.
- Injected `MockJmaSource` produces typed `JmaFetchResult` / `JmaEarthquakeReport` values without network I/O.
- Injected `MockDestinationSource` returns an empty unavailable catalog; `MockRouteSource` refuses real route retrieval.
- All mock events and evidence remain `is_synthetic=True`; official Live still rejects synthetic data.
- An internal-only synthetic mode passes through the same `apply_live_evidence_batch_with_planner` and deterministic evaluator with strict synthetic + high-risk-ineligible checks; the default for any ordinary Live session remains **false**.
- Mock-only trace types explicitly say `MOCK_LIVE_EVENT_RECEIVED` and `MOCK_LIVE_EVIDENCE_ADDED`, not real official Live events.
- The response wraps `LiveSnapshot` in a distinct `mode=MOCK_LIVE` envelope, with test step, AI mode and synthetic battery, so never render the nested `mode=LIVE` snapshot as ordinary Live UI.
- All sources have MOCK names and `mock://` references in Mock Live responses.
- Strict API: `POST /api/mock-live/start`, `GET /api/mock-live/{id}`, `POST /api/mock-live/{id}/next`, protected by existing `DRILL_ACCESS_KEY` header.
- Server owner only, same origin and path/method allowlist at Next proxy. No access key in bundle or browser persistence.
- At most 8 in-memory sessions, TTL 30 minutes; no LiveStore/ReplayStore cross-session sharing.
- Backend directly uses `CandidatePlanner` for Gemini/ADK with the original bounded budget and safe fallback.
- UI reuses existing settings > test & diagnostics page/key and positions Mock Live first; P1.5 Replay is tucked under a disclosure.

## Supported case types

Currently only EARTHQUAKE is typed for the Live safety engine. Mock server can simulate FRESH, STALE and UNKNOWN feed; step 2 may simulate source failure or a new report; reconnecting includes a third simulated recovery step. L0–L4 severity stays explicitly *synthetic* and **is not a real JMA intensity conversion**. Battery 0–100% enters the bounded AI candidate context; the UI power policy remains deterministic and not a physical battery mutation. Mobility support flags are synthetic. Destination and route results are intentionally unavailable, not fabricated as safe.

## Core security properties

- No changes to external provider URLs, service account APIs or production LiveStore construction.
- Ordinary Live default refuses injected Synthetic evidence. Only specifically constructed MockLiveStore carries the internal opt-in flag.
- Neither fake events nor fake evidence can be turned into real high-risk movement authorization; `movement_authorized` must stay false.
- No real emergency calls, user notifications, GPS or network toggles.
- An exercise does not test iPhone VoiceOver/TalkBack or emergency readiness.

## Local validation

- Five new Mock Live backend tests: authentication, input schema, session isolation, normal Live pipeline evidence, offline/reconnect/unknown, no actual network provider calls.
- Existing backend regression suite remains green, existing frontend regression suite remains green.
- Direct live Gemini/ADK integration with synthetic L4 / 10% battery / cannot move, real Vertex AI `gemini-3.5-flash-lite`: first simulated event produced `GEMINI_ADK` and Plan v1; next source event was safely processed. All evidence synthetic; movement authorization false.

## Remaining release work

Build/test and deploy a fixed commit to a new 0%-traffic Cloud Run revision, verify Cloud Preview API and real Android Chrome UI before declaring Preview PASS. Retain P1.2 at 100% production, no push or merge.
