# P1.2 — Cloud Run Preview Acceptance

Date: 2026-10-09 JST
Status: **CLOUD PREVIEW SMOKE ACCEPTANCE PASS; FULL RELEASE PENDING REAL-DEVICE TESTS**.

This records the independently performed Google Cloud and browser checks for
P1.2 Simplified Mobile More. It does **not** claim a production deployment or
complete accessibility, physical GPS, or endurance certification.

## Release identity and scope

- Repository: `jacksin2031/72H`.
- P1.2 implementation: `04346335c34f2252d1ab35b03280f35981c61351`.
- GitHub PR: https://github.com/jacksin2031/72H/pull/6 — CI green, merged.
- GitHub main merge: `40c810ef93f0e5e95b49827a41466ca12eefeb1e`.
- Cloud Build source: immutable `git archive` of P1.2 implementation
  `0434633`, 1,328 tracked files, ~407.8 MiB before compression;
  untracked/ignored local debug and temporary data not included.
- Cloud Build: `f25de317-884b-4754-9837-1e93530d98eb` — **SUCCESS**.
- Registry tag: `asia-northeast1-docker.pkg.dev/h-japan/h72/72h:p1-2-0434633`.
- Immutable image digest:
  `sha256:92ca90b8552681aacb70f56fbeec44d81cfb75ac0c283afb4217ca8d8f74ee12`.
- Cloud Run project `h-japan`, region `asia-northeast1`.
- Preview revision: `h72-more-0434633` — **Ready, 0% production traffic**.
- Preview URL:
  https://more-0434633---h72-vux6j7xjka-an.a.run.app/more
- Production remains `h72-ui-910c1d2`, **100% traffic**.
  Previous P1.1 and P1 revisions are still separately tagged.

## GitHub independent CI

PR #6 GitHub Actions `Validate 72H` runs passed:
- Backend pytest suite.
- Frontend tests.
- Secret scan.
- Frontend TypeScript.
- Next.js production build.

The prior local P1.2 report `VNEXT_P1_2_VALIDATION.md` records 234
frontend / 133 backend tests and 120 controlled mobile More matrix checks.
Those are local acceptance evidence, not independent real-device measurements.

## Cloud HTTP availability

Preview endpoints confirmed HTTP 200:
- `/dashboard`, `/more`, `/plan`, `/sources`,
  `/notifications`, `/demo`;
- `/api/health`;
- `/areas/manifest.json`, `/areas/catalog.json`, `/areas/worker.mjs`;
- `/sw.js`.

## Live API safety

Ran `python scripts/validate_p1_http.py` on the actual Preview origin
without route-provider search.

Observed:
- Actual JMA typed evidence: **2** non-synthetic records.
- JMA source status: `STALE`.
- Plans: **0**.
- Destination candidates: **512** (designation, not open/safe status).
- `movement_authorized=false`.
- No map-authorized decision and no high-risk ALLOW.
- Live and replay session-store isolation checked by the acceptance script.

Evidence output: ignored local `.work/p1-2-preview-http/`.

No current official safe-movement verification was proven. The correct
observed result was fail-closed.

## Production Preview browser smoke

Used **isolated headless Chrome** against the actual cloud Preview.
Geolocation was emulated at Tokyo Station (latitude 35.6812,
longitude 139.7671, accuracy 20 m); browser network loss was emulated.
This is **not** a physical mobile GPS test.

- New-user mobile 390 px: initial location-first screen, no mandatory
  free-text location entry; two explicit choices.
- One-shot GPS action `現在地を確認`: succeeded; showed timestamp and
  `±20 m`, resolved conservatively to `東京都` rather than inventing a
  municipality. `72Hを始める` started a live session.
- Mobile More: truthful location information card, one GPS CTA, manual
  bounded area chooser, four destination entries, 119/110 and emergency
  basics. No Judge/Demo or route tool on landing.
- Each of Personal, Display, Offline and Privacy could be opened and
  returned using the visible Back control. Personal summary and Safety
  Check consent remained present; Privacy disclosed device retention.
- Plan displayed separate Current, History and Advanced candidate
  destinations. Candidate routes were marked not guaranteed safe and
  no movement map mounted while JMA data was stale.
- Offline reload of cached More remained accessible; status explicitly
  showed offline and saved information, no map mounted. Browser networking
  was restored afterwards.
- Desktop viewport 1280 px rendered preparedness, official-source review
  and Judge/Demo access; no map mounted with stale JMA.
- No horizontal overflow was observed (scroll width at or below viewport
  width in the measurements).

The local 120-case matrix remains the stronger evidence for three
languages, width variants, and 200% text scaling; the cloud smoke did
not re-run all 120 cases.

## Required follow-up before production release

1. **Real-device Android / iPhone GPS**: permissions, accuracy,
   source/area-sync feedback, background/foreground, lock/unlock and
   appropriate energy behavior.
2. **Real screen-reader / assistive-technology** walkthrough with
   focus, labels and active safety controls.
3. **Battery/endurance** check of one-shot vs authorized
   `watchPosition()` usage under power modes.
4. Final real-device browser/offline and progressive traffic validation,
   with explicit release decision and rollback revision retained.
5. Continue conservative handling of existing known minor localization
   reconnect-message closure, noted in local P1.2 report, if reproduced.

**No production traffic switch was made.** Simplifying More cannot alter:
`GPS_UPDATED != SAFETY_VERIFIED`,
`NETWORK_RESTORED != VERIFICATION_RESTORED`,
`route candidate != safe route`, and
`stale evidence cannot grant new high-risk movement`.
