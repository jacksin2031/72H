# 72H — Current Development Phase

## Map places and roads (2026-10-11 JST)

User requested geographic places and roads. `codex/map-places-roads` adds
restrained GSI vector roads, railways, rivers, geographic names, stations and
facilities to the shared reference/simulation map, with scale-aware collision
placement, local overview labels and a responsive information card. GPS tile
protection defaults on across all shared-map views. Local tests, typecheck,
build and browser acceptance passed; see `docs/VNEXT_MAP_PLACES_ROADS.md`.
These geographic references do not grant passability, route safety or movement
permission. Detailed layers need network. No deployment is claimed.

## Time-driven seismic wavefronts (2026-10-11 JST)

The user requested earthquake propagation according to historical time instead
of repeating decorative circles. `codex/time-driven-seismic-waves` replaces the
CSS loop with geodesic P/S fronts driven by the shared simulation clock and
documented source time/depth, including the separate 311 Ibaraki aftershock.
This is an explicitly labelled constant-speed estimate, not measured waveforms,
intensity or safety assessment. Finite visual clock continuation does not create
new evidence, plans, API events or movement permission. Local tests, typecheck,
build and browser acceptance passed; evidence is in
`docs/VNEXT_TIME_DRIVEN_SEISMIC_WAVES.md`. No deployment is claimed.

## All-branch source consolidation (2026-10-11 JST)

User authorized integrating all branches. All 24 initial local branch tips and
the freshly fetched remote main are represented in `codex/integrate-all-branches`.
The obsolete adaptive policy is merged with later P1/P2.4 safety gates retained;
application code remains identical to `4afd50f`. Evidence and branch matrix:
`docs/BRANCH_INTEGRATION_2026_10_11.md`. Local tests/typecheck/build passed;
GitHub CI and main merge are separate source-integration gates. This does not
change release traffic or the P2.4 coverage/GPS/live-incident limitations below.

## Next major development phase — official tsunami and shelter data (2026-10-11 JST)

User selected official tsunami inundation assumptions and hazard-classified
evacuation-place data as the next major phase. Specification prepared:
`docs/VNEXT_P2_4_OFFICIAL_TSUNAMI_SHELTER_DATA.md`. User authorized implementation
with “do it”. Status: PARTIAL on `codex/p2-4-official-tsunami-shelters`;
the bounded Ishinomaki reference integration is implemented and locally validated.
Evidence: `docs/VNEXT_P2_4_VALIDATION.md`. Nationwide hazard coverage, real-device
GPS and live incident acceptance remain unvalidated; no new deployment was performed.
Current maps cannot determine
safe locations. Initial delivery adds sourced exposure screening and designation
reference only; it does not grant safe-destination or movement authorization.
Missing hazard coverage, current opening, authoritative movement and verified
route dependencies remain UNKNOWN and fail closed under the existing Safety Core.

## Current authorized work — All Japan map and UI Preview (2026-10-11 JST)

User authorized icon/layout polish, dark land/sea map, clear coastline,
earthquake event expansion, all-Japan reference coverage and Preview deployment
with acceptance. Branch `codex/ui-map-polish` integrates existing P2.2 baseline
`b80c808`. Nationwide Preview and P2.3 follow-up were verified on zero-traffic Cloud Run
revisions, including 320px/360px responsive browser acceptance. Evidence: `docs/VNEXT_JAPAN_UI_POLISH_PREVIEW.md`.
No production traffic promotion is authorized. Historical local-only gates below
remain historical and do not restrict this explicitly expanded Preview scope.

## Current authorized work — simplified More P1.2 (2026-10-09 JST)

Scope: local implementation and validation of
`docs/VNEXT_P1_2_SIMPLIFIED_MORE_UI.md` on isolated branch
`codex/vnext-p1-2-simplified-more`, baseline `7747b2b` (P1.1 preview ledger).
Workspace: `C:\Users\jacks\.codex\worktrees\a353\72H`.
Status: COMPLETE for the authorized local delivery. Evidence belongs in
`docs/VNEXT_P1_2_VALIDATION.md`: 234 frontend tests, 133 backend tests,
typecheck/build/secret scan, independent review and local browser acceptance.
No cloud deployment, traffic promotion or real-device acceptance is authorized
by this delivery. Historical P1.1/production results below are not P1.2 evidence.

## Current authorized work — accessible GPS P1.1 (2026-10-08 JST)

Scope: local implementation and acceptance of
`docs/VNEXT_P1_1_ACCESSIBLE_GPS_UI.md`, baseline
`6eeba78b180d52ce1bb845728442251b9d38a50b`, isolated branch
`codex/vnext-p1-1-accessible-gps`. The original checkout and its untracked spec
are preserved. Status: COMPLETE for the authorized local delivery; evidence is recorded in
`docs/VNEXT_P1_1_VALIDATION.md`. GPS-first onboarding, national N03 resolution,
same-session location updates and accessible consumer UI do not grant new
safety authority. Real-device GPS, preview deployment and production traffic
switching are outside this delivery. Production references below are historical
and are not evidence for this new branch.

Implementation commit: `2bea4a70fe953c32f4f6a5bab5c427703231dd86`.
Production web build: `9H889OhKjWnSKj1ZwsfEQ` (local runtime only).
Validation: frontend 211/211, backend 133/133, typecheck/build, national asset
reproduction, browser acceptance and independent Luna Max review passed.
Full P1.1 release remains pending real-device and production acceptance.

## Current follow-up — first-use UI polish (2026-10-08 JST)

The user requested neutral pre-session status, mobile onboarding scenes and a
single desktop Judge / Demo footer label. These bounded changes pass 160 frontend
and 103 backend tests, TypeScript/build, source hygiene and Main's In-app Browser
checks. Zero-traffic preview, actual Gemini replay, Live, offline reload and
canonical acceptance passed. `h72-ui-910c1d2` receives 100% production traffic;
previous P1/P0 revisions are retained. Status is COMPLETE for this follow-up;
remote Git synchronization remains separately BLOCKED by repository access. See
`docs/VNEXT_FIRST_USE_POLISH.md`; previous production evidence below is historical.

## Current authorized work — vNext P1 (2026-10-07 JST)

The user's `/goal complete` request authorizes implementation and necessary
validation of `docs/VNEXT_P1_LIVE_ROUTE_DEVICE_ROLES.md`, including its approved
mobile scene system. Work is isolated on `codex/vnext-p1`, baseline `80b919d`.
The previous release's exclusions of live official data apply to that release;
they do not block this separately authorized P1 scope. No Push, Rescue Beacon,
native background service or additional paid API dependency is included.
Safety Core, immutable plans and offline/reconnection gates remain authoritative.
Implementation and non-GUI verification are complete, with 103 backend and
148 frontend tests, typecheck/build, actual provider/API probes and focused
review passing. The restored In-app Browser has passed local mobile/PC GUI,
candidate rendering, keyboard/contrast and actual browser offline/reconnect
checks. P1 production acceptance passed and `h72-p1-b6950fb` receives 100% traffic;
the accepted P0 revision remains the rollback. Status is COMPLETE for bounded P1
implementation/release. Remote Git synchronization is separately blocked by
repository access; no original checkout or main mutation occurred. Current evidence is recorded in
`docs/VNEXT_P1_VALIDATION.md` and `docs/VNEXT_P1_PRODUCTION_RELEASE.md`.

## Current authorized release — vNext (2026-10-05 JST)

The user explicitly authorized final RC review, blocker-only fixes, merge to
`main`, push, Cloud Run deployment, production smoke/browser acceptance, production
documentation/submission assets, and a submission-freeze decision. These release
actions no longer require the earlier local-only approval gate. Live official
feeds, Web Push, rescue dispatch and native/device endurance work remain outside
this release scope. Current evidence and exact runtime identity are maintained
in `docs/VNEXT_PRODUCTION_RELEASE.md`; local RC records below are historical.

This authorized release is now deployed and accepted: runtime `8d1836e`,
Cloud Run revision `h72-vnext-8d1836e`, 100% traffic, actual Gemini/ADK and clean
canonical browser/offline/mobile/mock-location gates PASS. Submission freeze is
deferred pending YouTube/dashboard/eligibility/final submission. Start new feature
work on a separate `codex/` branch; do not silently expand the accepted release
into live feeds, Web Push, Rescue Beacon or native/device endurance work.

## Current authorized work — vNext P0 (2026-10-05 JST)

The user explicitly authorized all P0 implementation and testing. Work is isolated
on `codex/vnext-p0`, baseline `772c264`; `main` remains the release source of truth.
`docs/VNEXT_PRODUCT_PLAN.md` and `docs/VNEXT_P0_CONTRACTS.md` define this expansion.
The safety contract still controls action eligibility. The user subsequently
authorized a local commit and Release Candidate preparation. Merge/push,
deployment, billing and P1/native rescue work remain separate gates.

The older phase/branch/cloud statements below are historical development records;
current baseline deployment evidence is in `docs/VALIDATION.md`. This branch's
local P0 acceptance is recorded separately in `docs/VNEXT_VALIDATION.md`.
The seven P0 modules are now locally implemented and validated (61 frontend
tests with real API fixtures, 55 backend tests, typecheck/build and browser
desktop/mobile/offline checks). This branch has not been deployed or pushed.

The user additionally authorized configurable map/profile, consented local Last
Known Location persistence, and a generic area/severity schema. This follow-up
is tracked in `docs/VNEXT_AREA_LOCATION.md` and is locally COMPLETE: 69 backend
tests, 77 frontend tests with fresh API fixtures, typecheck/build, independent
source/contract review, and map/profile/LKL browser checks pass. Build
`qsh1YmaIahspngAHgjxoR` runs on local port 3005. LKL QA uses browser mock
geolocation, not real GPS. Only the central Tokyo map is installed. Earlier P0
results below are historical; no deployment or push was performed.

## Current delivery — vnext-p0-rc1

Local commit and Release Candidate preparation are authorized and recorded in
`docs/VNEXT_RELEASE_CANDIDATE.md`. The exact candidate commit/tree and source ZIP,
fixture and screenshot hashes are in the local `.work/releases/` package.
The RC gate re-ran 69 backend / 77 frontend tests with fresh canonical fixtures
and TypeScript. Accepted browser-tested web build remains
`qsh1YmaIahspngAHgjxoR`. Runtime code was frozen during this preparation.
Historical uncommitted-state statements below describe the pre-RC stage.

## Phase

**Phase 3 — IMPLEMENTED / NOT FULLY VALIDATED**

Canonical development branch: **codex/hackathon-mvp**. Consolidate the requested
Ekispert provider, Hackathon skills and mobility docs here. Do not continue the
independent b25f application scaffold. Merge the validated canonical tree into
main; preserve prior worktree changes as a recoverable record.

Phase 2 core gate accepted: 22 backend tests and a full 11-event HTTP replay
through the production frontend passed; the actual snapshot passed the frontend
schema boundary. Four immutable plan versions and twelve actions were produced.
Independent review found source/claim scope and equal-timestamp reconnect issues.
Both are fixed with regression tests; independent reproduction now rejects the
unauthorized claim and keeps pre-restoration evidence behind the reconnect gate.
Frontend PWA shell, local snapshot/TTL degradation and emergency pack are
implemented. Nonempty offline-plan browser acceptance passed and is recorded in
`docs/VALIDATION.md`.

Phase 3 local gate: 40 backend tests and 18 frontend tests (including a real
11-event API snapshot), typecheck and production build passed on 2026-10-05 JST.
ADK 1.39.1 / Vertex Gemini integration, bounded typed candidate selection and
server-owned safety publication are implemented. The real SDK path without ADC
produced TIMEOUT / MISSING_ADC fallback and four immutable plan versions; no
successful Gemini request or cloud deployment is claimed. Independent re-review
found no new blocking issue in this scope. Cloud Shell was selected but its
browser reached Google sign-in only. Target project access remains unverified.

Consolidation gate: original 40 backend tests (including Gemini) plus 11 Ekispert
adapter tests pass, **51 total**. Frontend gate remains 17 tests plus one real
snapshot contract check, **18 total**, with typecheck/build and fallback GUI
acceptance. MCP 1.30.0 is explicitly locked; Ekispert remains a backend-only
provider-data boundary and does not promote results into trusted route evidence.
Its live connection is unverified because no backend key is configured.

Phase 1 foundation accepted on 2026-10-04: 17 backend tests, 5 frontend
boundary tests (including a live API snapshot), TypeScript and Next.js build
passed. Replay, immutable domain contracts, isolated sessions and the API/web
connection are implemented. Secret-pattern checks passed. Browser acceptance
is tracked separately in `docs/VALIDATION.md`.

The Phase 1 specification below remains the acceptance baseline. Cloud Run
deployment and real Gemini/ADK execution are still unverified. Target Google
Cloud project: `h-japan`.

Do not begin production API integration, advanced UI polish, or broad feature expansion until the Phase 1 acceptance criteria below pass.

## Objective

Create the minimum working foundation that can later support the real agent pipeline without rewriting core domain logic.

Phase 1 should establish:

- repository/application skeleton
- canonical domain types
- deterministic replay event model
- situation state model
- evidence model
- plan and plan-action model
- trace-event model
- state transition boundaries
- test harness for deterministic behavior

## Required Deliverables

### 1. Repository Structure

Recommended starting shape:

```text
72H/
├── apps/
│   └── web/
├── services/
│   └── api/
├── packages/
│   └── contracts/
├── tests/
├── docs/
├── .ai/
└── AGENTS.md
```

A simpler structure is acceptable if it keeps frontend, backend, contracts, tests, and docs clearly separated.

Do not introduce a monorepo framework unless it materially simplifies the implementation.

### 2. Shared Domain Contracts

Implement typed schemas for at least:

- `UserProfile`
- `DisasterEvent`
- `Evidence`
- `Situation`
- `Plan`
- `PlanAction`
- `TraceEvent`
- `ReplayEvent`
- `ReplaySession`
- `NetworkState`

Use `docs/DATA_MODEL.md` as the canonical design source.

### 3. Deterministic Replay Engine

Implement a replay engine that can:

- load a scenario
- start
- pause
- resume
- advance to next event
- reset
- emit events in deterministic order
- preserve event IDs and timestamps

The replay engine must emit data into the normal application pipeline. It must not directly render predetermined plans.

Initial event kinds should support at least:

```text
disaster_alert
official_update
transport_update
unverified_report
network_degraded
network_lost
network_restored
verified_update
plan_expiration
```

### 4. Situation State

Implement a deterministic situation-state container that can represent:

- user context
- active disaster event
- evidence references
- mobility state placeholder
- current plan reference
- uncertainty states
- conflicts
- network state
- updated timestamp

Phase 1 does not require sophisticated Gemini interpretation yet.

### 5. Evidence State

Implement evidence objects with fields necessary for later safety checks, including:

- ID
- source
- source type
- claims
- published / received timestamps
- affected area
- trust state
- freshness state
- conflict state

Trust/freshness logic may begin as explicit deterministic test values during Phase 1, but the domain model must support the final Safety Core design.

### 6. Plan Model

Implement versioned plans with:

- plan ID
- version
- status
- created time
- expiration
- evidence references
- invalidation reason
- actions

Plan actions must support:

- category: `NOW | NEXT | AVOID`
- evidence references
- dependencies
- risk level
- status

Never overwrite old plan versions.

### 7. Trace Model

Every important replay and state transition should be capable of emitting a structured trace event.

No private chain-of-thought fields.

### 8. Tests

Phase 1 tests must prove at least:

1. replay ordering is deterministic
2. replay reset restores initial state
3. identical replay input produces identical core state transitions
4. plan versions are append-only
5. evidence references remain stable
6. network-state transitions are represented correctly
7. timeline-specific hard-coded plan rendering does not exist

## Explicitly Not Required Yet

Do not block Phase 1 on:

- live JMA integration
- live Safety Tips integration
- live transport API / 駅すぱあと API MCP Server integration
- Secret Manager
- Firestore persistence
- production Cloud Run deployment
- Gemini output quality
- ADK orchestration
- complete PWA offline cache
- final UI design

Those belong to later phases.

However, architecture boundaries must make those integrations possible without replacing the core domain model.

For mobility, preserve the provider boundary for deterministic replay and
`EkispertMcpProvider`. Live 駅すぱあと output is mobility candidate data only; it
cannot independently authorize a disaster-safe route or high-risk action.
The Phase 1 gate was passed before adding this live adapter boundary.

## Phase 1 Acceptance Gate

Phase 1 is complete only when:

```text
Replay Scenario
→ Replay Events
→ Situation State Updates
→ Evidence State Updates
→ Trace Events
```

runs deterministically and is covered by automated tests.

Additionally:

- core schemas match documented contracts
- no secrets exist in the repository
- replay is data-driven, not UI-scripted
- prior plan versions cannot be silently overwritten
- all relevant tests pass

## Historical Phase 1 → Phase 2 transition

This transition was completed locally; retain it as the historical gate:

**Phase 2 — Deterministic Safety Core**

Phase 2 will implement:

- source trust evaluation
- evidence TTL / freshness
- conflict handling
- action risk classification
- dependency invalidation
- plan expiration
- safety allow/modify/block decisions
- local offline degradation rules

Do not skip directly to agent polish before the Safety Core is working.

## Current next gate

Use the reviewed Cloud Shell source bundle to build private Cloud Run staging in
`h-japan`. Record source hash/image digest, prove a successful Gemini/ADK call,
and perform deployed clean-browser/offline acceptance before configuring judging
access. Model credentials, project IAM/billing and Docker/cloud build are still
unverified. No live-feed, persistence or broad feature expansion is authorized
by completing the local gate alone.
