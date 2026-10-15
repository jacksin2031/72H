# Ishinomaki Central Road Candidate Snapshot

This document records the provenance and bounded scope of the local road-reference pack at `apps/web/public/roads/ishinomaki-central-v1/graph.json`, followed by the separately implemented nationwide on-demand tile boundary. Local source changes do not establish deployment or nationwide current-condition verification.

## 全國道路參考區塊

此分支在後端加入 `GET /api/roads/tile/{tile_id}`，以固定查詢向公共 Overpass
取得 OSM 道路資料。固定查詢以 `[out:json][timeout:12];` 開頭，
只含白名單 highway 值（`primary`／`secondary` 須有 sidewalk 標籤），
無法由呼叫端改變。內建石卷資料包及離線底圖仍是獨立、固定的 snapshot；
「不在 runtime 執行建置」只描述這些內建資料包，並不適用於按需道路 API。

- 固定格網為緯度 `0.02°` × 經度 `0.025°`，ID 是
  `r{floor(lat/0.02)}c{floor(lng/0.025)}`。後端只接受日本 bounding range
  （緯度 20–46、經度 122–154）內完整格網的 canonical ASCII ID，不接受 query。
  這個 range 不是日本行政界線或陸地驗證。
- 手機在本機選點並計算周圍 3×3 格網。離開裝置的只有格網 ID（及
  `X-Road-Session`），不傳精確 GPS；而且只在位置保護設定允許，或使用者
  手動／演練選點時才會請求；格網仍會透露約略查詢地區。
  演練的 `area_ids` 另經既有本機行政區 resolver 產生，並不寫入 Live 位置。
- 後端向 `https://overpass-api.de/api/interpreter` 發送固定 pedestrian-highway
  查詢，保留來源、OSM base timestamp（可能為 null）、取得時間及 raw/query/content
  SHA-256。OSM 標籤及幾何不代表現時可通行、無障礙或安全。
- 每個區塊上限為 1,500,000 bytes、20,000 節點、8,000 路段、40,000 邊。
  過密回應為 `413 ROAD_TILE_TOO_DENSE`，不截斷成部分成功。
  手機合併上限為 180,000 節點、360,000 邊；載入前必須通過 strict schema、
  `content_sha256` 及通用圖驗證。
- 空的已驗證區塊（沒有任何道路）代表 `NO_ROADS`：明確顯示沒有道路參考資料，
  不是「安全」也不是錯誤。內建石卷資料包保留為本機 fallback。
- 後端快取為 30 天，每次讀取都重新驗證 `content_sha256`、角色及
  `movement_authorized=false`，不符即視為未命中；本機 cache 位置由 `ROAD_TILE_CACHE_DIR` 指定，底下使用
  `72h-road-tiles/`。成功 HTTP 回應可快取一天；失敗不快取、不自動重試。
  手機使用 IndexedDB `72h-roads` / `tiles`；儲存不可用時只在記憶體使用，
  必須標示無法離線保存。超過 30 天的本機資料保留原取得日期並標示較舊。
- 公共 Overpass 同時只處理一個請求，請求之間至少相隔兩秒；手機最多同時下載
  三個區塊。每個 session 每分鐘最多 30 次、全域最多 120 次，session LRU 上限
  2,048 個 key。最多八個排隊者；鎖等待上限 16 秒、上游逾時 12 秒，總預算 30 秒。
  忙碌／失敗回 `503 ROAD_DATA_TEMPORARILY_UNAVAILABLE`，本機限流回 429。
- 離線只使用已驗證、已下載的區塊。中央區塊缺失則不可用；缺少周邊區塊須標示
  「部分道路資料未下載」。任何區塊過密時，整次結果不可用，不畫部分線條。
- 資料仍屬 **© OpenStreetMap contributors / ODbL-1.0**；原始授權連結及來源
  在下方保留。指定場所的災害適用旗標來自另外驗證的全國 GSI 目錄；
  designation 不是開放狀態或移動授權。

所有輸出維持 `ROAD_REFERENCE_ONLY`、`movement_authorized=false`。
道路參考線不是避難路線，最安全路線未判定，場所開放狀態未知。沒有資料時不得推測或補線。
後端快取的部署容量／淘汰策略、Cloud Storage 及 Cloud Run 發布仍屬另外的工作，
今次沒有部署。實際檢查及未完成驗收會另記於 `DRILL_ROADS_DEVICE_VALIDATION.md`。

## Source and licence

- Source: OpenStreetMap contributors, retrieved once from the public Overpass API at `https://overpass-api.de/api/interpreter`.
- OSM data timestamp: `2026-10-13T06:49:25Z`; retrieval: `2026-10-13T15:51:00+09:00`.
- Licence: Open Database Licence (ODbL-1.0). Attribution: **© OpenStreetMap contributors**; [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright), [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- The public Overpass API returns OSM elements in JSON and accepts a bounded south/west/north/east query with geometry output. This pack uses a fixed box; it does not send a device location. See the [Overpass QL reference](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL), [Overpass output formats](https://dev.overpass-api.de/output_formats.html), and [Overpass public-server guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

## Fixed extent and source query

Coordinates are WGS 84 in the order **south, west, north, east**:

```text
38.4205, 141.2855, 38.4475, 141.3195
```

This is approximately 3.00 km north/south by 2.97 km east/west around central Ishinomaki. The bounds are installed in code and are not inferred from a user's position.

The one-time source query was:

```overpass
[out:json][timeout:45];
(
  way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|unclassified|tertiary|service)$"](38.4205,141.2855,38.4475,141.3195);
  way["highway"~"^(secondary|primary)$"]["sidewalk"~"^(yes|both|left|right)$"](38.4205,141.2855,38.4475,141.3195);
  way["highway"~"^(secondary|primary)$"]["foot"~"^(yes|designated|permissive)$"](38.4205,141.2855,38.4475,141.3195);
);
out body;
>;
out body qt;
```

Query SHA-256: `a8a58a9f0da037aae36832149dcce47d8e68b260b0c70ea83b301b777af55111`.

## Filtering and graph construction

The source response contained 15,029 elements (3,532 ways and 11,497 nodes). The pinned candidate pack contains 2,629 ways, 9,187 graph nodes, and 10,318 non-zero edges (rebuilt `2026-10-13T16:13:38+09:00` after unsupported `oneway:foot` values were dropped). Ways are connected only through adjacent OSM way-node references; no straight-line links or last-metre connectors are synthesized. Road and node tags are retained as supplied, including unknown attributes. Edge lengths are calculated locally from the pinned coordinates.

The extraction admits footways, paths, pedestrian ways, steps, living streets, residential, unclassified, tertiary, and service roads. Primary and secondary roads are admitted only where sidewalk or foot tags explicitly meet the query. It drops private or disallowed foot access, conditional foot/access restrictions, motorroads, and driveway/parking-aisle/drive-through service roads. Unsupported `oneway:foot` values are dropped. Generic motor-vehicle `oneway` tags are retained as source attributes but are not treated as pedestrian direction restrictions. The [OSM access-tag guidance](https://wiki.openstreetmap.org/wiki/Key:access), [footway tag reference](https://wiki.openstreetmap.org/wiki/Key:footway), and [pedestrian tag reference](https://wiki.openstreetmap.org/wiki/Pedestrian) describe the source tagging conventions; tags are not ground truth about current conditions.

At the reviewed snapshot, the graph is below the fixed capacity (`max_nodes=9999`, `max_edges=19999`) and the serialized asset is below 1 MB. The loader pins exact byte length and SHA-256, caps the response size, validates the strict schema and graph references, and refuses a different declared extent or capacity.

## Pinned review metadata

- Pack: `ishinomaki-central-walk-v1`
- Built and reviewed: `2026-10-13T16:13:38+09:00`
- Review due: `2027-01-11T16:13:38+09:00` (90 days after review)
- Asset bytes: `730042`
- Asset SHA-256: `36f436b9ab96e06e7fbb86d8becf398a6bd4bb2a9ebff86f02d7b7e9f7ac5847`
- Original Overpass response SHA-256: `04b44a37f46e13b13330abad3a74d302eac785ce4a915b9de1c16bfcc80c1062`
- `reviewed_at` records review of the source query, filtering rules, bounds, schema, and pinned bytes. It is not a field survey, accessibility audit, safety review, or confirmation that a way remains open.

The optional named reference node is OSM node `461190495`, `石巻駅前` (`highway=traffic_signals`, 38.4333737, 141.3037166). It is a demonstration reference only and is never substituted for a user's locally supplied origin.

## Strict interpretation boundary

This asset is labelled `ROAD_REFERENCE_ONLY` and sets `movement_authorized=false`. A returned geometry is a road-graph candidate with origin/destination snap gaps, not an evacuation instruction, safe route, accessible route, open road, or current passability report. The graph contains no live closures, hazard effects, bridge/road damage, official movement directives, sidewalk verification, curb or stair assessment, wheelchair suitability, or destination-opening proof. A missing candidate means only that this bounded snapshot could not produce one under its constraints. Current safety and movement decisions remain undetermined by this data.
