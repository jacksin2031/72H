# 演練位置與全國道路參考線 — 驗收紀錄

日期：2026-10-15 JST。狀態：**PARTIAL — 本地實作及離線回歸通過；真實定位所在地的道路載入仍受上游失敗阻擋**。

工作分支：`codex/drill-location-roads`。本紀錄只涵蓋本機來源與驗收；沒有部署，
不代表正式災情、安全路線、場所開放或移動授權。

## 實際道路來源 probe

以下是獨立手動整合 probe，並非會連線的單元測試。呼叫實際
`RoadTileService`、固定 Overpass endpoint/query 及正式 tile builder，保留原本的
逾時、序列化、限流、容量與雜湊規則，沒有更換來源或自動重試。

| 公開測試地點 | 中央格網 | 結果 |
|---|---|---|
| 石卷・門脇 | `r1920c5651` | 首輪 UNAVAILABLE：上游 504；其後手動重試 PASS（443 nodes / 100 ways / 476 edges）。3×3 probe 七格 200、兩格 503；成功回應中兩格為有效空區塊 |
| 氣仙沼 | `r1945c5662` | PASS：3,874 nodes / 516 ways / 4,041 edges，content SHA-256 相符 |
| 熊本・益城 | `r1639c5232` | PASS：2,799 nodes / 838 ways / 2,988 edges，content SHA-256 相符 |

來源時間與結果：[source-probe-20261015.json](../output/drill-roads/source-probe-20261015.json)。
成功輸出均是 `ROAD_REFERENCE_ONLY`、`movement_authorized=false`。

氣仙沼 3×3 probe 最多三個 client request 並行：中央及另外三格成功，
其餘五格因上游 504、排隊逾時或請求失敗而不可用。
[逐格結果](../output/drill-roads/neighbourhood-probe-20261015.json) 保留了失敗，
不把「可使用部分資料」視為完整下載。

獨立前端審查已使用兩個真實單格回應及四個相鄰氣仙沼區塊作離線相容性 probe：
schema／雜湊可接受，四格合併為 READY、missing 五格，來源集合為實際四格；
沒有新增來源中不存在的邊。這不是實際 browser IndexedDB 或真機驗收。

整合後的本機 API `8041` 已通過 health，正式道路端點回傳 HTTP 200、
`Cache-Control: public, max-age=86400`，並保留相同氣仙沼 content hash、角色及
`movement_authorized=false`：[HTTP probe](../output/drill-roads/local-api-source-probe-20261015.json)。
此回應使用上方實際下載並驗證過的後端快取，不是另一輪冷下載。

其後對石卷中央格網作一次明確的手動重試，HTTP 200，443 nodes / 100 ways /
476 edges：[重試結果](../output/drill-roads/local-api-ishinomaki-retry-20261015.json)。
原本的 504 紀錄仍保留；這並不表示上游可用性問題已消失。
同點 3×3 API probe 為七格 HTTP 200、兩格 503；其中兩格海域是有效的
0 nodes / 0 ways / 0 edges，雜湊及來源仍須驗證。
[逐格結果](../output/drill-roads/ishinomaki-neighbourhood-api-probe-20261015.json)。

此實際來源驗證發現並修正前端誤拒有效空白 tile 的問題（`361356d`）：
空格網保留 coverage 與來源，沒有補造道路；九格均驗證為空時回傳 `NO_ROADS`。
若只有部分空格網而其他格網不可用，仍顯示暫時不可用／離線無資料，
不可據此宣稱整區沒有道路。修正的 focused tests 25/25 PASS；獨立審查 PASS。

## 自動檢查

接手前 Claude 已完成至 `a044746`，包括地圖選點 click handler 修正、完成的有效
tile 即時保存、部分下載的重試、依位置而非災害重新載入道路。
Main 於 `a044746` 重新執行以下檢查（尚未包含本輪新發現的離線修正）：

| 檢查 | 結果 |
|---|---|
| `apps/web`：`./node_modules/.bin/vitest run` | PASS：106 檔通過、1 檔略過；756 測試通過、3 略過 |
| `apps/web`：`./node_modules/.bin/tsc --noEmit` | PASS：無錯誤 |
| `apps/web`：`node scripts/build.mjs` | PASS：build `VeHxTm3jaoJNf5hdhYJ8s`，34 個離線靜態資源；已還原 `next-env.d.ts` |
| 後端：`uv run --project services/agent-api pytest services/agent-api/tests -p no:warnings -o addopts="" -q` | PASS：507/507，34.54 秒 |
| `python scripts/check_secrets.py` | PASS：repository secret-pattern and credential-file checks |

以上只是本機自動檢查，不取代真機驗收，也沒有部署。

其後真機找到離線重試缺口，已以 `34ca301` 修正：道路與場所重試 key 分開，
direct drill 在讀取場所前註冊既有 SW 並短暫等待頁面受控，明確
`OFFLINE_NO_DATA` 不被泛化錯誤掩蓋。獨立審查無 P1，條件式 P2 見下方限制。

修正後 Main 完整重驗：前端 **762 PASS／3 skipped**（106 檔通過、1 檔略過，
含 design guard）、TypeScript、production build **PASS**。
build ID：`LN3GOQMKqkRN08w2dR-QE`，34 個離線靜態資源；`next-env.d.ts` 已還原。
後端在 `a044746` 的 507/507 仍適用，`34ca301` 沒有後端改動。
本機 log：`.work/drill-roads-offline-final-web-tests.log`、
`.work/drill-roads-offline-final-build.log`、`.work/drill-roads-final-backend-tests.log`。

## ROG Phone 6 真機驗收

手機經 adb 連接、Chrome page CDP 可用。測試只操作 browser，
不按撥號、短訊或求救；演練位置與 Live 設定保持隔離。

| 規格 §7.2 項目 | 狀態 | 證據／限制 |
|---|---|---|
| 311，石卷・門脇預設點，完整播放及道路參考線 | PASS（部分覆蓋） | `a044746` 真機完成 4/4 事件；NOW 往高處／遠離水；5 處海嘯適用場所、3 個道路參考距離。使用先前實際下載的後端快取，不是冷下載成功。見 `continuation-311-now.png`、`continuation-311-map.png` |
| 311，氣仙沼地圖點選，下載及道路參考線 | PASS（部分覆蓋／快取） | `34ca301` 真機觸控平移／縮放，於氣仙沼站附近實際點選及確認，完整演練；5 處全數核對為海嘯適用 `EMERGENCY_SITE`，3 個道路距離。使用原先實際下載的後端快取，不是冷下載可靠性通過。見 `continuation-kesennuma-result.json`、`continuation-kesennuma-map.png`、`continuation-kesennuma-map-collapsed.png`。Claude 早前中央格網 504 的失敗紀錄仍成立 |
| 我的目前位置，確認道路請求只有格網 ID | PARTIAL | 用戶開啟定位後，真正 DEVICE_ONCE 成功，無注入座標。API 8041 的 18 個道路請求（含預設及定位載入）全部為格網 ID 路徑、沒有座標 query；當前位置道路被上游 502／逾時擋住。只保存匯總，沒有記錄該位置座標／格網 ID。見 `continuation-device-once-privacy.json` |
| CDP 模擬離線：已下載位置可用，新位置明確無資料 | FAIL → 修正後 PASS | `a044746` 的 RED 證據 `continuation-offline-same-point.json/png` 保留。`34ca301` fresh origin 的 DB/cache/SW registrations 起初均為 0；直接進演練、自動取得 SW controller，public shelter cache 兩份資產。同點離線按重試後仍有 5 處及 3 個道路距離；Live `/map` 在宮城另一未下載點明確顯示離線無資料，0 道路請求，5 處均為道路「—」。見 `continuation-offline-same-point-after.json/png`、`continuation-offline-new-point.json/png` |
| 熊本 2016，地圖點選，使用地震適用場所 | PASS（部分覆蓋） | 真機 canvas 點選及確認可用，完整演練；5 處均經同雜湊公開 pack 核對為 `EMERGENCY_SITE`／earthquake `D`，3 個道路參考距離，仍有未下載格網。見 `continuation-kumamoto-result.json`、`continuation-kumamoto-map.png` |

上述截圖與 JSON 位於 [`output/drill-roads`](../output/drill-roads/)。
手機最初在主畫面時 CDP 截圖逾時；用戶切回 Chrome 後才取得上述截圖。
沒有保存手機主畫面或真實定位的畫面。

## 安全與解讀界線

- 演練永遠標示演練，主要指示仍由 deterministic Safety Core 決定。
- OSM 區塊是按取得時間的道路參考 snapshot，不代表 2011／2016 年的實際道路網。
- 指定場所清單不是目前開放證據；道路候選不是避難路線或最安全路線。
- 缺少目的地格網時，鄰格 buffer 中有節點也不能據此畫出目的地參考線。
- 取消載入後不能發佈舊位置結果。R22／R23 已改為逐格驗證完成便保存，
  即使 consumer 在該有效格網寫入期間取消，該格網也可保留；尚在下載的格網
  在最後一個 consumer 取消後中止。無效或過密格網本身永不保存，整個鄰域仍
  不會因鄰格已有快取而繞過 `INVALID_DATA`／`TOO_DENSE` 的無參考線結果。
- 剛好 1,000 m 的路段可能因 Python／JavaScript 一個 ULP 的距離差而被保守拒絕；
  此已知限制只會令資料不可用，不會擴大路線權限。
- SW 首次 control 最長等 5 秒。註冊失敗、逾時或不支援時仍可正常 online fetch；
  若頁面未受控，該次場所下載不保證保存供之後離線重載。獨立審查將此列為條件式 P2；
  這輪真機 fresh-entry 取得 controller 並成功保存，不代表所有 browser／低資源環境均通過。
- 展開抽屜時會遮住地圖上的一次性警語／署名，收合時可見；此為既有審查 Minor，
  本輪沒有修改抽屜排版。320px 新版視覺驗收及合併上限 180k nodes 的真機延遲未量測。

## 清理與剩餘項目

Claude 對話／ledger 記錄上一輪服務、adb 規則及演練 key 已清理；本輪亦核實
`3039`、`3041`、`8019`、`8041`、`9239`、`9241` 當時沒有 listener，adb 沒有規則。
本輪另開 `8041`／`3041`、CDP forward `9241` 及 reverse `3041`，只操作新建測試 tab，
保留原 `3039/simulation` tab。完成後清理：**PASS**。

- `localhost:3041` 的 IndexedDB、Cache Storage、SW registrations、localStorage、
  sessionStorage 均確認為 0；只清測試 origin，沒有清 `3039`。
- 所有本輪 `3041` 測試 tab 已關閉，原 tab `14401` 保留；CDP 離線覆寫已還原，
  `navigator.onLine=true`。沒有改動手機本身網絡或用戶啟用的定位設定。
- 核對 PID／命令及工作樹後，停止自建 web PID 24768、API PID 28452；
  uv launcher PID 20028 亦已結束。`3041`／`8041`／`9241` listener 均為 0。
- 只移除本輪 adb reverse `3041` 及 forward `9241`，forward／reverse 清單確認為空。
  演練 key 只存在已結束的 API 行程環境及已關閉頁面記憶體，沒有建立金鑰檔。

仍未完成的是 §7.2 第 3 項的「真實定位後顯示道路線」：定位及請求私隱界線已通過，
資料源 502／逾時仍未解決。替代 Overpass 來源、預建沿岸資料包或部署策略均未實作，
沒有把快取成功當作已解決外部可用性。
