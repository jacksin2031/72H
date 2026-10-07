# P1 source provenance and capability boundaries

Checked on 2026-10-06 JST. Runtime acceptance is recorded separately in
[VNEXT_P1_VALIDATION.md](VNEXT_P1_VALIDATION.md).

## JMA

- [Official developer portal](https://www.data.jma.go.jp/developer/index.html)
- [Earthquake/volcano XML Atom feed](https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml)
- [JMA website usage terms](https://www.jma.go.jp/jma/kishou/info/coment.html)
- [Developer usage notes](https://www.data.jma.go.jp/developer/ryuui.pdf)

JMA's current website terms refer to the Public Data License 1.0 unless a
separate rights notice applies. They require source attribution and disclosure
of editing/processing. 72H must identify normalized summaries and plans as its
own processing of JMA information; they are not JMA-issued evacuation orders.
Do not reuse excluded logos or third-party content under a blanket assumption.

Feed retrieval and successful parsing establish access to an official record,
not current safety at the user's location. Preserve the official publication
timestamp and detail URL. Exact parsed geographic scope, deterministic TTL and
conflict checks remain necessary before a claim can influence an action. An
HTTP 304, empty feed or new retrieval time cannot renew an old record's TTL.

## Tokyo designation catalog

- [Official dataset description and attribution requirement](https://portal.data.metro.tokyo.lg.jp/page/5/)
- [Tokyo emergency map](https://map.bosai.metro.tokyo.lg.jp/index.html)
- [Evacuation-place CSV](https://www.opendata.metro.tokyo.lg.jp/soumu/130001_evacuation_area.csv)

The official description says the data generally uses 2021-04-01 as its basis.
This is the catalog's basis date, not a newly published shelter-opening report.
Attribute it as Tokyo's shelter/evacuation-place open data. 72H normalizes
designation locations; current opening, capacity and hazard eligibility remain
UNKNOWN. Download time cannot make these facts current or authorize movement.

## Other sources

Source priority in the P1 specification does not establish access rights,
current shelter opening status, disaster-safety verdicts or offline licensing.
Each enabled adapter needs its own source/terms provenance and acceptance
evidence. GSI/MLIT map geography and municipal facility locations do not alone
establish an eligible destination or route. JARTIC/ODPT capabilities remain
unavailable until access and usage terms have been confirmed. Existing Ekispert
credentials stay server-side; route output is candidate mobility data.

The existing Ekispert route tool accepts bounded coordinate inputs. Its supplied
station sequence may be rendered as a schematic public-transit candidate,
labelled accordingly. Connecting station coordinates does not create walking
road geometry, segment safety evidence or evacuation authorization. Missing
coordinates remain missing; 72H does not fabricate a line from user/destination
pins. No new paid map/routes API is required by this implementation.

## Enabled versus unsupported capability

| Capability | P1 boundary |
|---|---|
| JMA earthquake observation XML | Live official intake; exact prefecture scope and publication TTL; intensity is not an invented 72H severity or evacuation order |
| Tokyo evacuation-place catalog | Bounded designation excerpt; 2021 basis; current opening/capacity UNKNOWN |
| Ekispert route search | Actual public-transit candidate and supplied station coordinates; candidate-only |
| Current destination suitability/opening, official movement directive, road/hazard route verification | No production source enabled; Safety Core source allowlists default empty and cannot grant high-risk movement |
| GSI/MLIT hazard overlays, JARTIC, ODPT | Unsupported until adapter, terms and acceptance are established |
| Push, Rescue Beacon, native background service | Outside this release |

Positive movement regression fixtures exercise the deterministic evaluator with
explicitly configured trusted test sources. They do not assert those feeds are
enabled in production or that a real destination/route is safe.
