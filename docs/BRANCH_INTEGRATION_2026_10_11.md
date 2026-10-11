# 72H branch consolidation — 2026-10-11 JST

Scope: integrate every discovered local branch and current GitHub remote branch
into `codex/integrate-all-branches`, then merge the validated result into `main`.
Original feature branches, accepted release revisions and existing stashes are
retained. This is source integration, not a Cloud Run deployment or promotion.

## Source audit and conflict resolution

The initial checkout was clean at `4afd50f` on
`codex/p2-4-official-tsunami-shelters`. There were 24 local branches. Twenty-three
were already ancestors of that source; only `codex/adaptive-ui` (`4b0a411`)
had an unmerged commit. Remote fetch initially failed because GitHub CLI's
active account was a different existing login. A command-scoped use of the
already-authenticated repository owner `jacksin2031` succeeded without changing
the global active account or storing credentials in files. Fresh remote `main`
was `115ece3` (PR #9), with one additional merge commit and no new application
diff relative to the already-integrated P1.3 feature.

`36d29d8` merges the adaptive milestone; `72f92bf` merges fresh remote main.
The 13 conflicts were resolved against the later P1/P2.4 implementation after
comparing the original branch behavior. In particular, the older adaptive
movement policy omitted route availability, route-presentation, geometry and
map-mount gates; restoring it would weaken the current safety contract. The
current policy, accessible details dialog, location provenance, standalone
reference map and independent public hazard cache are retained. Theme and
notification functionality are already carried forward; no independent missing
feature was identified. The old Replay-only map button is superseded by the
current gated consumer map and separately labeled reference map.

Both adaptive specification/validation documents are retained with explicit
historical banners. Their former test counts and on-demand-map behavior do not
become current acceptance or override current product/contracts. The existing
P1 product specification's accepted status is preserved.

Application, service, contract and build-script trees are byte-identical to
`4afd50f`: `git diff 4afd50f HEAD -- apps/web services packages scripts` is empty.
The integration adds historical documents and the integration ledger, and
updates README/current-phase links only. Existing P2.4 limitations remain:
Ishinomaki pilot coverage is PARTIAL; designation is not current opening or
route safety; every local hazard query has false safety/movement authority.

## Branch coverage

All initial local branch tips are ancestors of the integration result:

| Branch | Audited source tip |
| --- | --- |
| main | `80b919d` |
| codex/hackathon-mvp | `da4740f` |
| codex/vnext-p0 | `80b919d` |
| codex/adaptive-ui | `4b0a411` |
| codex/vnext-p1 | `6eeba78` |
| codex/vnext-p1-1-accessible-gps | `4de08c0` |
| codex/p1-1-cloud-preview | `2181bc3` |
| codex/p1-1-preview-ledger | `7747b2b` |
| codex/vnext-p1-2-simplified-more | `0434633` |
| codex/p1-2-preview-ledger | `6432c71` |
| codex/p1-2-production-ledger | `40e859e` |
| codex/vnext-p1-3-one-screen | `4f0db76` |
| codex/p1-4-disaster-test | `9e8a535` |
| codex/p1-5-agent-drill | `565807a` |
| codex/p1-6-mock-live-adapter | `3755563` |
| codex/p1-7-historical-drills | `3dd1e3b` |
| codex/p1-8-immersive-simulation | `e0ce792` |
| codex/p1-9-map-led-flat-ui | `55cf268` |
| codex/p2-0-hazard-aware-geospatial | `56df219` |
| codex/p2-1-expanded-map-dark-ui | `be76999` |
| codex/p2-2-japan-map-land-sea | `b80c808` |
| codex/ui-map-polish | `bfb2574` |
| codex/ui-map-readability-p2-3 | `767c676` |
| codex/p2-4-official-tsunami-shelters | `4afd50f` |

Fresh remote main `115ece3` and all nine remote feature tips are also ancestors.
Coverage is checked with `git merge-base --is-ancestor <ref> HEAD`, not inferred
from matching branch names. Existing detached worktrees and stashes contain
historical/draft state, not additional branch tips; they are preserved rather
than imported blindly.

## Local validation

- Frontend: 311 PASS / 3 pre-existing P0 fixture tests SKIPPED, 46 passing files.
- Backend: 178 collected tests, full run PASS; existing Starlette/httpx
  deprecation warning retained.
- TypeScript: `tsc --noEmit` PASS.
- Optimized Next build: PASS, 13 static pages and 32 offline assets. The build
  verifies the actual manifest and every official hazard asset hash. Local
  build ID: `IUKvlmkfRW2Zn-P7206vv`.
- Secret-pattern/credential-file scan and whitespace/conflict-marker checks:
  PASS before publishing the integration result.
- Independent Luna Max review: current safety gates must take precedence over
  the obsolete policy; no missing branch-only theme/notification feature found.
  Application tree equality independently confirmed.

Current application browser/offline/GPS evidence is the exact unchanged source
in `VNEXT_P2_4_VALIDATION.md`; historical adaptive acceptance is not substituted.
Local `next start` fallback runtime remains separate from Windows standalone,
real-device GPS, live disaster acceptance and Cloud Run release validation.

## Main checkout preservation and remote gate

The primary `main` checkout initially had two untracked specification drafts:
`docs/VNEXT_ADAPTIVE_UI_UPDATE_SPEC.md` and
`docs/VNEXT_P1_LIVE_ROUTE_DEVICE_ROLES.md`. Both were preserved in the named Git
stash `72H preserve main specification drafts before all-branch integration
2026-10-11`, object `ad233d282b744bd774b4adb7704275224dc5b15b`, before updating
that checkout. The integrated tree tracks those names; the untracked originals
remain recoverable from the stash's untracked-files parent. All original feature
branches remain recoverable.

The GitHub workflow contains validation only (tests, secrets, typecheck/build),
with no deployment job. The integration PR must pass that CI before merge;
remote main and the primary checkout must then contain every audited branch
tip. Release traffic remains outside this integration.
