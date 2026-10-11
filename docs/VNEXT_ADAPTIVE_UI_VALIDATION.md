# Adaptive UI — local acceptance record

> Historical evidence for `codex/adaptive-ui` only. Its test counts, build and
> browser behavior do not validate the current integration or current release.
> The later implementation supersedes manual map mounting and native disclosure
> details with the current deterministic gates and accessible dialog behavior.
> Current evidence: `BRANCH_INTEGRATION_2026_10_11.md`.

Date: 2026-10-05 JST. Branch: `codex/adaptive-ui`. Baseline: `80b919d`.
Status: COMPLETE — LOCAL ADAPTIVE UI SCOPE / VALIDATED.
Scope: [VNEXT_ADAPTIVE_UI_UPDATE_SPEC.md](VNEXT_ADAPTIVE_UI_UPDATE_SPEC.md).

## Implementation and acceptance mapping

| Requirement | Implementation / evidence |
|---|---|
| NORMAL/MONITOR text first, one usable NOW | Pure policy + Home renderer tests; no default map, inbox, permission or power cards |
| PREPARE / protection / evacuation presentation | Six-mode selector tests; L4 remains PREPARE, never automatically EVACUATE |
| Verified movement gate | Positive/negative explicit authorization tests and destination/candidate renderer test; current server contract cannot authorize this flow |
| On-demand map and unmount | Conditional component branch, MapLibre cleanup removes map; browser close removes map/location subtree |
| Progressive disclosure | Native collapsed details for NEXT/AVOID/reasons/sources; technical records remain in Demo/Trace/Sources/Plan |
| Safety checks | Exact session/event + prior consent predicate; More controls and active timers share the predicate; matching help persists after resolution |
| Notifications | Home badge links to dedicated `/notifications`; ledger/dismissal behavior retained; route precached for offline |
| Power | Settings in More; emergency nonessential surfaces suppressed; Survival preserves NOW/contact/LKL/timestamps/settings access |
| Offline / reconnect | Existing continuity/reconciliation gates unchanged; cached/stale wording with verification timestamp; expired/invalid primary actions withheld |
| Dark-first / accessibility | Dark/System/High Contrast preferences; native disclosure, labels and focus outlines; reduced-motion and non-NORMAL power disable animations |

## Automated gates

- Backend: **69/69 PASS** (`uv run --project services/agent-api pytest services/agent-api/tests`).
- Frontend: **104/104 PASS** across 14 files: 77 baseline tests plus 27 adaptive policy/renderer regressions, using fresh schema-validated local API fixtures. Final run: 2026-10-05 23:11 JST.
- TypeScript: PASS. Production Next.js build: PASS, including static generation; final build ID: `0MqvaK7BS87lz1Fk6F62t`.
- Secret gate: PASS, includes tracked and new non-ignored files. `git diff --check`: PASS.
- Actual API replay: 11 events, append-only plan versions 1–4, final ONLINE_VERIFIED;
  planning mode DETERMINISTIC_REPLAY_ONLY. No Gemini or external-source call is claimed for this local UI gate.
- Ignored fixture metadata/hashes: `.work/p0-api-fixtures-manifest.json`.

Reviewer identified stale LOW-risk evidence, old-session check controls and marker
contrast. All three were fixed, with regression coverage for stale NOW and online
expired timestamps. Follow-up identified an unselected stale NOW causing a false
stale label on a valid primary action; the projection now flags this only when no
usable NOW remains, with a multi-NOW regression test.

Computed foreground/background contrast: body 14.70:1; muted text 8.59:1;
keyboard focus 13.87:1; destination marker 8.22:1; contrast marker 16.27:1.
These are CSS color calculations, not a claim about every physical display.

## Browser evidence

Operator: Luna Lightweight. Preliminary CUA desktop gates passed on local
production port 3008: single NOW, collapsed details, separate inbox, theme
selection, near-black Survival, emergency contacts, settings and returning to
Auto. Osaka uncovered map state was truthful; no device-location permission was
requested. CUA lacks viewport/offline controls, so the same operator moved to a
separate Playwright CLI session for the remaining gates.

- Mobile 390 x 844: one NOW, collapsed details, no automatic map; explicit map
  opening rendered the central Tokyo pack and attribution without requesting GPS.
  Closing removed the map/location subtree and exposed transition wording.
- Full Tokyo GUI replay: all 11 events; append-only plans 1–4; final L1 MONITOR,
  ACTIVE plan v4 and badge count 7.
- Actual browser network loss and same-session reload: Service Worker cached
  Home retained NOW, last verification time and cached/expired wording. Physical
  reconnect showed RECONNECTING, without claiming verified recovery.
- Consent enabled before a new Tokyo session: eligible L4 PREPARE event exposed
  three safety responses. SAFE response removed the controls and retained NOW.
  The separate inbox exposed one CRITICAL item; marking it read cleared its count.
- One expected `ERR_INTERNET_DISCONNECTED` RSC request occurred while offline;
  no other console errors or warnings were reported.

Screenshots under ignored `output/playwright/adaptive/`:

| File | SHA-256 |
|---|---|
| `home-mobile-390x844.png` | `d8b29cfb998b0b6fb161a79b8f65f36a51159b59e56626a59d0fdc7e98bf61f8` |
| `map-mobile-390x844.png` | `051223245f1fc37cdb7441bb4021b42a09cd52c42c55b5f55475e3542bea5ed1` |
| `offline-home-390x844.png` | `397c38b99bba56b38fe729df4e861f0a87dc17f53037309dc868376437cc03e4` |
| `reconnecting-home-390x844.png` | `c55af8beaa8c78da8db392ba0729e6fd3628252280617f0acb13323b7b2cda55` |
| `home-final-390x844.png` | `162c3c0054a302fa2387a05f68d5609fdff6bf8d2b9274f5def752fe5f519523` |
| `home-final-keyboard-390x844.png` | `e1c9890e60e55f38f08cfa9f806de1a208bb4a302365d44c44eef276a9246cec` |

Final build `0MqvaK7BS87lz1Fk6F62t`: 390 x 844 Home retained one NOW, folded
details and no default map. Tab exposed a visible Home focus ring. More →
SURVIVAL → Plan retained exactly one NOW, minimal power status, last verification
and location text, emergency contacts and Settings. More → Auto restored the
normal Home. Final console: zero errors/warnings. Final keyboard screenshot:
47,505 bytes; final Home screenshot: 46,633 bytes.

Earlier network/map/replay evidence used the immediately preceding production
build; the final changes affect badge rendering and Survival routing. Accessible
labels, landmarks and disclosure state were checked in browser accessibility
snapshots; a physical screen-reader session was not run.

## Runtime boundary and remaining non-claims

The production projection fails closed on automatic movement. The current public
snapshot has no Safety-Core-approved evacuation intent or eligible destination.
The positive MAP_ASSISTED/protect cases prove the bounded UI contract, not a live
evacuation system. Reference maps and transportation availability never grant
route safety. Adding that authorization requires a separately reviewed backend
contract; no UI/model flags are accepted as authority.

Cloud release, live feeds, push/rescue, physical-device GPS/battery endurance,
guaranteed background alarms and measured battery savings are outside this scope.
The accepted production baseline is unchanged. No merge/push/deploy was performed.

## Tooling note

The host npm `minipass-flush` issue was handled by an existing scoped loader shim,
without modifying global npm. A worker's `pnpm test` automatically bootstrapped
dependencies mid-dev-session. The generated pnpm lock was removed, npm-ci runtime
restored, and acceptance moved to a fresh production browser origin. Transient
dev module-resolution overlays are environment events, not product acceptance.
