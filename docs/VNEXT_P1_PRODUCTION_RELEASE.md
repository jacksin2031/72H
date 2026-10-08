# vNext P1 production acceptance — 2026-10-07 JST

This is the historical October 7 P1 acceptance. The October 8 first-use UI
follow-up is now deployed as `h72-ui-910c1d2` at 100% traffic. See
[current runtime and acceptance](VNEXT_FIRST_USE_POLISH.md). Values below describe
the accepted prior P1 revision, which remains available for rollback.

Status: **COMPLETE for the bounded P1 implementation and release acceptance.**
GitHub synchronization is separately BLOCKED: the configured `jacksin2031/72H`
remote returns repository not found. No remote, credentials, original checkout
or `main` was changed to work around it. Runtime source is the immutable local
release commit on `codex/vnext-p1`; do not claim remote/main integration.

Public application: https://h72-vux6j7xjka-an.a.run.app/dashboard

## Runtime identity

| Item | Verified value |
|---|---|
| Source | `b6950fbbf7c6b49a3bad5d34e136eb5f5474499d` |
| Git archive SHA-256 | `806e77b8c6eba55e591a2aed53b7c91ceb4d37ca97d62024c84445ccfcbd017c` |
| Cloud Build | `571d13d2-7627-498f-a63c-c917c60122f9`, SUCCESS |
| Cloud project / region | `h-japan` / `asia-northeast1` |
| Cloud Run service / revision | `h72` / `h72-p1-b6950fb` |
| Image digest | `sha256:94f200eefc32d7db207dce9be29c17c8c969bdb14ffdae5b894fab3be023eeac` |
| Web build | `wHaTRC-Fo5O2h8pG2LHIr` |
| Production traffic | P1 revision 100%; former P0 revision 0%, retained |
| Runtime identity | `h72-runtime@h-japan.iam.gserviceaccount.com` |
| Existing secret reference | `h72-ekispert-api-key:2`, backend only |
| Existing controls | max 1 instance, CPU 1, memory 1 GiB, concurrency 8, timeout 60 s |

Deployment used a clean `git archive` of the reviewed commit, Cloud Build and
the digest-pinned image with `--no-traffic`. The existing public invoker IAM,
Gemini mode and service configuration were preserved. The public preview at
`https://p1-b6950fb---h72-vux6j7xjka-an.a.run.app` passed before promotion.
The existing project-scoped JPY 5,000 budget with 50/80/100% alerts was inspected;
these are alerts, not a spending cap.

## Acceptance

- Frozen backend 103/103; frontend 148/148, integrated TypeScript and optimized
  build; secret and staged whitespace checks PASS. All 148 frontend tests also
  pass against fresh deployed preview Replay and Live response captures.
- Preview and canonical API Replay each complete 11 events and immutable plans
  1–4 through actual Gemini/ADK: four `GEMINI_CANDIDATE_APPLIED`, zero fallback,
  final `COMPLETED / ONLINE_VERIFIED`.
- Actual deployed JMA report enters typed non-synthetic evidence. At canonical
  check `2026-10-07T14:05:50Z`, publication 16:05 JST is correctly STALE, with
  zero Tokyo plans, 512 catalog designations and movement authorization false.
- Actual preview/canonical Ekispert searches normalize supplied station geometry
  as CANDIDATE, never as walking roads, route safety or evacuation permission.
  Main's browser preview renders the road base map, numbered station sequence
  and destination, with the explicit candidate warning.
- Eight HTML routes, 23 static assets, service worker and map-pack hashes pass.
  Preview/canonical worker SHA-256 is identical:
  `34f5903a7facafef0a6752cd1d7b26459893d02550698898db2e33dab74d9435`.
- Main's restored In-app Browser checks new preview/canonical origins at mobile
  390×844 and desktop 1280×900. Live MONITOR is compact and text-first; PC shows
  preparedness/status, official timestamps and plan review. Public handoff URLs
  contain language only, without session, location, evidence or plan payloads.
- Genuine preview browser network loss plus reload retains interactive Live PC
  and nonempty synthetic Replay Plan v2. After physical restoration, events 4–9
  remain RECONNECTING; fresh official/transport evidence at event 10 restores
  ONLINE_VERIFIED. All 11 GUI events and four plan-history versions are inspected.
- Canonical mobile network loss plus reload retains the cached Live profile,
  visible age/expiry and interactive details dialog. Restoring network correctly
  remains RECONNECTING for the stale Live publication. No high-risk action/map
  is authorized. Browser network emulation and viewport overrides are restored.
- Local keyboard/focus, contrast, overflow, power, map expiry/unmount, Safety
  Check and route wording checks pass; details are in the local acceptance ledger.

Ignored evidence is under `.work/p1/cloud-preview-*`, `.work/p1/cloud-production-*`
and `.work/p1/gui-20261007/`. Runtime build differs from the Windows local build
ID; evidence is tied to each build rather than conflating the two.

## Limits and rollback

Current shelter opening, hazard suitability, official movement directives and
road-safety production allowlists remain empty. Spatial positives are verified
with explicit configured test sources; actual current Live critical alerts and
authorized evacuation were unavailable during this acceptance window. No source
times or scopes were fabricated to produce a positive. See the source boundary
document and deterministic tests. Physical GPS, battery endurance, Push, Rescue
Beacon and native background operation are not claimed. Hackathon submission
assets/process and remote Git integration are separate pending work.

Rollback remains the accepted P0 `h72-vnext-8d1836e`, digest
`sha256:9d7e22b877aff64502903cfe90b233c8365a8df065e8e3b75fee5bcda6eb3005`.
Use the existing service without changing IAM or credentials:

```powershell
gcloud run services update-traffic h72 --project h-japan --region asia-northeast1 --to-revisions=h72-vnext-8d1836e=100
```

This rollback command is documented, not executed during P1 acceptance.
