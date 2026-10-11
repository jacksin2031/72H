# P1.5 — True end-to-end AI exercise over synthetic API replacements

Date: 2026-10-10 JST
Branch: codex/p1-5-agent-drill
Baseline: P1.4 Preview `71b7130`.
Release gate: 0%-production-traffic Preview only. No production promotion.

## Corrected intent

P1.4's front-end-only scenario picker was a **visual demonstration, not an AI exercise**. P1.5 adds an authenticated drill runner that compiles strictly bounded simulated provider events, sends each through the existing Replay Domain reducers and the real `CandidatePlanner` (Gemini/ADK when configured), and displays generated plan/actions, evidence and trace after each event. The SIMULATION label is non-dismissable.

## Bounded engine

- Only EARTHQUAKE currently has a real typed assessment contract. L0-L4 supported.
- No arbitrary source JSON, prompts, free-form text, area authority or user-controlled source key accepted.
- Server-owned allowlisted templates generate synthetic disaster alerts, emulated official assessment and transport disruption, plus optional virtual network loss/reconnect.
- Emulated official status can be FRESH, STALE or UNKNOWN. UNKNOWN omits the official report.
- Virtual offline state is fed into the reducer, not the phone network.
- Mobility CANNOT_MOVE is represented by a synthetic user's support constraint and self-report.
- 0–100% simulated battery (or unknown) is fed to the AI's bounded candidate-selection context, and the unchanged `derivePower` policy controls the local display. This does **not** yet make the server's deterministic Safety Core enforce battery-specific plans.
- Safety Core generates plan actions; AI only selects from bounded, validated candidates. A provider error falls back safely and is visibly distinguishable from a genuine GEMINI_ADK success.
- Backend route: `POST /api/drill/start`, `GET /api/drill/{uuid}`, `POST /api/drill/{uuid}/next`.
- DrillStore is a separate bounded in-memory session registry (max 8, TTL 30 min), not LiveStore or the ordinary ReplayStore.
- No real JMA/Ekispert APIs are called for drill inputs, no actual GPS/network/battery settings changed; no push notifications or emergency calls.
- Simulated evidence remains `is_synthetic=True` and cannot authorize HIGH-risk motion.

## Security

- Strict `DRILL_ACCESS_KEY` secret >=32 characters required; without it backend returns 404.
- All drill endpoints require the key via `X-Drill-Key` header and reject unknown secrets.
- Browser accepts access key in ephemeral component state only; not in URL, cookies, storage, logs or bundle.
- Next API proxy has same-origin POST checks and strict path+method allowlist, forwards only the special drill header on drill routes.
- Cloud Preview configuration must inject the key through Secret Manager, not static env literal or source files.
- Testing is real and may consume a small amount of Gemini/Vertex AI quota; CandidatePlanner's call limits remain enforced.

## Verified direct AI provider probe (local, bounded)

Gemini/ADK `gemini-3.5-flash-lite` using Vertex AI through existing CandidatePlanner; synthetic Tokyo earthquake L4, simulated battery 10%, CANNOT_MOVE, FRESH evidence, ONLINE network:
- Step 1: DETERMINISTIC_REPLAY_ONLY / zero plans.
- Step 2: GEMINI_ADK / Plan v1.
- Step 3: GEMINI_ADK / Plan v2.
- All evidence synthetic; no HIGH-risk action ALLOW. Explicit PROBE_DONE; no live session involved.

## Limitations / gates

- Tsunami, fire, typhoon, flood and landslide UI controls currently do NOT map into a typed Safety Core source: full AI exercise remains disabled for them until contracts and source adapters are added.
- Artificial FRESH is verified **inside the synthetic Replay trust registry only**; it must never appear as current official Live verification.
- True iOS/VoiceOver, TalkBack, physical OS font scaling, real device power/network stress, and disaster safety readiness are not claimed by this test.
