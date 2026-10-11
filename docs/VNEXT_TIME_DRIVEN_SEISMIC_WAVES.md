# Time-driven seismic wavefronts — local implementation

Authorized by the 2026-10-11 request to replace repeating earthquake ripples
with waves that advance according to earthquake time.

## Behaviour and model boundary

- Removed the repeating, pixel-sized epicentre CSS ripple. The historical
  simulation clock now determines the geographic P/S wavefront every 200 ms.
- Origin time and depth are inputs to a homogeneous point-source model. An
  expanding 3-D wave sphere intersects the spherical Earth surface; geodesic
  circles are rendered as MapLibre line geometry, so zoom changes do not change
  physical distance. Date-line crossings are split into separate line segments.
- Approximate constant speeds: P 7 km/s; S 4 km/s, from
  [JMA's explanation](https://www.jma.go.jp/jma/kishou/know/jishin/eew/shikumi/shikumi.html).
  These are educational estimates, **not measured waveforms**, a layered JMA
  travel-time calculation, rupture propagation, intensity or hazard boundaries.
- No surface wavefront before origin time or before propagation from the source
  depth reaches the surface. Wavefronts pass once and are removed after leaving
  the declared Japan reference coverage. They do not restart on scene remount.
- The UI clock includes seconds. Finite visual clock continuation after the
  final evaluated event allows its wavefront to finish; this creates no new
  evidence, AI calls, plan versions, movement permission or API event dispatch.
  FAST_RANGE still jumps over unselected historical intervals.
- Missing origin metadata means no inferred wavefront. Custom events and the
  undocumented Noto aftershock have no substitute mainshock waves. Independent
  known Kumamoto shocks retain their respective origins.

## 311 provenance

[JMA's March 2011 bulletin, printed p.60](https://ds.data.jma.go.jp/eqev/data/gaikyo/monthly/201103/monthly201103.pdf)
provides the mainshock origin 14:46:18.1 JST, 38°06.2′N / 142°51.6′E,
depth 24 km, and the Ibaraki aftershock origin 15:15:34.4 JST,
36°06.5′N / 141°15.9′E, depth 43 km. Minute-level exercise milestones remain
unchanged; wave calculations use these more precise origin times. The existing
exercise's M7.6 label is preserved rather than rewriting historical catalogue
magnitude reporting in this presentation change.

The new wave origins remain frontend reference inputs, separate from the real
evidence / Gemini / Safety Core pipeline. Tsunami entries remain historical
context; these waves cannot certify locations, shelters or routes.

## Validation

- Frontend suite: 319 passed, 3 existing fixture skips. Typecheck and Next.js
  production build passed. Secret check and `git diff --check` passed.
- Deterministic tests cover exact origin/depth gates, P ahead of S, kilometres,
  geodesic distance, date-line splitting, time jumps/rewind, expiry, separate
  aftershock origins, unknown inputs and map remount without replay.
- Fake-clock component acceptance proves finite clock continuation after event
  evaluation, no further API requests, expiry and timer cleanup on unmount.
- Browser acceptance passed on local production build `dpTHz_xRtbBrJ6i-nao1i`
  at `http://127.0.0.1:3012/simulation`. Full 311 FAST_RANGE processing finished
  all four milestones. Actual Gemini/ADK execution remained separate from wave
  display; no safe destination, route or movement permission was created.
- At 15:16:12.214 JST the aftershock P/S radii were 262.086 / 145.510 km;
  at 15:16:53.616 they were 554.893 / 315.030 km. After switching Home → Map
  and zooming out, the clock was 15:16:55.209 and radii 566.126 / 321.484 km,
  proving the wave did not restart or inherit pixel animation scale.
- The clock, P/S estimate labels and source limits are visible. Epicentre focus
  keeps its marker above the information card. Browser screenshots and metric
  JSON are saved under ignored `output/playwright/seismic-wave-*-20261011.*`.

Local implementation only. No Preview or production deployment is claimed.
Measured or geographically heterogeneous propagation remains unimplemented.
