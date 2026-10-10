# P1.7 — Historic disaster clock and bounded time travel

Date: 2026-10-10 JST
Branch: codex/p1-7-historical-drills
Baseline: P1.6 Mock Live; production remains P1.2.

## Supported historical cases

- 2011 Tohoku / 311: 2011-03-11 14:46 M9.0 earthquake, 14:49 tsunami warning, 15:14 expanded warning, 15:15 largest M7.6 aftershock. Source: https://www.jma.go.jp/jma/en/2011_Earthquake/Information_on_2011_Earthquake.html
- 1995 Hanshin Awaji quake (one subsequent illustrative utility-disruption stage clearly flagged as NOT historical timestamp).
- 2016 Kumamoto two major earthquakes (14 Apr 21:26 and 16 Apr 01:25 JST).
- 2018 Hokkaido Iburi earthquake and blackout.
- 2024 Noto earthquake, tsunami warnings and an additional quake.

All historic time points retain JST timestamps and source URLs. Quake milestones can feed synthetic typed earthquake data into the *real LiveStore* evaluator / CandidatePlanner. Tsunami and utility labels are not presently distinct types in the earthquake-only Safety Core and are shown as informational background ONLY; never interpreted as safety authorization. No fake safe routes or shelter authorizations.

## Clock controls and wall-time semantics

1. **FAST_RANGE**: select inclusive JST time window; back end validates range against allowlisted case and only processes matching events immediately in order. Example 311 14:46–15:00 selects first two events without waiting 3 actual minutes. AI calls remain real, with normal provider latency.
2. **REALTIME**: process first selected milestone, then use original elapsed historical delay (1×) before subsequent event. No event may be processed early.
3. **ACCELERATED**: configure pre-disaster *simulation start* time within the 24h before the first milestone and speed 10, 60, 300, 600 or 3600×. Virtual clock advances without server sessions or AI calls. When virtual time reaches first disaster event, clock automatically switches to 1×, then opens a bounded Mock Live session and processes the event through real LiveStore and planner. Subsequent events respect **absolute elapsed normal time**, including any AI request duration, rather than adding extra delays. Simulation does not alter hardware/system/browser time. Abort cancels pending simulated wait and prevents future submissions.
4. Server-side validation rejects wrong timezone, inverted range, out-of-event scope, no-event selection, case missing or unknown case. UI refuses over-long pre-roll (over 24h; >10m real wait) and event gaps over the 28m safe session window in 1× mode; offer FAST_RANGE to test those moments.

## Verification

- Frontend Vitest: 248 passed, 3 previously skipped.
- Backend pytest: 150 passed.
- TypeScript typecheck: PASS.
- Next.js production build: PASS.
- Secret scan and diff check: PASS.
- Six clock tests including exact 60-minute → 6-second at 600× transition, abort and input validation.
- Seven history/window tests, including single tsunami event without fabricating prior quake, two-event partial 311, source isolation, JST/date/range constraints.
- Android ASUS_AI2201_A on Chrome with ADB, 411 CSS px: five official case options plus custom, historical info and accelerated controls rendered. Selecting the accelerated mode with default 311 prelude, 600× progressed 13:46, 13:56, 14:06, 14:16, 14:26, 14:36, then 14:46 and switched to 1× in roughly six physical seconds. No horizontal overflow.
- That ADB local phone smoke entered an intentionally invalid test key and received 404 **after the 14:46 trigger**. This proves no backend call before the milestone but is NOT evidence of an authenticated AI call in the accelerated mode. Prior P1.6 real Gemini integration was validated separately.

## Release

- New version may deploy to **0%-production-traffic** tagged Preview only, preserving all previous previews. Do not promote to production without further approval.
- Preview must be smoke-tested for catalog API, key-gated Mock Live API, Android rendering, cloud safety, and no production traffic changes.
- Physical iOS VoiceOver, TalkBack narration, OS large-font behavior and actual disaster conditions remain unverified.
