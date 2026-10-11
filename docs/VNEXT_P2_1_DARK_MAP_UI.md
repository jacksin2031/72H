# P2.1 — Larger maps & consistent dark UI

Date: 2026-10-10 JST
Branch: `codex/p2-1-expanded-map-dark-ui`
Release: cloud tagged Preview only; Production HOLD.

## Why

P2.0's full map had a white risk panel up to 54dvh tall, hiding much of the usable map area. White floating navigation and map zoom buttons were inconsistent with the dark 72H simulation shell. The events tab also retained a large white surface and had a small ~145px preview map.

## Changes

- Full-screen map is now the default focus. Risk assessment is collapsed at entry into a bottom 105px summary overlay, keeping approximately 85% of the 695px CSS full-map region visible on tested Android.
- The collapsed panel still clearly says **Safety: undetermined / no verified shelter or route**. An actually played tsunami warning remains visible in this collapsed state.
- One tap expands risk details, opt-in GPS, distance, accuracy, tsunami uncertainty and official source links; another tap collapses them. Accessibility: labelled native button, `aria-expanded`, `aria-controls`, 44+px tap targets.
- Maps and overlays consistently use dark forest background, dark translucent back/zoom buttons and amber uncertainty labels. The events timeline has a dark list instead of a white surface.
- Home map takes an increased portion of the viewport. The events map preview is enlarged to at least 200px (31dvh preferred). Full map supports intentional pan/pinch zoom; compact maps remain passive.
- Original geospatial hazard model, mock Live event clock, GPS permission, 2-minute location TTL, and strict no-evacuation-authorization posture are unchanged.
- CSS import ordering was corrected so the new theme overrides legacy P1.9 white styles *in the actual browser bundle*, not merely in source code.

## Validation

- Android ASUS_AI2201_A Chrome 411px width real layout measurements: full map 695.48px CSS height, collapsed risk sheet 104.71px, 84.94% of map unobscured. No horizontal overflow.
- Real computed styles: full-map back button rgba(17,40,34,.91), map title rgba(17,40,34,.91), zoom controls rgba(17,43,37,.91), bottom risk surface rgba(16,31,29,.96), GPS button rgb(34,80,58). All dark rather than white.
- End-to-end synthetic drill: pre-event wait without an API request, first earthquake at virtual boundary, real Gemini / ADK NOW, map, expanded GPS/risk panel with fake Tokyo latitude 35.6895 / longitude 139.6917 (+/-18m), 389.1km epicentral distance, collapse back to enlarged map, and safe end. PASS.
- Frontend suite: 269 PASS / 3 existing SKIP; backend: 150 PASS; TS and Next build PASS; secret scan PASS.
- Production promotion, merge and GitHub push intentionally excluded.
