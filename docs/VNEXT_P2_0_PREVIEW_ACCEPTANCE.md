# P2.0 cloud and phone acceptance

2026-10-10 JST. Status: **PREVIEW PASS; PRODUCTION HOLD**.

Source commit: 6d6ced06fea8f74f57aadc7e4d19c9d587489131
Cloud Build: b6683a7e-1908-4a2b-916f-8ad457d02a03 SUCCESS
Immutable container digest: sha256:4b490405d0f5385b8532a925b69b785b0f2867964eb4cca907e765dbbf4a4d64
Cloud Run service: h72, project h-japan, region asia-northeast1
Tagged revision: h72-risk-6d6ced0
Preview URL: https://risk-6d6ced0---h72-vux6j7xjka-an.a.run.app/disaster-test
Production traffic before deployment: h72-more-0434633 100%
Production traffic after deployment: h72-more-0434633 100%
New Preview traffic: 0%

## Local acceptance
- Frontend Vitest 267 PASS, 3 existing SKIP.
- Backend pytest 150 PASS (one Starlette deprecation warning).
- Next optimized production build PASS; TypeScript PASS; repository secret scan PASS.
- 311 FAST_RANGE 14:46–14:49 physical Android test: two historical milestones, simulated tsunami warning activated only after the second milestone, retained risk UNKNOWN.

## Cloud Preview acceptance: physical Android ASUS_AI2201_A Chrome, CSS viewport 411px
- From /disaster-test enter separate /simulation screen: PASS.
- 311 historical accelerated 600x prelude, 0 premature Mock Live requests: PASS.
- First Mock Live start observed after about 6128ms at historical earthquake boundary: PASS.
- Real cloud Gemini / ADK planning returned synthetic NOW/NEXT/AVOID: PASS.
- Three map views and full map rendered prevalidated Tokyo OSM road pack: PASS.
- In CDP *simulated* geolocation override (not real device GPS), position latitude 35.6895, longitude 139.6917, accuracy 18m. User-initiated one-shot location request returned 389.1km great-circle distance to the historical 311 epicenter: PASS.
- Map correctly indicates that the historical epicenter is outside the central Tokyo reference map bounds.
- Earthquake and tsunami safety verdicts remain UNDETERMINED, no evacuation candidates or route authorizations.
- Plan / Timeline / Full map / Settings, clear transient access key when exiting, no horizontal overflow: PASS.

## Release boundary

This release supports only synthetic historical exercises. It does not classify any location as safe, cannot estimate observed local intensity or inundation depth, and does not substitute for live JMA alerts or municipal evacuation instructions. Official GSI designated earthquake/tsunami emergency shelter GeoJSON tiles are identified as candidate sources for a future independently reviewed ingestion stage, but opening status, hazard-specific suitability and traversable route safety are not connected. No push, merge or production promotion performed.
