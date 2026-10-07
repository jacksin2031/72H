# First-use UI polish — 2026-10-08 JST

Scope: the three production UI issues reported by the user. Safety Core, source
adapters, plan contracts and movement eligibility are unchanged.

## Behavior

- Before a Live snapshot exists, the header says setup is needed and does not
  display a source/connectivity verdict. An actual pending initial request says
  information is being checked. Existing-session warnings remain visible.
- Mobile initial setup has three scenes: current location and manual region;
  accommodation and manual region; party size including the user. Self-reported
  safety is optional and defaults to UNKNOWN. Back and language changes retain
  the draft. Only the final step submits the existing validated profile contract.
  Desktop and profile editing retain their full forms.
- Desktop footer renders the translated `Judge / Demo →` label once.

## Local acceptance

Main used the selected In-app Browser at 390×844 mobile and 1280×900 desktop.
Final local build: `Cfa8-ESr8QzC6DiioNbQn`, origin `http://127.0.0.1:3013`.
Interactive submission checks used the same implementation on port 3012 before
the final heading focus-outline CSS adjustment.

- 160/160 frontend tests, zero skips; 12 added renderer regressions cover all
  three languages, initial/querying/existing-session statuses, first scene and
  footer. The remaining API contract fixtures retain their 2026-10-07 production
  capture provenance; they are not new cloud acceptance.
- 103/103 frozen backend tests; existing Starlette/httpx deprecation warning.
- Integrated TypeScript and optimized production build PASS; 23 offline assets.
- Secret-pattern/credential-file scan and whitespace checks PASS.
- Empty and whitespace-only locations cannot advance. Enter advances one scene.
  Back retains both locations and manually selected regions. Language change
  retains step 3. All scenes contain the fixed Home/Plan/More navigation.
- Browser network events show zero Live requests during steps 1–2 and exactly
  one POST `/api/live/start` on completion. Party size 3, UNKNOWN self-report,
  manually selected JP-13/JP and null coordinates are preserved in the payload.
  Controls disable while waiting; the header says information is being checked.
- Actual JMA response is STALE and ONLINE_DEGRADED, with zero plans/actions and
  movement authorization false. No map canvas is mounted. This local run uses
  deterministic planning, not a new Gemini execution claim.
- Mobile body width is 390/390; desktop body width is 1265/1280. The desktop
  footer reads exactly `Judge / Demo →`.

Ignored browser evidence: `.work/ui-polish-20261008/`, including screenshots,
actual Live response and submitted request. No real user location was supplied;
the test locations are explicit QA labels.

## Release

Pending preview and canonical acceptance. Previous production remains
`h72-p1-b6950fb`, image digest
`sha256:94f200eefc32d7db207dce9be29c17c8c969bdb14ffdae5b894fab3be023eeac`.
The October 7 P1 acceptance record is historical and remains intact.
