# P2.3 — Nationwide map readability and safety disclosure

Date: 2026-10-11 JST
Branch: `codex/ui-map-readability-p2-3` (based on `bfb2574`)

## User-visible changes
- Enlarged visual distinction between land and sea while retaining a restrained dark theme:
  * Offline / nationwide background ocean: `#0c2535` (navy).
  * Natural Earth land: `#35574e` (green).
  * Coastline: `#aad2c5`.
  * Legend swatches match the rendered layers.
- Removed full-length map disclaimer from the permanently visible bottom map information overlay.
- A short, always-visible warning now states that coastlines are **not tsunami inundation boundaries and cannot authorize evacuation navigation**.
- A native expandable details section contains the **full warning** (including simulated earthquake ripple limitations), supporting map metadata and official source attribution. Source links remain visible without opening the details.
- Map rendering, safety model, historic epicenter coordinates, permission flow, and official tile fetch are unchanged.

## Validation
- Direct current public Preview `japanui-bfb2574`: `/map`, `/disaster-test`, `/simulation`, GSI PNG tile, national land GeoJSON all returned HTTP 200; out-of-region tile returned 404. This establishes baseline health, not new release acceptance.
- P2.3 local mobile Chromium through Chrome DevTools Protocol:
  * 360px: viewport/document widths 360/360; verified WebGL canvas. Collapsed bottom information 124px, expanded details ~217px.
  * 320px: viewport/document widths 320/320; verified WebGL canvas. Collapsed bottom information 117px, expanded details ~209px.
  * Full details toggle opens and recloses without horizontal overflow. Legend and always-visible safety warning both present.
  * Source colors measured in the browser: sea rgb(12,37,53), land rgb(53,87,78).
- Frontend Vitest: 286 pass; 3 existing skipped. Backend pytest: 150 pass, existing Starlette testclient deprecation warning only.
- TypeScript, optimized Next production build, secret scanner, whitespace check: PASS.

## Safety / deployment
This is presentation-only. Nothing certifies safety from earthquakes or tsunamis. Municipal inundation datasets, real-time official warnings, verified shelters and route viability are still missing.
Previous latest Preview: `h72-japanui-bfb2574` on 0% traffic; production `h72-more-0434633` remains 100%.
Cloud deployment for this new source and physical-device acceptance must be tracked separately. No commit should include the Next.js-generated local `apps/web/next-env.d.ts` mode-specific path change.
