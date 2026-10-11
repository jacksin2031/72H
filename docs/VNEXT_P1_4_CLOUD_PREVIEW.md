# P1.4 — Cloud Preview Acceptance (0% production traffic)

Date: 2026-10-10 JST
Status: PREVIEW ACCEPTANCE PASS; PRODUCTION RELEASE HOLD

## Immutable release identity

- Runtime source: `71b7130e77d6f41af822540dbf0fade2dadad030`.
- Cloud Build ID: `259cf9cb-d0ed-466e-a018-be7e39834dae` — SUCCESS.
- Immutable image: `asia-northeast1-docker.pkg.dev/h-japan/h72/72h@sha256:72ca21453806a267b3fbb00c16950326dd42f6f64014a8d732b508b11d9c560c`.
- Cloud Run project `h-japan`, region `asia-northeast1`, service `h72`.
- Preview revision: `h72-lab-71b7130`; tagged `lab-71b7130`.
- Preview URL: https://lab-71b7130---h72-vux6j7xjka-an.a.run.app/disaster-test
- Preview revision Ready=True and ContainerHealthy=True.
- Production P1.2 revision `h72-more-0434633` remains **100% traffic**.
- P1.3 `h72-one-4f0db76` remains a separate 0%-traffic tagged revision.
- No production routing or domain promotion was performed.

## Cloud acceptance

- HTTP 200: `/disaster-test`, `/dashboard`, `/more`, `/plan`, `/api/health`, `/sw.js` (6/6).
- Live API conservative check: JMA source STALE; 4 official typed evidence records; 0 plans; 512 designation candidates, no movement authorization; provider route search NOT RUN.
- Live/Replay store separation and fail-closed safety assertions passed through `validate_p1_http.py`.
- Source test route remains separate from Live API; all scenario controls are client-local synthetic state.

## Physical Android cloud smoke

- Real ASUS_AI2201_A Android 12 Chrome through ADB, actual HTTPS Preview origin (not emulated browser GPS).
- CSS viewport 411×830, no horizontal overflow at standard size or 200% browser zoom.
- L2/60% displays NORMAL. Critical/offline L4/10% displays EMERGENCY_POWER and mock Safety Check.
- Tsunami L4/3% displays SURVIVAL. Reset restores defaults. No telephone anchors.
- Fresh browser Preview `/more` without initialized session retains collapsed diagnostics entry pointing to `/disaster-test`; no horizontal overflow.
- Japanese, English and Traditional Chinese switch on the physical device (initially validated against identical local build source).
- OS font scaling, actual TalkBack/VoiceOver narration, physical low battery, real network disruption and iOS remain unverified. The screen is **not** real emergency guidance.

## Production gate

P1.4 remains Preview-only. Do not switch production traffic until real-device accessibility, critical-path UX and release approval are separately completed.
