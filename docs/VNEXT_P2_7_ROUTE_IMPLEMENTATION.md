# P2.7 Explanation and Evacuation Route Implementation Plan

> **For agentic workers:** Use native execution with bounded delegated workers. Each owner validates its change before integration.

**Goal:** Add post-Core Gemini explanations and local road candidates to hazard-designated places without unsupported safety claims.
**Architecture:** Deterministic plans precede strictly bound explanatory output. Device-local route geometry remains a reference; safety and movement gates remain separate.
**Tech Stack:** FastAPI/Pydantic, Gemini/ADK, Next.js/React/Zod, existing MapLibre and official data packs.
**Spec:** `docs/VNEXT_P2_7_ROUTE_DESIGN.md`

## Constraints and Review Focus

No exact GPS transmission; no free-form AI action; no candidate geometry authorizes movement. Inspect late replies after plan/evidence expiry or revision, all three languages, missing data outside pilot, unsupported graph edges and destination-role mismatch.

## Tasks

- [ ] Backend owner: implement explanation envelope/runner/validator/API with bounded call budget and post-call snapshot binding; migrate domain LIVE/REPLAY off candidate selection; update compatibility and adversarial tests.
- [ ] Road graph owner: obtain bounded public road graph with pinned source/hash, implement local routing with strict geometry/resource limits and missing coverage; test connectivity, snapping, malformed input and alternatives.
- [ ] Main owner: integrate explanation UI for Live/Replay/Simulation, route trial for hazard-designated places on reference map and Plan entry; preserve privacy and stale/offline barriers.
- [ ] Main owner: run integration suites/build, actual Gemini and browser checks; independent safety review; document residual data blockers, commit local work without deployment.
