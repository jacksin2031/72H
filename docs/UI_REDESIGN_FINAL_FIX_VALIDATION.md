# 72H 最後一輪 UI 修正及本地驗證

日期：2026-10-14 JST。分支：`codex/ui-redesign`。基準：`ab21bbd`。

**本地修正／驗證：COMPLETE。真機重驗：NOT RUN。未合併 main、未 push、未部署。**

接續 Claude 中斷的工作：保留及完成既有 `now-status.ts`、NowScreen note、三語文案及失敗回歸案例。審查來源為 `.superpowers/sdd/2026-10-14-ui-redesign/final-review.md`，真機原始報告保留於 [UI_REDESIGN_VALIDATION.md](UI_REDESIGN_VALIDATION.md)。本紀錄不把舊 FAIL 改寫為新真機 PASS。

## 合併修正清單

| ID | 修正 | 本地證據 |
|---|---|---|
| I1 | Live 手機／電腦共用色帶規則；含 MAP_ASSISTED 官方警報、離線／過期；警報名稱及真實 deadline 倒數。演練離線狀態亦放在色帶，地圖不會遮住它。 | `now-status`、`live-more-ui`、`exercise-dashboard` 回歸 |
| I2 / D4 | /map、/demo Map、/simulation Map / More 都有求助。更多不再同時顯示頂端完整按鈕及固定按鈕。單一 HelpOverlay 可關閉、Escape、焦點還原；同一演練切頁保留面板。/map 採用已驗證的 Live cache 和同 session 回應，回報回應保存回 cache。 | Map / exercise / Live help 元件測試；瀏覽器 map-360.png |
| I3 | 演練沒有 current 官方依據／有離線狀態時，不再聲稱沒有警報。 | 起始無證據回歸；demo-empty-320.png |
| I4 | Now 的安全限制說明在依據下方直接顯示一次，並維持主要指示最前。 | 三語 Live / replay / simulation；tsunami-now-320.png |
| I5 | 地圖預設日文；有效 ?language= 優先，否則讀取已保存語言。 | Map 語言回歸；瀏覽器 /map?language=en |
| D1 | Replay 官方海嘯狀態沒有可用主要計劃行動時，顯示與 Distress 共用的保護指示；依據帶發布時間、色帶帶到達倒數。沒有增加目的地、路線或移動權限。 | 真實 replay API 的 miyagi-tsunami-v1；320 / 360 圖片 |
| D2 | 聯絡人欄位標籤在上方；窄屏單欄；checkbox 與文字同行，20px 方框及至少 48px 標籤點按區。 | contacts-360.png、location-checkbox-360.png、DOM 量測 |
| D3 | 資訊來源連結至少 48px，描述另起一行。 | sources-360.png；三筆來源 link=48px，description 位於 link 下方 |
| D5 | 固定求助的文字頁預留 80px 底部空間；地圖頂部的地區、求助及縮放各有位置。演練控制列高度及色帶高度按實際尺寸量測。 | more-footer-320.png：最後段落 bottom=408、求助 top=444；無遮擋 |
| D6 | 演練 Map 使用現有全日本參考地圖，不再依賴不存在的石卷區域包；不重複 unsupported / Profile 文字。不捏造歷史事件座標或導航資料。 | demo-map-320.png；已載入 MapLibre canvas / 全日本輪廓 |
| M1 | 監察狀態與連線狀態有可見分隔；倒數亦與警報名稱分隔。 | LiveHeaderStatus / StatusBand；DOM |
| M2 | 來源出處列右側保留縮放控制空間。 | 地圖量測：出處 right=248、縮放 left=260（320px） |
| M3 | 安全確認回應有明確按鈕輪廓；replay 嵌入區不再重複安全確認標題；SURVIVAL 的演練詳情不會再掛另一個主頁。 | 元件回歸；CSS |
| M4 | 320px 控制列換行，速度下拉完整顯示；頁面、抽屜預留實際控制列高度。 | tsunami-now-320.png；controls height=121、無水平頁面溢出 |
| M5 | 淺色／高對比底圖仍深色 | **按使用者要求擱置，未修改底圖配色** |

原有 AI 建議 SOS 排序修正保留：主要指示在前；只有自身回報／裝置資料會令 SOS 緊接主要指示，AI 不重新排序。既有 Distress tests 仍通過。本輪沒有點擊撥號、SMS、分享、警報、相機或麥克風按鈕。

## 驗證

- 前端全套：`node node_modules/vitest/vitest.mjs run --maxWorkers=4`，613 passed / 3 原有 skipped（92 files，91 passed / 1 skipped）。原先與 build 同時跑 92 workers 時出現 5 秒 timeout 及後續連帶失敗；停止 build 後限制至 4 workers，完整回歸通過。
- 後端：`uv run --project services/agent-api pytest services/agent-api/tests -q`，424 passed。沒有 backend / API / schema 修改。
- TypeScript：production build 的 TypeScript 檢查通過；另有 `tsc --noEmit` 通過。
- Production build：13 / 13 pages，36 offline shell assets。最後 build ID：`fke1czrPGxQM_RiWIFCf0`。
- `git diff --check` 及 `python scripts/check_secrets.py`：PASS。
- Browser：Codex IAB，320×568／360×640。127.0.0.1:3036 production Next server + 8016 deterministic backend；PLANNER_MODE / DISTRESS_MODE 均為 deterministic，沒有付費模型呼叫。
- 真實 replay 輸入由 server pipeline 經 Safety Core 產生，沒有以 CSS 或 timeline step 捏造警報、計劃、依據或倒數。
- 320px 警報首屏 help bottom=356，controls top=383，無遮擋；來源、主要指示、說明及倒數直接可見。
- CDP 模擬離線時，在同一 replay session 切 Now → Map，地圖及求助可用；沒有關閉電腦／手機 Wi-Fi 或行動數據。最新離線色帶重驗證據在 `offline-map-320.png`。
- 量測／截圖：`output/ui-final-fix/`。舊中間量測名稱含 final 前的版本為調查證據；最新量測為補充紀錄及對應圖片。

## 邊界及後續

- 真機 Android／ROG Phone、TalkBack、陽光對比、原生撥號／SMS、音訊／手電筒均未重驗；不把 IAB 模擬尺寸當作真機 PASS。
- Live 官方海嘯及路線高風險分支使用現有 fixture 測試，未捏造 Live 來源作 browser 驗收；不宣稱即時事故安全。
- /simulation Map / More 求助有元件驗證；本輪沒有重新跑一套真實歷史模擬／Gemini。
- 原最後審查的其餘 Minor（如 More 子頁 h1、求助面板主按鈕數、helper / component 拆分等）不屬此次 I1–I5 / D1–D6 / M1–M4 清單，仍是 follow-up。
- 淺色地圖 M5 明確擱置；Cloud Run／main 整合／真機重驗為後續驗收，並未部署或推送。

## 清理

驗證的網路與 viewport 覆寫恢復，臨時 IAB tab 關閉。未改動原來的 8000 / 3000 server 或 adb 設定。只停止本輪 3036／8016 服務；原有 `.superpowers/` 未納入 Git。驗證文件及截圖沒有私人電話／聯絡人或裝置 GPS 座標。
