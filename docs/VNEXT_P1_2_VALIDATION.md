# P1.2 simplified More — local acceptance

Date: 2026-10-09 JST. Status: COMPLETE for the authorized local delivery.

## Scope and provenance

- Specification: `VNEXT_P1_2_SIMPLIFIED_MORE_UI.md`.
- Workspace: `C:\Users\jacks\.codex\worktrees\a353\72H`.
- Branch: `codex/vnext-p1-2-simplified-more`.
- Baseline: `7747b2b` (P1.1 preview verification ledger).
- Authorized: frontend implementation, regression tests, local production build,
  browser acceptance and independent review. No deployment/push/traffic changes.
- Original P1.1 checkout and its untracked requirement document are preserved.
- Backend runs locally on 8022 with deterministic planner; frontend on 3022.
  Python packages are reused from P1.1, with `PYTHONPATH` explicitly selecting
  this checkout's backend and contracts (module paths verified).
- Global npm has an existing minipass loader error. Dependencies were installed
  using an isolated npm 11.6.2 via bundled pnpm; package lock remains unchanged.

## Initial evidence

- Backend suite: 133 tests pass, one existing Starlette/httpx deprecation warning.
- Fresh replay capture through the local frontend proxy: 11 events, four
  immutable plan versions, final ONLINE_VERIFIED.
- Actual local JMA session: STALE / ONLINE_DEGRADED / movement_authorized=false.
- Same-region GPS refresh preserves existing evidence and plans; metadata-only
  profile save preserves session and current location/timestamp.
- Mobile manual bounded Tokyo selection works without typing; emergency basics
  and 119/110 are present before setup.

## Delivered behavior

- Consumer More now has a truthful location card, one one-shot GPS action,
  a bounded manual area fallback, four settings destinations and a minimal
  119/110 footer with emergency guidance disclosure.
- Personal settings require Edit and explicit Save. Session-scoped drafts
  survive language changes, Back and reload. Failed saving preserves drafts;
  only successful saving or explicit discard clears them.
- Device GPS/LKL and the server's confirmed information area are separate.
  Original timestamps remain visible. Accuracy is attached to an area only
  when both came from the exact same GPS observation. Offline GPS never claims
  server sync, official freshness or movement authorization.
- Plan owns immutable history and deliberate advanced transport candidates.
  Candidate-vs-safety warnings and the existing eligibility gates remain.
- More contains no Judge/Demo, handoff, raw source diagnostics or map pack IDs.
  PC retains its source review, Judge and public-link handoff behavior.
- Emergency protection and Safety Check take precedence over a pending/failed
  location gate, while old EVACUATE instructions, maps and routes stay hidden.
  Three-language Safety Check response labels were also repaired after browser
  QA found previously unnamed buttons; help response behavior is tested.

## Final automated validation

| Check | Result | Evidence |
| --- | --- | --- |
| Frontend full suite with replay/contract/live fixtures | PASS: 30 files, 234 tests, zero skips | `.work/p1-2/frontend-final.log` |
| Backend full suite | PASS: 133 tests | `.work/p1-2/backend-tests.log` |
| TypeScript | PASS: `tsc --noEmit` | Completed before final build |
| Production build | PASS | `.work/p1-2/build-final.log` |
| Secrets and whitespace | PASS | `python scripts/check_secrets.py`; `git diff --check` |
| Independent Luna Max review | PASS | Critical gate, location provenance, drafts, Plan warnings, privacy and final label fixes reviewed read-only |

Final production build ID: `FzOPgT9JLGZuQILDEk7AS`; 23 offline shell assets.
Runtime preview: `http://127.0.0.1:3022/more`; local API: port 8022.
The tested frontend file hashes are recorded in
`.work/p1-2/source-tree-manifest.json`. Changes remain on this local branch;
no commit, push, cloud build, deployment or traffic promotion was performed.

## Browser acceptance

Main performed these checks in the Codex in-app browser against the production
server. Controlled GPS and scene inputs are explicitly synthetic test data;
they were injected only in this localhost browser, not added to the app API.

- **More matrix:** ja/en/zh-TW × 320/375/390/430 px × 100/200% root text size ×
  landing/personal/display/offline/privacy = **120 recorded checks**. No
  horizontal overflow or consumer diagnostic leakage. Four full-width rows
  are at least 56px tall; the single GPS CTA is at least 60px tall and visible
  within the unscrolled normal-text viewport. Large text uses normal scrolling.
- Every settings Back restores focus to its originating row. Keyboard Enter
  opens and closes destinations; restored focus has a visible 3px outline.
- Plan current/history/advanced and personal editing were checked in all three
  languages at the strict 320px/200% size. History/advanced Back restores focus;
  candidates stay deliberate and unavailable without their existing gates.
- Contrast and system-light palettes were observed on the actual live shell.
  Reduced-motion media and normal/conserve power behavior were exercised.
- Personal drafts survive language changes, Back and offline cached reload.
  An offline Save shows failure and retains input. Online Save completes on
  the same session while source verification remains incomplete.
- Controlled denied GPS: **one request, zero watches**, no prompt/retry loop;
  the national prefecture/municipality chooser works without typing.
- Controlled GPS-first onboarding resolves a Shibuya fix on the device and
  exposes the confirmation step before Start. Offline GPS shows a separate
  device point, time and accuracy; the selected shared information area stays
  unchanged. Retained points reload as last-known with their original time.
  Forget clears point and consent without clearing the session.
- Controlled MONITOR and SHELTER have no map. A fully authorized controlled
  movement snapshot mounts the map; watch callbacks update the device point.
  Watches 1/2/3 are cleared on offline/background/scene end respectively.
  Reopening follows a fresh typed controlled packet through the existing
  reconciliation checks; network restoration alone does not verify it.
- Final Safety Check buttons have meaningful labels in every language at
  320px/200%. The actual 'need help' click shows the corresponding local status.
  119/110 remain available during the critical takeover.
- Cached offline reload works for both an existing session and pre-session
  emergency basics. Offline readiness remains conservative: cached files do
  not claim all offline capabilities have been verified.
- Desktop role at 1280px retains source review/Judge/handoff. No public HTTPS
  app URL is configured locally; the page correctly declines to expose a
  shareable local/session link.

Machine-readable evidence and screenshots:
`output/playwright/p1-2/browser-matrix.json`, `browser-behavior.json`,
`more-zh-375.png`, `offline-device-gps.png`, `offline-readiness-final.png`,
`profile-save-offline.png`, `keyboard-focus.png`, `controlled-shelter.png`,
`controlled-map-gps.png`, `safety-check-*-final.png`,
`offline-pre-session-emergency.png`, and `more-zh-375-final.png`.

The 120-check settings matrix used build `kD9d3Hjb0apnhkPtqY0sb`; the only later
product change adds missing Safety Check response labels. Final-build browser
checks revalidated those labels, their response behavior, themes, PC role and
More landing. Full tests/typecheck/build were rerun after that change.
The browser's temporary GPS/fetch/media/font/network overrides and controlled
session caches were removed or restored after testing.

## Safety and evidence boundaries

- Replay still traverses the real deterministic backend pipeline; four plan
  versions are preserved. No timeline-specific UI branch or second GPS store
  was introduced. Safety Core, API schema and backend source were unchanged.
- The actual local JMA probe remains STALE / ONLINE_DEGRADED, with movement
  authorization false. Its same-area location/profile tests do not establish
  official freshness. Controlled scene packets are not live JMA observations.
- The backend uses the deterministic planner locally. This run does not assert
  fresh Gemini/ADK, Ekispert credentials or other live provider acceptance.
- Physical Android/iPhone permission/accuracy/background behavior, actual
  screen-reader software, battery endurance and cloud release are **NOT RUN**.
  Browser semantics/keyboard checks and simulated visibility are local evidence.
- No remaining blocker for the authorized local scope. Real-device validation
  and a separately authorized immutable preview remain release follow-ups.
- Non-blocking existing localization follow-up: when a controlled refresh
  packet was deliberately rejected by schema validation after a language change,
  the generic source-unavailable alert used the mount-time Japanese copy.
  The payload was safely rejected; investigate the existing reconnect callback's
  language closure separately from these settings/navigation changes.

## Evidence locations and separate gates

Ignored local artifacts: `.work/p1-2/`, fresh replay fixtures in `.work/`, browser
screenshots/matrix under `output/playwright/p1-2/`.
Controlled GPS/scene browser fixtures are test input, never official evidence
or real-device measurement. Physical Android/iPhone GPS, screen readers,
background behavior and battery endurance remain separate release gates.
