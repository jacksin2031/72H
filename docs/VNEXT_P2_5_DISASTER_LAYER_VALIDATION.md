# P2.5 官方災害參考圖層 — 本地驗收

日期：2026-10-12 JST。基線 `36d6278`；分支 `codex/p2-5-disaster-layers`。
本紀錄的資料版本與程式碼隨同本文件的 Git commit 保存。

狀態：**COMPLETE（本地參考圖層交付）／PARTIAL（資料覆蓋及整體 roadmap）**。
整體 P2.4–P2.7 仍 **PARTIAL**。本階段沒有部署、真實裝置 GPS、
當前災害安全或全國安全目的地驗收。

## 交付及邊界

- `GET /api/reference/disaster-map` 保留各官方資訊單位的原文 hash、
  發表／收到／有效期限、生命週期及來源恢復狀態，固定 `REFERENCE_ONLY`。
  `safe_location_verified`、`route_authorized` 固定 false；GET 不建立 LIVE session。
- VXSE53 逐層解析 PREFECTURE／REGION／CITY／STATION。
  只有 station `Int` 屬測站實測；其餘是各自範圍 `MaxInt`。
  未知值為 null，不把都道府縣最大值填成逐點實測。
- 地圖呈現地域邊界及「地域最大」文字，沒有震度填色或測站定位。
  錨點只供擺放地域標籤；近期值不混入過時電文，有未知值／衝突則未判定。
  多筆有效電文取其中地域最大值，保留貢獻電文 ID、原始發表時間及來源連結。
- 未有地域觀測的有效幾何保留中性「未判定」；缺幾何／碼名不符／歷史版本
  不可對照的資料只保留文字，不猜位置或範圍。地域 pack 按使用者勾選載入。
- VTSE41 官方區碼只連接官方 coastal MultiLineString。
  17 個結合碼及 15 個領域碼只按官方 codebook 的成員碼展開。
  不將海岸線閉合為浸水面，不假設預報區等於都道府縣。
- 觀測、海嘯電文、石卷靜態浸水想定、歷史震央、P／S 估算使用不同文字／圖例。
  沒有着色、道路、場所指定或圖層覆蓋均不代表安全或移動授權。
- 參考 TTL 是 app policy；過時或電文取消不表示警報解除／災害結束。
  官方 forecast ValidDateTime 另列，期限只縮短資料可用時間。

## 有版本的來源與加工

官方入口：[JMA GIS](https://www.data.jma.go.jp/developer/gis.html)、
[JMA XML 技術資料](https://xml.kishou.go.jp/tec_material.html)。
GIS 頁明示 JGD2011；原 ZIP 沒有 PRJ，CRS 不是從缺失檔案猜出。

| 資料 | 原始版本／SHA-256 | 本地產物 |
|---|---|---|
| AreaTsunami GIS | 20240520 / `735e2ed36befa8d9511f01e6a0e503e01e7824b5125a71326f3f623d808a7eb9` | 66 基礎區；4 個 code=0 歸屬未定 feature 排除 |
| AreaForecastLocalE GIS | 20240520 / `92f3c9a51fc0681970672e3e77cb81d9d7885822e55b6ca6aefcb4ea6d20705f` | 188 碼名相符；181 有效幾何；7 有碼無效幾何及 6 無碼 feature 排除 |
| JMA codebook ZIP | 20261007 / `e3f1f0462c432c3d6dde475e8563e1d96b1859bd0986b593aa134fa45ee580f8` | AreaTsunami sheet 31：98碼；AreaForecastLocalE sheet 24：188碼 |

建置：JGD2011 → Web Mercator、100m 容差保留拓樸簡化 → WGS84，
顯示座標至 6 位小數。容差不是資料最大位置誤差，`positional_accuracy=UNKNOWN`。
地域原始／加工後無效幾何明確排除，沒有靜默修補。個別碼有效起迄未提供；
不以現行 registry 重解讀 2011 等歷史電文，2026-10-07 以前不做空間 join。

每份 manifest、asset 的 hash、bytes、版本及來源在 client／build 時核對。
Local review：`2026-10-12T09:35:37.651895+00:00`；90日覆核期限
`2027-01-10T09:35:37.651895+00:00`。覆核、來源收到、官方版本／公布日期分開。

- 海岸線：15,467,874 bytes；SHA `e1816ea4e536fddc90d28d0cdfda771568e5ed6a5e3928f5592da788959050ba`。
- 地域：兩個分片共 13,427,219 bytes；個別 SHA／bytes 在 pinned manifest。
- 複製時保留 JMA／GSI 承認號、出處、加工聲明及利用規約。
- Build-only pyshp／pyproj／shapely／openpyxl 不加入 application dependencies。
  builders 接受 `--source-dir`、`--retrieved-at`、`--reviewed-at`，可重現指定 metadata；
  原始大 ZIP 不發送到 browser、不提交 Git。

## 測站與浸水資料限制

JMA XML 現行站碼表沒有座標；歷史 `code_p.dat` 不能按相同 7 位碼直接接上。
已查的 131 個同碼紀錄站名全部不同。沒有可靠 code／座標／有效期間 crosswalk，
所以測站觀測只列表。原文 311 sample 保留 2,400 測站及 1,275 市町村，
不套用 2026 站點位置。

石卷 A40 原幾何／深度分級及既有邊界測試重用；這次只新增可驗證的
scenario／CRS metadata 與說明、更新 manifest pin，沒有重建浸水面。
[宮城縣原典](https://www.pref.miyagi.jp/soshiki/kasen/miyagi-tsunami-shinsuisoutei-published1.html)
的最大規模／不利條件、可能範圍外或更深浸水、後波最大及河川／湖泊水位未顯示
分開列明；原典公布 2022-05-10、地盤／復興條件 2019-12。
直接 ZIP 公布／更新時間仍未知；精度 25m STANDARD_DEVIATION 不是最大誤差。
沒有獨立完整調查覆蓋，所以浸水多邊形之外仍 UNKNOWN。

## 離線／更新／容量

- 官方電文 public cache 與 LIVE／REPLAY Safety Core snapshots 分開；不存 GPS。
  cache restore、斷線、失敗或未完成重連不使用近期樣式，保留原始時間與年齡。
- 未來／無效快取不成為 API 高水位；晚到、未來 API 回應不更新 current state。
  重連要有中斷後新的來源抓取時間；單純 API 200 重用舊來源不能恢復近期樣式。
- 過時／衝突／取消參考線為灰色虛線；取消另一資訊單位不清掉獨立有效警報。
- Service Worker 只快取被請求的公開 hazard 資產；API、auth、query 資料不快取。
  `no-cache`／`reload` 會重新驗證資料包，網絡失敗才回退既有 bytes，client 仍核對 pin。
  舊 SW 首次升級可能先拒絕新 pin；新 worker 啟用後可按「重新驗證海岸線」恢復。
- 每 report 6,000、每 response 12,000 觀測；超限不回傳假裝完整的截斷地圖。
  source INVALID_RESPONSE、reports 清空、capacity_exceeded=true；這是有界支援限制。

## 驗證證據

- Backend 全套：276 passed；新增 hierarchy、未知值、311原文、獨立資訊單位、
  過期／衝突／容量及只讀 endpoint 測試。
- Frontend 全套：351 passed / 3 原有 skipped；typecheck 通過。
- Production build 通過；build-time 三份資料包 byte/hash 驗證通過。
- Secret pattern／credential file scan 及 `git diff --check` 通過。
- Map mock 驗證地理來源只在狀態改變時替換；每秒 age tick 不重建大型幾何。
  regional unknown／非逐點、兩個有效最大值、原始 source bindings、碼名／版本不符、
  缺幾何／expired review、offline／重連／晚到／future、SW升級均有測試。
- 獨立 Luna Max 唯讀審查找到 future cache 高水位、無效震度字串，均修正並重驗。
  之後新增來源追溯／未判定標示；主模型再重現及修正 cached reconnect 與 SW pin 更新。
  沒有把代理結論代替主模型測試。審查用量限制曾中斷一次；限額重置後同路由重驗完成。

GUI 最終 build：`a9srLFKOTJlmF6W7CAbr3`，本地 `http://127.0.0.1:3036/map`，
API port 8000。390×844 及 1280×900 截圖在 `.work/p25-mobile-reference.jpg`、
`.work/p25-desktop-reference.jpg`；未提交 Git。無橫向溢出；桌面新增圖例曾壓縮標題，
已改為分行並重新 build／實看。地圖可見「過去」及「未判定」地域文字，
來源 disclosure 可直接查地域貢獻電文的 ID、原文 URL 和發表時間。

實際窗口有 45 個資訊單位、44 個可對照的地域參考值；本次來源為 STALE，
來源恢復可見 WINDOW_VERIFIED 及小時重新掃描期間的 SCANNING。
沒有將它們顯示成近期已核實警報。手機離線重載保留電文／日期，
來源顯示 UNKNOWN、電文為 archived reference，英文同樣暴露不確定性；
網絡／viewport 測試覆寫已恢復。新 SW 修正後資料包重試可清除升級 pin 錯誤。
GPS button 沒有點擊。沒有證明任何地點或路線當前安全。
瀏覽器測試是本地桌面／手機尺寸模擬，不是實際裝置、正式事故或部署驗收。

## 後續

P2.6：GSI GeoJSON／CSV 對照、角色與八類用途、分區更新、authority open evidence／TTL。
P2.7：決定性計劃後的 Gemini／ADK 解釋 envelope、ID／version 檢查與三語 fallback。
國內其他自治體浸水包、station registry、被排除幾何修正、實際 GCS／多實例及
session 重啟流程、Preview／production／真實裝置依各自門檻繼續，不包含在此本地結論。
