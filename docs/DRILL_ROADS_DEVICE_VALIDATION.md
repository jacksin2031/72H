# 演練位置與全國道路參考線 — 驗收紀錄

日期：2026-10-15 JST。狀態：**PARTIAL — 整合檢查與真機驗收進行中**。

工作分支：`codex/drill-location-roads`。本紀錄只涵蓋本機來源與驗收；沒有部署，
不代表正式災情、安全路線、場所開放或移動授權。

## 實際道路來源 probe

以下是獨立手動整合 probe，並非會連線的單元測試。呼叫實際
`RoadTileService`、固定 Overpass endpoint/query 及正式 tile builder，保留原本的
逾時、序列化、限流、容量與雜湊規則，沒有更換來源或自動重試。

| 公開測試地點 | 中央格網 | 結果 |
|---|---|---|
| 石卷・門脇 | `r1920c5651` | 首輪 UNAVAILABLE：上游 504；沒有編造資料。其後手動重試 PASS（443 nodes / 100 ways / 476 edges）：[重試紀錄](../output/drill-roads/local-api-ishinomaki-retry-20261015.json)、[3×3 API probe](../output/drill-roads/ishinomaki-neighbourhood-api-probe-20261015.json)（其中一格仍 503，兩格為空區塊） |
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

## 自動檢查

分支 HEAD `7f6fe9e`（加上本次文件變更）於 2026-10-15 重新執行：

| 檢查 | 結果 |
|---|---|
| `apps/web`：`./node_modules/.bin/vitest run` | PASS：105 檔通過、1 檔略過；742 測試通過、3 略過 |
| `apps/web`：`./node_modules/.bin/tsc --noEmit` | PASS：無錯誤 |
| `apps/web`：`node scripts/build.mjs` | PASS：production build 完成，34 個離線靜態資源（已還原 `next-env.d.ts`） |
| 後端：`uv run --project services/agent-api pytest services/agent-api/tests -p no:warnings -o addopts=""` | PASS：490/490，73.05 秒 |
| `python scripts/check_secrets.py` | PASS：repository secret-pattern and credential-file checks |

以上只是本機自動檢查，不取代真機驗收，也沒有部署。

## ROG Phone 6 真機驗收

手機經 adb 連接、Chrome page CDP 可用。測試只操作 browser，
不按撥號、短訊或求救；演練位置與 Live 設定保持隔離。

| 規格 §7.2 項目 | 狀態 | 證據／限制 |
|---|---|---|
| 311，石卷・門脇預設點，完整播放及道路參考線 | NOT RUN | 等整合後 production build |
| 311，氣仙沼地圖點選，下載及道路參考線 | NOT RUN | API 手動來源 probe 只有部分格網成功；未作 GUI 驗收 |
| 我的目前位置，確認道路請求只有格網 ID | NOT RUN | 未以模擬 GPS 代替真實定位 |
| CDP 模擬離線：已下載位置可用，新位置明確無資料 | NOT RUN | 不切換手機本身網絡 |
| 熊本 2016，地圖點選，使用地震適用場所 | NOT RUN | 只有中央格網來源 probe 成功 |

## 安全與解讀界線

- 演練永遠標示演練，主要指示仍由 deterministic Safety Core 決定。
- OSM 區塊是按取得時間的道路參考 snapshot，不代表 2011／2016 年的實際道路網。
- 指定場所清單不是目前開放證據；道路候選不是避難路線或最安全路線。
- 缺少目的地格網時，鄰格 buffer 中有節點也不能據此畫出目的地參考線。
- 取消載入後不能發佈舊位置結果。內建 memory／IndexedDB 必須取消尚未提交的寫入；
  取消前已完成的有效公開 tile 快取可以保留。自訂、不支援取消的 legacy
  `TileStore.put` 無法由呼叫端強制回滾，但其完成後仍須拒絕發佈已取消結果。
- 剛好 1,000 m 的路段可能因 Python／JavaScript 一個 ULP 的距離差而被保守拒絕；
  此已知限制只會令資料不可用，不會擴大路線權限。

## 清理與剩餘項目

本輪的測試服務、adb 規則、臨時演練 key 及新測試 tab 清理：**PENDING（10b）**。
上一位 agent 啟動的本機 API 行程仍在 port `8041` 監聽（PID 4360，截至 10a），
將於 10b 停止。Claude 原有的 `3039`／`8019` 服務及 `9239` CDP 連線屬於接手前狀態，
不會當成本輪新 build 的證據。真機結果及最終清理狀態會在 10b 更新。
