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

Status: **COMPLETE for the three UI fixes and bounded production acceptance.**

| Item | Verified value |
|---|---|
| Source commit | `910c1d2609d30d88fd9c9ff48b210fd4e9b4e81d` |
| Git archive SHA-256 | `3b1d90c0ef51392164494c027c2862bceabee6d408b054daee1851e2e7e6111d` |
| Cloud Build | `84373dbe-5da9-4814-b037-ec531f90877d`, SUCCESS |
| Image digest | `sha256:142b2899819d34a5c39221972eb29fdb6ec6bd6cadb9b837890e9e8f776f0b9a` |
| Web build | `wcHwkNJS5DoWk4EFIWv8E` |
| Project / region | `h-japan` / `asia-northeast1` |
| Revision / traffic | `h72-ui-910c1d2`, 100% |
| Canonical app | https://h72-vux6j7xjka-an.a.run.app/dashboard |
| Preview | https://ui-910c1d2---h72-vux6j7xjka-an.a.run.app/dashboard |

The immutable archive/image was deployed with zero traffic. Before promotion,
Main verified all three onboarding scenes on the clean preview origin, final
Live submission, PC footer and real browser network loss plus interactive reload.
Restoration remains RECONNECTING for stale Live evidence. The viewport and
network overrides are restored.

Preview HTTP acceptance completed 11 replay events and append-only plans 1–4,
with four actual `GEMINI_CANDIDATE_APPLIED` and zero fallback. Eight HTML routes,
23 static assets and map-pack hashes passed. Actual JMA evidence is non-synthetic;
STALE/ONLINE_DEGRADED produces zero plans/actions and movement authorization false.
Transport search was not repeated for this UI-only change; the October 7 actual
provider acceptance remains historical evidence.

After promotion, canonical HTTP checks at `2026-10-07T15:30:13Z` passed eight
HTML routes, health and 23 assets. Canonical and preview service-worker SHA-256
match: `0254ca7eae778fb72feb2db0e700f960dddd2809178fe61362566add9e8a3811`.
Canonical actual Live evidence remains STALE, with 512 designations, zero plans
and unauthorized movement. Main verified the corrected PC footer and mobile
390×844 body width with zero canvases. A pre-existing QA session belonged to the
retired in-memory server; its cached profile and missing-session warning were
preserved. More successfully created a new explicitly labelled QA session.
Clean first-use onboarding was verified on preview, not by deleting canonical
browser data.

Existing identity, invoker IAM and configuration were retained: runtime
`h72-runtime@h-japan.iam.gserviceaccount.com`, max one instance, CPU 1, memory 1 GiB,
concurrency 8 and timeout 60 seconds. No credentials or safety allowlists changed.
Previous P1 remains available at zero traffic as the immediate rollback; the P0
revision is also retained. Rollback command (documented, not executed):

```powershell
gcloud run services update-traffic h72 --project h-japan --region asia-northeast1 --to-revisions=h72-p1-b6950fb=100
```

Ignored cloud/browser evidence is under `.work/ui-polish-20261008/`. The October 7
P1 acceptance record remains intact. GitHub synchronization is separately BLOCKED:
a fresh `git ls-remote origin HEAD` still returns repository not found. The
original checkout and main are unchanged; no remote integration is claimed.
