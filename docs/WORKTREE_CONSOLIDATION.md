# 72H worktree consolidation

Canonical development branch: **codex/hackathon-mvp**.
Release integration target: local **main**. Remote push/public release is separate.

The main checkout, `6545` and detached `b25f` all started from documentation
commit `80b01e3`. Both implementation worktrees had uncommitted independent
application skeletons. The selected skeleton is the tested Next.js/npm frontend,
Python 3.11 `services/agent-api`, immutable contracts and deterministic Safety
Core in `codex/hackathon-mvp`.

## Migration scope

| Source in b25f | Canonical destination / decision |
|---|---|
| `services/api/src/app/mobility/ekispert_mcp.py` | Adapt to `services/agent-api/agent_api/mobility/ekispert_mcp.py` and installed MCP 1.x. Do not import a second backend or MCP 2.x graph. |
| `scripts/smoke-ekispert-mcp.py` | Correct canonical import; names-only connectivity check. |
| `scripts/set-ekispert-key.ps1` | Retain local Windows key helper; never execute automatically or store a key in Git. |
| `.codex/skills/**` | Preserve both Hackathon skills and references; refresh the office-hours date from the official page and flag an unconfirmed old summit entry. |
| `.ai/PROJECT.md`, `.ai/RULES.md`, `AGENTS.md` | Preserve mobility-provider/data-only/secret constraints. |
| `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md` | Preserve Ekispert design additions; identify current adapter vs future live normalization. |
| `.ai/CURRENT_PHASE.md` | Incorporate provider requirement while retaining newer Phase 2/3 evidence. |
| b25f frontend, contracts, replay engine and pnpm scaffold | Keep as historical source only. The tested canonical application remains the single implementation. |

The 16 modified/untracked files in the existing main checkout were inspected;
its Ekispert documents, skills and key helper matched b25f. Preserve the original
main changes in a named Git stash before the fast-forward merge. Keep this stash
as a recoverable record; do not apply the older phase document over current code.
Do not archive or delete b25f during consolidation.

## Integration gate

1. Existing backend safety/replay and Gemini planner tests remain green.
2. New Ekispert tests pass without requiring a private key or live service.
3. Frontend tests, actual API snapshot contract, typecheck and build pass.
4. Independently review credential handling and mobility/safety boundaries.
5. Secret-pattern and whitespace checks pass.
6. Commit the canonical tree; fast-forward local main to that same commit.
7. Verify both branch HEADs and main's clean status. Export Cloud Shell source
   from the consolidated commit, not any of the earlier divergent worktrees.

Live Gemini, Ekispert connectivity and Cloud Run are separate acceptance items.
No synthetic/fake-provider test may be presented as successful external execution.

Accepted local gate: 51 backend tests (API 7, domain 22, Gemini planner 11,
Ekispert 11), 18 frontend tests including the actual API snapshot, typecheck,
production build and secret/whitespace checks. Independent final re-review found
no remaining P1/P2 blocker and repeated the backend suite and SDK redirect check.
