# P1.9 Preview acceptance

2026-10-10 JST. Outcome: Cloud Preview PASS. Production HOLD.

Source commit: 79262a0f1420f53146fd6eee61aa10712e5ab45a
Build: 495f8e00-1557-4bbd-a4e3-13b1fdd23f02, SUCCESS
Image: sha256:7b3fc8e1d92c4f6e8b589e50a1c3ca5db0ec9efbc7804f26e65f72579b0ea0ba
Cloud Run revision: h72-map-79262a0
Preview URL: https://map-79262a0---h72-vux6j7xjka-an.a.run.app/disaster-test

Cloud service h72 in h-japan / asia-northeast1:
- Before Preview deploy: production h72-more-0434633 had 100% traffic.
- After Preview deploy: production h72-more-0434633 had 100% traffic.
- Tagged Preview h72-map-79262a0 has 0% traffic.

Verified physical Android Chrome (ASUS_AI2201_A; viewport 411 CSS px) against the actual Preview URL:
- /disaster-test to /simulation via client navigation: PASS.
- 311 accelerated clock 600x pre-event: no early Mock Live request.
- First request around 6148ms after launching, at simulated earthquake boundary.
- Actual Gemini / ADK response provided NOW action, with NEXT / AVOID in same view.
- OSM offline road reference became READY and rendered map tiles from integrity-verified local assets.
- Plan, Timeline, full-screen Map (including zoom controls), Settings: PASS.
- End simulation returned to setup, without persisting the exercise credential.
- No horizontal overflow at 411 CSS px.
- Reference map has no unverifiable hazard polygons, user position, shelters or safe-route navigation.

Test status at commit: 255 frontend Vitest passing, 3 pre-existing skipped; 150 backend pytest passing; Next production build PASS; TypeScript PASS; secret scan PASS.

Safety limitations: tsunami and outage are still context only, not typed Safety Core hazards; mapped Tokyo road data is reference-only and unrelated to the 311 epicenter; it does not authorize movement. No merge, push or production promotion.
