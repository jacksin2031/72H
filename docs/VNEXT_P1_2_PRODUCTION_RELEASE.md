# P1.2 — Production Release and Rollback Record

**Date:** 2026-10-09 JST
**Status:** **PRODUCTION DEPLOYED — 100% TRAFFIC, POST-RELEASE SMOKE PASS**
**Scope:** P1.2 Simplified More & Senior-Friendly Navigation, including the accepted GPS-first P1.1 baseline. No new Safety Core authorization is introduced.

## Identity and provenance

- Source repository: `jacksin2031/72H`
- P1.2 implementation commit: `04346335c34f2252d1ab35b03280f35981c61351`
- Source merge PR: [#6](https://github.com/jacksin2031/72H/pull/6), merge `40c810ef93f0e5e95b49827a41466ca12eefeb1e`
- Preview evidence PR: [#7](https://github.com/jacksin2031/72H/pull/7), merge `8aba963f7d357ed46e973fbc2891f0f9dd7510b7`
- Image generated from immutable `git archive` of `0434633` (not from a mutable local worktree)
- Cloud Build ID: `f25de317-884b-4754-9837-1e93530d98eb` — **SUCCESS**
- Artifact Registry image: `asia-northeast1-docker.pkg.dev/h-japan/h72/72h@sha256:92ca90b8552681aacb70f56fbeec44d81cfb75ac0c283afb4217ca8d8f74ee12`
- Cloud Run project: `h-japan`
- Cloud Run service and region: `h72` / `asia-northeast1`
- New production revision: `h72-more-0434633`
- Former production revision, retained for rollback: `h72-ui-910c1d2`
- Official production URL: https://h72-vux6j7xjka-an.a.run.app/dashboard
- New More page: https://h72-vux6j7xjka-an.a.run.app/more

The production traffic target is a specific *existing, Ready* revision with a pinned container image digest. This release did not rebuild, mutate secret versions, change IAM/billing, or create a different service.

## Release authorization and stages

The user confirmed testing was done and explicitly authorized the production switch in the conversation. That is a report of user testing, **not independent evidence** of Android/iPhone, screen-reader or battery-measurement acceptance.

1. Verified baseline production: `h72-ui-910c1d2` received 100%.
2. Independently checked `h72-more-0434633`: Ready, ContainerHealthy, exact image digest matching Cloud Build `SUCCESS`.
3. Read-only preflight: official canonical, tagged new/old revisions, dashboard, More, Plan, API health, service worker. Old production's `/areas/manifest.json` was expected HTTP 404 (old version lacked nationwide N03 bundle); P1.2 manifest/catalog/worker all HTTP 200.
4. Staged canary switch: `h72-more-0434633=10`, `h72-ui-910c1d2=90`. Cloud Run reported successful routing.
5. Canary checks: canonical `/dashboard`, `/more`, `/plan`, `/api/health`, `/sw.js` each succeeded 3/3, **15 HTTP 200**. New revision still Ready/healthy. A Cloud Logging severity `ERROR` query for the new revision in the previous 10 minutes returned no records.
6. Full promotion: `h72-more-0434633=100`, former revision 0%. Cloud Run service status verified.
7. Post-promotion HTTP smoke: canonical `/dashboard`, `/more`, `/plan`, `/sources`, `/notifications`, `/api/health`, `/areas/manifest.json`, `/areas/catalog.json`, `/areas/worker.mjs`, `/sw.js` all 2/2 HTTP 200, **20 successful requests**. The new revision's 10-minute `ERROR` query returned no records.

A short clean log window is not proof of future zero errors. Longer-term monitoring remains an operational task.

## Actual production API and safety verification

Executed `python scripts/validate_p1_http.py --base-url https://h72-vux6j7xjka-an.a.run.app --output .work/p1-2-production-release` after the 100% switch.

Observed live (not synthetic):
- Official JMA source status: **STALE**.
- Official typed evidence items: **2**.
- Generated plans: **0**.
- Destination/designation candidates: **512**, not evidence of open or safe shelters.
- `movement_authorized=false`.
- No map mount authorization.
- Live/Replay isolation and fail-closed plan-action conditions checked by script.
- Route-provider candidate search: **NOT RUN**.

This demonstrates safe handling of *stale* live evidence only. It does **not** establish valid official movement guidance on a fresh positive-path event. Explicit invariants remain:
`GPS_UPDATED != SAFETY_VERIFIED`;
`NETWORK_RESTORED != VERIFICATION_RESTORED`;
`route candidate != safe route`;
stale evidence cannot authorize new high-risk movement.

## Canonical browser verification after promotion

Isolated headless Chrome against `https://h72-vux6j7xjka-an.a.run.app`, with emulated GPS at Tokyo Station, accuracy 20m:

- Initial mobile 390px: first-run GPS CTA and manual area fallback shown; no text input required.
- Clicked GPS CTA: confirmed timestamp and accuracy, bounded area `東京都` without invented finer municipality.
- Clicked `72Hを始める`: session started on the official canonical host.
- Mobile More: one GPS/location card and **four destination rows** (personal/family, display/accessibility, offline readiness, privacy).
- All four subviews opened and displayed their contextual controls/warnings. More showed no candidate route UI/Judge.
- 390px viewport: no horizontal overflow and no map mounted under stale official evidence.
- Offline browser network-emulation reload: cached More still rendered, visibly labelled offline with saved data, and no map; network emulation was restored.

The release smoke uses **emulated** browser GPS/network. Do not report it as independently observed physical device GPS, screen-reader software, battery discharge or OS background behavior. The user separately reported their tests complete; no physical test artifacts were collected during this release action.

## Rollback retained and command

The former revision `h72-ui-910c1d2` remained healthy and tagged at 0%, alongside prior P1.1 and P1 revisions. If rollback becomes necessary, use the authorized Cloud Run service credentials:

```sh
gcloud run services update-traffic h72 \
  --project=h-japan \
  --region=asia-northeast1 \
  --to-revisions=h72-ui-910c1d2=100
```

Then verify `gcloud run services describe h72`, the canonical HTTP endpoints and expected older revision behavior. This is a **documented procedure**, not a command executed as part of this release.

## Residual considerations

- A user with the previously installed PWA or service worker may still display an old cached shell until normal reload/update; diagnose using fresh browser navigation or the service worker update lifecycle. Do not claim that GitHub merging alone updates caches.
- The local P1.2 validation report notes a minor existing localization/reconnect callback closure observation, not a release blocker in the independently observed production smoke; investigate on reproduction.
- Screen-reader access, iOS Safari behavior and endurance are not independently reproduced in these Cloud Run release checks. Maintain these as ongoing coverage despite the user's report of completing tests.
- Monitor production error-rate, latency, Cloud Run instance health, official-source freshness, and user-reported issues after release.
- No further traffic operations were performed after successful 100% promotion.

Related records: [P1.2 local acceptance](VNEXT_P1_2_VALIDATION.md), [P1.2 Cloud Preview](VNEXT_P1_2_CLOUD_PREVIEW.md).
