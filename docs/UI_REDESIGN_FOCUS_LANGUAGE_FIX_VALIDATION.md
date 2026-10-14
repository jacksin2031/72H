# R1／R2 修正及真機驗證

日期：2026-10-14 JST。分支 `codex/ui-redesign`，基準提交 `55312a0`。

**R1／R2：COMPLETE。** 修正前的失敗證據保留在 [原真機重驗報告](UI_REDESIGN_FINAL_DEVICE_VALIDATION.md)，不覆寫歷史結果。本次完成範圍是兩項新發現，沒有把此前 NOT RUN 項目改成 PASS。

## 修正

- R1：求助面板開啟期間監察其子樹變動。回報移除或停用目前焦點控制時，焦點返回 dialog，令 Escape／Tab 繼續生效。關閉時 disconnect observer，並保留既有入口焦點還原。
- R2：地圖讀取 query／保存語言後，同步 `document.documentElement.lang`；沒有改變語言優先次序或日文預設。
- 沒有修改 backend、Safety Core、來源信任、TTL、計劃版本或移動授權；M5 淺色底圖仍擱置。

## 自動驗證

四個新增回歸先在未修正程式上失敗：移除焦點控制後焦點離開 dialog、停用控制後焦點仍在停用按鈕、query 英文 lang 仍 ja、保存繁中 lang 仍 ja。修正後針對測試 14/14 通過。

- 全套前端：`node node_modules/vitest/vitest.mjs run --maxWorkers=4`，**617 passed / 3 原有 skipped**，92 passed files / 1 skipped，26.56s。
- TypeScript：`node node_modules/typescript/bin/tsc --noEmit`，PASS。
- Production build：`node scripts/build.mjs`，PASS，13 pages、36 offline shell assets；Build ID `eJ7607JesxP2kORxlj_QF`。
- `git diff --check`、`python scripts/check_secrets.py`，PASS。
- Backend 未修改，本次沒有重跑；上一輪原提交的 424 passed 保留為歷史證據。
- 按 React best-practices 核對：observer 僅在開啟面板掛載；unmount 清理；document 語言 effect 使用有效 language／ready 依賴；沒有新依賴或網絡呼叫。

## Android 真機重驗

ASUS ROG Phone 6，Chrome `155.0.8059.39`，原生 411×830 CSS px。320×568 是同一部實機 Chrome 的 CDP viewport 覆寫。使用新 localhost:3038 測試 origin，避免上一版 service worker 快取混入；8018 deterministic backend，沒有 Gemini／付費模型呼叫。

使用 webapp-testing skill / Python Playwright，經 Android Chrome CDP 操作。警報來自 `miyagi-tsunami-v1` 真實 replay pipeline；水淹／被困回報只送往本機演練 API。沒有取得 GPS、填入私人資料、撥號、SMS、錄音、分享位置或按警報聲按鈕。

| 驗證 | 結果 | 證據 |
|---|---|---|
| 回報後焦點（411px） | PASS | `06`：dialogs=1，activeElement=DIV，insideDialog=true |
| 回報後 Tab | PASS | `07`：焦點到「關閉」，insideDialog=true |
| 回報後 Escape／入口還原（411px） | PASS | `08`：dialogs=0，activeElement=「需要協助」按鈕 |
| 回報後直接 Escape（320px） | PASS | `09`：焦點在 dialog；`10`：dialogs=0，焦點回入口；沒有先按 Tab |
| 演練 Map 求助／關閉 | PASS | `11` 開啟；`12` 關閉，dialogs=0。Android 觸控入口原焦點是 BODY，未把這一項稱為鍵盤入口還原驗證 |
| 英文 query | PASS | `01`：可見英文標題、HTML lang=en |
| 無保存偏好的預設 | PASS | `02`：可見日文標題、HTML lang=ja |
| 保存繁中 | PASS | `03`：可見繁中標題、HTML lang=zh-TW |
| query 優先於保存繁中 | PASS | `04`：可見英文標題、HTML lang=en；保存偏好仍為繁中 |

證據在 `output/ui-final-device-fix/`，逐步 JSON 保存 DOM、CSS 尺寸、HTML 語言及焦點；`manifest.json` 保存截圖 SHA-256、build ID 與兩個產品檔案的 Git blob hash。截圖只含網頁，不含系統通知。

測試程式的來源綁定：

- `apps/web/components/help-overlay.tsx`：`e92a5407c4da701db92a085672ee266ad7f56f5f`
- `apps/web/app/map/page.tsx`：`3bd63427191134601892713f13f87084184e428d`

## 邊界及清理

真正 Gemini 建議求救、/simulation 端到端、TalkBack、原生電話／SMS及 M5 的狀態維持原報告，本次沒有重新驗收。沒有部署、push 或合併 main。

還原 Chrome 網絡／viewport 覆寫並關閉本輪新分頁；只停止 3038／8018 程序及移除 3038 reverse／9238 forward。原有手機分頁、3000 origin 資料及裝置網絡未改動。
