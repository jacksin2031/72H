# 最後修正輪：Android 真機重驗

日期：2026-10-14 JST。測試提交：`55312a011ca19b58e5c25fd7eab10101d90e2d29`，分支 `codex/ui-redesign`。

**驗收：PARTIAL。D1–D6 的原有缺陷已通過已列出的真機重驗，但發現 R1、R2；不可宣稱 I1–I5 全部完成驗收。** 本輪只測試及記錄，沒有修改產品程式、合併、push 或部署。

後續：使用者授權修正 R1／R2，兩項已完成自動回歸及 production Android 真機重驗；見 [R1／R2 修正驗證](UI_REDESIGN_FOCUS_LANGUAGE_FIX_VALIDATION.md)。以下保留 `55312a0` 修正前的實測狀態；未測項目維持 NOT RUN。

## 環境及證據

- ASUS ROG Phone 6 / ASUS_AI2201_A，USB 已授權，Chrome `155.0.8059.39`。原生 CSS 視窗 411×830、DPR 2.625。
- 320×568、360×740 是同一部實機 Chrome 的 CDP viewport 覆寫，並非另一部 320px 手機。
- 本機 production Next server：127.0.0.1:3036；deterministic API：8016。Build ID `fke1czrPGxQM_RiWIFCf0`。產品程式沒有改動，沿用上一輪成功的 production build，沒有重新 build。
- 手機使用 `adb reverse tcp:3036 tcp:3036`；Chrome 偵錯使用 9236。沒有更改原有 3000、8000、8010、9222 服務／映射。
- 使用 webapp-testing skill / Python Playwright，經 Chrome CDP 操作頁面。截圖只含網頁內容，不含通知或系統狀態列。
- 離線測試只用 Chrome `Network.emulateNetworkConditions`，沒有關閉手機 Wi-Fi／行動數據／飛航模式。
- 演練警報由真實 replay API 的 `miyagi-tsunami-v1` 經現有 pipeline / Safety Core 產生；不是 live 警報，沒有偽造官方來源。Live JMA 資料在此次查詢呈過期／未完成核實，沒有宣稱安全或沒有警報。
- 使用新 localhost:3036 測試分頁及自行選擇的宮城縣測試地區；沒有取得裝置 GPS、填入私人聯絡人、撥號、SMS、分享位置、錄音或按警報聲按鈕。回報「水淹進來／被困住」只提交至本機演練 API，沒有聯絡救援單位。
- 截圖及逐步 DOM / 幾何 / 焦點證據：`output/ui-final-device/`；`manifest.json` 列出 SHA-256、CSS 及 PNG 尺寸。411px Android 的 CDP 截圖由實際 compositor 輸出 1080×2369；320px 覆寫的截圖為 840×1491。以 JSON 中的 CSS 尺寸作版面量測。

## 原清單重驗

| 項目 | 結果 | 真機證據及範圍 |
|---|---|---|
| D1 海嘯主指示 | PASS | 日文／繁中津波警報及大津波警報均顯示保護指示、官方依據與 25:00／05:00 倒數；320px 首屏可見求助。`03`、`04`、`28`、`29`、`30` |
| D2 表單／checkbox | PASS | 聯絡人標籤在輸入框上方，窄屏單欄；位置同意 checkbox 與文字同行。`10`、`11`、`12`。沒有填入私人資料或授權 GPS |
| D3 資訊來源換行 | PASS | 說明位於連結下方；320px 三個來源連結各 48px 高，連結按鈕未點。`13`、`14` |
| D4 地圖／更多求助 | PASS | /map 和 /demo Map 可開啟求助面板；More 僅一個固定求助入口；關閉按鈕正常。`06`、`17`、`21`、`22`、`23`。/simulation 未完成真機啟動，另列 NOT RUN |
| D5 頁尾遮擋 | PASS | 「更多 → 演練與示範」捲至最底後，最後說明 bottom=407.88、求助 top=444，保留 36.12px 空間。`16`。這表示最後文字可捲至按鈕上方，並不表示固定按鈕永遠不覆蓋捲動途中的內容 |
| D6 演練黑地圖／重複說明 | PASS | 日本全國參考地圖已載入，沒有原有 unsupported / Profile 兩次說明。`05`、`08`。僅作參考，沒有導航／安全路線授權 |
| I1 警報／離線色帶 | PASS（已測分支） | Replay 警報及離線色帶可見；Live 未核實／離線有黃色提示。`03`、`08`、`24`。Live 官方海嘯／MAP_ASSISTED / desktop 分支由自動測試涵蓋，非真機 live 事故驗收 |
| I2 共用求助面板 | PARTIAL | 入口、初次開啟後 Escape、關閉按鈕、焦點還原正常；送出後 Escape 失敗，見 R1。`35`–`39`；/simulation 真機 NOT RUN |
| I3 無證據時不聲稱無警報 | PASS | reset 至 0/4 時顯示「正在等待已驗證的資訊」；1/4 的 synthetic 官方依據經 pipeline 核實後才顯示無警報。`27` 及步驟 JSON |
| I4 可見安全限制 | PASS | Now 的依據下方直接顯示一次安全限制說明。`29` |
| I5 地圖語言 | PARTIAL | `?language=en` 畫面顯示英文，沒有 query 時採用已保存繁中；HTML 語言標記不一致，見 R2。`40`、`41`。預設日文有自動測試，本輪真機尚未單獨重置偏好驗證 |
| M1 狀態分隔 | PASS | 繁中 Live 可見「持續關注中 · 重新連線中 · 驗證尚未完成」。`11`、`14` |
| M2 地圖出處／縮放 | PASS | 320px /map 求助 right=248、縮放 left=260，出處右側亦預留控制空間。`05`、`21` |
| M3 安全確認輪廓／重複內容 | PASS（自動測試）；真機部分 NOT RUN | SURVIVAL Live 顯示及底部分頁可用，`18`、`19`、`24`；沒有新建一個開始前已同意安全確認的 replay session，故原 replay 安全確認三按鈕及 SURVIVAL 演練詳情不標作真機 PASS |
| M4 320px 控制列 | PASS | 日文及繁中控制列完整換行，速度下拉未被截斷；document scrollWidth=320。`04`、`29`、`30` |
| M5 淺色底圖 | DEFERRED | 按使用者要求擱置，沒有修改 |

Production 版補測：在已快取的演練 session 中離線切 Now → Map，最後確認時間色帶及求助入口仍可見（`07`、`08`）。另在 SURVIVAL 下離線切 /map → /dashboard → /more 成功（`24`、`25`），沒有 Chrome 斷網錯誤頁。這是實機上的 Chrome 網絡模擬，並非實際關閉裝置網絡的驗收。

## 新發現

### R1 / P2：送出回報後焦點離開求助 dialog，Escape 失效

重現：/demo → 需要協助 → 水淹進來＋被困住 → 送出 → Escape。

- 第一次開啟：焦點在 dialog DIV；Escape 後 dialogs=0，焦點回到「需要協助」（`35`、`36`）。
- 送出回報後：activeElement=BODY、insideDialog=false；Escape 後 dialogs=1（`37`、`38`）。在 earlier 大津波演練亦重現一次。
- 「關閉」按鈕仍可用；點擊後 dialogs=0、焦點回到入口（`39`）。沒有點擊任何撥號或警報按鈕。
- 相關位置：`apps/web/components/help-overlay.tsx` 的 dialog `onKeyDown` 只接收 dialog 子樹的事件；焦點在 BODY 時收不到 Escape。
- 建議：回報造成目前焦點元素移除／停用後，保留或還原 dialog 內焦點；補送出／非同步更新後的 Escape 及 Tab 回歸。

### R2 / P2：地圖畫面語言改變，HTML lang 仍是 ja

- 直接開 /map?language=en：可見標題「All Japan reference map」、求助「I need help」，但 document.documentElement.lang=ja（`40`）。
- 直接開 /map，採用保存繁中：標題「全日本參考地圖」、求助「需要協助」，但 lang 仍為 ja（`41`）。
- 相關位置：`apps/web/app/layout.tsx` 預設 lang=ja；map page 更新語言 state 後未同步 document 語言。
- 影響：DOM 語言標記與文字不一致，可能令輔助閱讀使用錯誤讀音；本輪沒有 TalkBack 實測，不聲稱已觀察到讀音錯誤。
- 建議：地圖有效語言確定後，同步 document.documentElement.lang，並為 query／saved language 加回歸。

## 求救排序及尚未驗證項目

- 真機：本機演練中送出水淹／被困回報後，主要保護指示在前，SOS 接在其後；119／110 的 tel 連結沒有按（`31`、`37`）。
- AI 建議 SOS：`apps/web/tests/distress-panel.test.tsx` 的 `keeps the primary instruction first even when AI suggests SOS (D1)` 等 fixture 回歸通過。此次 API 為 deterministic，沒有真正 Gemini 建議求救，故「AI 建議 建議求救」及真正模型回應的真機端到端驗收為 NOT RUN。
- /simulation Map / More：/disaster-test 正常顯示，但本機演習 API 未配置管理員 DRILL_ACCESS_KEY，啟動按鈕停用；沒有設定正式密鑰、重啟為 Gemini 模式或產生付費呼叫。元件回歸通過，真機端到端 NOT RUN。
- TalkBack、真實斷網／重連、裝置 GPS、原生電話／SMS、音訊／手電筒、Live 高風險移動分支、淺色／高對比主題重新驗收均 NOT RUN；M5 按要求擱置。

## 本輪重新執行的自動驗證

- 前端：`node node_modules/vitest/vitest.mjs run --maxWorkers=4`：**613 passed / 3 原有 skipped**；91 passed files / 1 skipped（共 92），43.92s。
- 後端：`uv run --project services/agent-api pytest services/agent-api/tests`：**424 passed**，49.25s。1 個 Starlette/httpx 既有 deprecation warning。
- TypeScript：`node node_modules/typescript/bin/tsc --noEmit`：PASS。
- `python scripts/check_secrets.py`、`git diff --check`：PASS。
- 自動測試通過沒有覆蓋新發現 R1／R2，不能取代這兩項真機證據。

## 清理

已還原測試 Chrome 的網絡及 viewport 覆寫，關閉新建測試分頁。移除本輪 3036 reverse／9236 forward，只停止本輪 3036／8016 的程序。原有 Chrome 分頁及手機網絡設定未改動。新測試 origin 的偏好及演練快取只含自行建立的測試資料；原 localhost:3000 資料未改動。證據與文件保留在工作樹，未提交、push 或部署。
