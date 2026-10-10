# UI and map polish — local validation

Date: 2026-10-10. Branch: `codex/ui-map-polish`, based on `847b29b`.

## Changes

- Fixed-size SVG icons replace emoji/font symbols in notifications, warning controls, mobile navigation, dialog close and More links. Text wraps without displacing icons.
- Offline maps use muted dark roads, separate land/sea fills and a contrasting coastline. Compact geographic markers retain accessible labels; the reference list carries full names. Overlapping markers yield to device/origin markers and map controls.
- Resize refits the downloaded extent. A dashed extent boundary and neutral outside surface distinguish missing coverage from sea.
- The earthquake event panel shows expanding rings and the event time. It explicitly describes an illustration, not an epicentre or shaking extent. Battery conservation and `prefers-reduced-motion` stop the animation.
- The Demo map toggle exposes the same reference map for inspection. Live movement eligibility, source freshness and Safety Core gates are unchanged.

## Geography provenance and offline behaviour

`scripts/build_map_geography.py` builds the bundled geography from the existing verified MLIT N03 2026 municipality shards. It unions intersecting municipality land before clipping to the installed Tokyo map extent and derives boundary lines without adding rectangle edges as coastlines. N03 boundaries are a static reference, including waterfront/river boundaries; they are not real-time hazard data.

The optional builder requires Python and Shapely 2.x; runtime uses the bundled asset only. The manifest records source URLs, attribution, source/catalog hashes and the asset SHA-256. Assets are bounded, hash checked, schema checked and precached. Missing or invalid geography falls back to neutral reference roads with a visible message.

## Validation

- Frontend: **239/239 tests**, 32 files, using the generated real replay state fixture (`.work/p0-api-states.json`). Includes geometry integrity/rejection, event illustration and existing GPS watch stability coverage.
- TypeScript: `tsc --noEmit` passed.
- Production build: `node scripts/build.mjs` passed; offline shell prepared 23 static assets.
- Local development browser: 320px and 390px mobile, plus desktop; no horizontal overflow. Mobile navigation SVGs all measured 24 × 24 at the same vertical position. Map markers did not overlap each other or zoom controls. Verified reduced-motion and conservation modes disable animation.
- Screenshots: `output/playwright/ui-map-polish/{desktop,mobile,mobile-icons}.png` (local, ignored).
- Diff whitespace and secret-pattern inspection passed.

No deployment or real-device acceptance was performed. Windows standalone startup hit a pnpm/React symlink `EPERM`; production runtime acceptance remains unverified. Browser checks used the local development server.
