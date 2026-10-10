# P2.3 nationwide map — Cloud Preview acceptance

Date: 2026-10-11 JST | PREVIEW PASS / PRODUCTION HOLD

## Immutable deployment
- Deployed application source: b2a844f2c3551542a9509deefed2fcfe604b7645.
- Cloud Build b010fc5d-5fd5-4b5b-bf1e-aa4d9e63fa79 SUCCESS.
- Image digest sha256:0d20cdce7da4af2bec4c6cc1f4dc2cf5120273a2e471a45a2f5ad54f9ec38a9b.
- Cloud Run service h72, project h-japan, region asia-northeast1.
- Preview revision h72-mapread-b2a844f, 0% production traffic.
- URL: https://mapread-b2a844f---h72-vux6j7xjka-an.a.run.app/map
- Production h72-more-0434633: 100% traffic verified before and after Preview deployment.

## Cloud HTTP and real browser validation
- HTTP 200: /map, /disaster-test, /maps/japan-land-50m.geojson (284073 bytes), /api/reference-tiles/6/56/25 (PNG, 83492 bytes).
- Invalid tile /api/reference-tiles/17/0/0: HTTP 404.
- Chrome mobile viewport 360px, real Cloud: visible WebGL map, document width 360px, information sheet collapsed 124px; native details expand to about 217px. PASS.
- Chrome mobile viewport 320px, real Cloud: visible WebGL map, document width 320px, information sheet collapsed 117px; native details expand to about 209px. PASS.
- Computed sea rgb(12,37,53), land rgb(53,87,78); country legend, persistent safety caution and GSI / Natural Earth source links remain visible. PASS.
- Local screenshot evidence: .work/p23-cloud-map-mobile.png and .work/p23-cloud-map-320.png.
- Frontend 286 PASS, 3 existing SKIP; backend 150 PASS; TypeScript, Next production build, credential scan, git diff --check PASS.

## Limits
- Browser mobile viewport checks are not actual physical-device GPS/iOS/Safari or screen-reader acceptance.
- No real hazard-specific inundation, official evacuation orders, verified shelters or safe-route authorization was added.
- Historical quake ripples are visual illustrations only.
- No main merge, GitHub push or production promotion.