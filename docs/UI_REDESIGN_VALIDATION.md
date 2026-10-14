# UI 重新設計：真實手機驗收報告

- 分支：`codex/ui-redesign`，HEAD `c64e9ae`（驗收時的程式碼；本文件只新增文件與截圖，沒有改程式）。
- 驗收日期：2026-10-14，Claude 執行。截圖在 `output/ui-redesign/`。
- 截圖方式：用 CDP `Page.captureScreenshot` 只擷取網頁內容，不含系統狀態列，因此沒有通知、聯絡人或通話紀錄。畫面左下角的圓形「N」是 `next dev` 的開發用浮標，不屬於產品。

## 1. 測試環境

| 項目 | 值 |
|---|---|
| 手機 | ASUS ROG Phone 6（`ASUS_AI2201`，serial `N7AIOC0638678TY`），Chrome，視窗 411×830 CSS px（DPR 2.625） |
| 連線 | `adb reverse tcp:3000 tcp:3000`；`adb forward tcp:9222 localabstract:chrome_devtools_remote`；CDP 腳本放在 `.superpowers/cdp/`（不提交） |
| 後端 | 8010 埠，`PLANNER_MODE=deterministic`，`GOOGLE_CLOUD_PROJECT=h-japan`，`GOOGLE_GENAI_USE_VERTEXAI=true`，`GEMINI_MODEL=gemini-3.5-flash-lite`；從本 worktree 啟動 |
| 前端 | `next dev`（開發模式）3000 埠，`API_BASE_URL=http://127.0.0.1:8010` |
| 狹窄視窗 | CDP `Emulation.setDeviceMetricsOverride`：320×568、360×740，驗收後已清除 |
| 離線 | 只用 CDP `Network.emulateNetworkConditions`（offline:true）；沒有操作 wifi／行動數據／飛航模式；結束後已關閉 |
| 官方海嘯狀態 | 沒有偽造任何官方來源。透過 `/demo` 的 `miyagi-tsunami-v1` 情境重播取得（第 2 則事件：津波警報） |

### 測試與建置

| 項目 | 結果 |
|---|---|
| `./node_modules/.bin/vitest run`（apps/web） | 90 個檔案通過、1 個略過；594 passed、3 skipped |
| `./node_modules/.bin/tsc --noEmit` | 無錯誤 |
| `node scripts/build.mjs` | 成功（含 "Prepared 35 static assets for offline shell"） |
| `next-env.d.ts` | 建置後已 `git checkout --` 還原 |

跑 vitest／tsc／build 之前已先停掉 dev server，兩者沒有同時使用 `.next`。

## 2. 截圖逐項結果

狀態：PASS＝符合預期；FAIL＝有缺陷（見第 4 節）；NOT RUN＝沒有執行。

| # | 截圖 | 項目 | 結果 | 觀察 |
|---|---|---|---|---|
| 1 | `01-now-normal` | 「現在」頁：平常（live，無警報） | PASS | 狀態帶、主要指示（「正在等待已驗證的資訊」）、依據列、「需要協助」按鈕依序在第一個畫面內；標示「最後驗證：— · 已保存資訊・非即時」。狀態帶文字「持續關注中」與「重新連線中 · …」之間沒有分隔（M1） |
| 2 | `02-onboarding-location`、`03-onboarding-region`、`03b-onboarding-confirm` | Live 子面板：首次設定（語言、定位、地區） | FAIL | 可讀、沒有重疊，但：頂端「需要協助」按鈕與下方標題緊貼；119·110 連結縮排和內文不對齊；右下釘住的「求助」緊貼底部按鈕（D5） |
| 3 | `04-contacts-setup-form` | Live 子面板：緊急聯絡人設定 | FAIL | 舊版卡片 CSS 消失：「名字」「電話」標籤與輸入框併排錯位，輸入框寬度不一致，兩個核取方塊在文字上方且過大（D2） |
| 4 | `05-help-panel-open` | 「我需要幫助」展開（live） | PASS | 7 個狀況標籤、送出／錄音、撥打 119／110 都在，按鈕高 48–56px；撥打 119／110 是 `tel:` 連結，**沒有點**，也沒有按簡訊或求救送出 |
| 5 | `06-help-panel-tags-selected` | 選取標籤 | PASS | 選取後反白（`aria-pressed=true`），「送出」由灰色變為可按；只靠填色區分，沒有勾號 |
| 6 | `07-now-offline` | 「現在」頁：離線 | PASS | 狀態帶「離線 · 顯示已儲存資訊」；「離線 · 最後確認 —」；標示「已保存資訊・非即時」 |
| 7 | `08-help-panel-offline` | 離線時的「我需要幫助」 | PASS | 面板仍可開；語音／文字判讀顯示「需要網路連線，請改用上方按鈕」，「網路 119」標示「需要網路連線」；標籤、撥打 119／110 可用（以頁面文字與按鈕狀態確認） |
| 8 | `09-map-offline` | 離線切換到「地圖」分頁 | NOT RUN | dev 模式離線切換分頁會變成 Chrome 的 `ERR_INTERNET_DISCONNECTED`，因為 service worker 只在 production 註冊（`live-dashboard.tsx` 的 `NODE_ENV==='production'`）。這張圖只是證明 dev 模式不能驗證；production 版沒有測（見 Review Focus 4） |
| 9 | `10-map-sheet-collapsed` | 「地圖」：抽屜收合（411px） | PASS | 全日本地圖、區域下拉、縮放鈕、圖例一行、4 個圖層晶片（可橫向捲動）、抽屜摘要「附近 395 處指定避難場所」。M2：出處列的底色條延伸到縮放鈕下方 |
| 10 | `11-map-sheet-expanded` | 「地圖」：抽屜展開 | PASS | 抽屜佔約 75% 高度，內容可捲動，底部分頁仍可見 |
| 11 | `12-more-home` | 「更多」首頁 | FAIL | 列表清楚、每列 49px；但頂端多出完整的「需要協助」按鈕且緊貼狀態文字，同時右下又有釘住的「求助」，同一頁兩個求助入口（D4） |
| 12 | `13-more-location` | 「更多」→ 位置與隱私（Live 子面板） | FAIL | 可讀；核取方塊在標籤上方獨立一行，與其他列不一致（D2 同類） |
| 13 | `14-more-sources` | 「更多」→ 資訊來源（Live 子面板） | FAIL | 連結文字與說明黏在同一行（「…開啟官方來源 ↗JMA 資訊 · 由 72H 正規化」），連結高度 43px；標題下方有大片空白（D3） |
| 14 | `15-more-contacts` | 「更多」→ 緊急聯絡人 | FAIL | 與 #3 相同（D2） |
| 15 | `16-more-power`、`17-more-notifications` | 「更多」→ 電量模式、通知 | PASS | 單選清單與空狀態都正常 |
| 16 | `18-more-exercise` | 「更多」→ 演練與示範（精簡地圖） | PASS | 「演練」標籤、三個子項、歷史震央下拉、精簡地圖顯示全日本＋出處；釘住的「求助」在畫面底部蓋住說明句最後幾字（捲動可讀，D5） |
| 17 | `19-demo-initial`、`20-demo-now-step1` | 演練「現在」頁（開始前／第 1 則） | PASS | 「演練」帶與標籤清楚；底部控制列（下一則更新／暫停／重新開始／速度／進度）在分頁列上方 |
| 18 | `21-demo-now-tsunami-warning`、`22-demo-now-major-warning` | 演練「現在」頁：津波警報／大津波警報 | FAIL | 紅色狀態帶顯示「演練 · 津波警報」，但主要指示仍是「正在等待已驗證的資訊」，沒有依據、倒數；官方指引只出現在「我需要協助」面板內（D1，需確認是否符合設計） |
| 19 | `23-demo-help-official-tsunami` | OFFICIAL_TSUNAMI：展開「我需要協助」（demo） | PASS | 「演練／模擬」標籤；主要指示「立刻往堅固建築物 3 樓以上或高處移動（來不及抵達指定場所）」；「依據：氣象廳 津波警報 · 發布 14:49」；倒數 25:00；「沒有可靠的目前位置」。這是用演練重播取得，**不是 live**（live 無法在不偽造官方來源下取得） |
| 20 | `24-demo-now-safety-check` | 安全確認按鈕（文字、info 色） | PASS（附註 M3） | 三顆按鈕「我目前安全／我需要協助／我現在無法移動」顏色 `rgb(108,182,255)`（深底對比約 9:1），高 48px、寬 96–128px，可讀；但沒有底色或邊框，看起來像連結。需要在重播前勾選同意，且要用新的重播 session 才會出現 |
| 21 | `25-demo-map-collapsed`、`26-demo-map-sheet-expanded` | 演練「地圖」分頁：說明文字 vs 抽屜 | FAIL | 地圖畫布全黑（Ishinomaki 沒有地圖包）；「目前沒有涵蓋 Profile 地點的地圖包」出現兩次、「Profile 參考地點: Ishinomaki」圖例重複兩次；說明夾在黑色空白與抽屜之間（D6）。展開抽屜後內容正常 |
| 22 | `27-demo-now-tsunami-320`、`27-demo-now-tsunami-360` | 320／360px：演練津波警報的「現在」頁 | PASS（附註 M4） | 無橫向捲動（`scrollWidth` 等於視窗寬）。320px：狀態帶、主要指示、依據、「需要協助」（下緣 317px）都在 568px 高的第一個畫面內，不需捲動。附註：演練控制列在 320px 被截斷（速度下拉「1×」只露出一半） |
| 23 | `28-live-now-normal-320`、`28-live-now-normal-360` | 320／360px：live「現在」頁 | PASS | 無橫向捲動，版面同 411px |
| 24 | `29-live-map-collapsed-320/360`、`30-live-map-expanded-320/360` | 320／360px：「地圖」抽屜收合與展開 | PASS | 無橫向捲動；320px 圖例 5 行、圖層晶片橫向捲動，抽屜收合／展開都正常 |
| 25 | `31-more-appearance-dark` | 「更多」→ 外觀 | PASS | 選項只有「深色／跟隨系統／高對比」，沒有單獨的「淺色」選項；淺色要靠「跟隨系統」＋裝置為淺色 |
| 26 | `32/33/34/35/36-theme-hc`（高對比） | 高對比主題：外觀、現在、求助面板、地圖、資訊來源 | PASS（附註 M5） | 白底黑字，紅色按鈕白字，藍色外框，皆可讀、沒有重疊。地圖底圖仍是深色（M5） |
| 27 | `32/33/34/35/36-theme-light`（以 CDP 模擬 `prefers-color-scheme: light`＋跟隨系統） | 淺色主題 | PASS | 與高對比類似，文字、按鈕、連結可讀 |
| 28 | `37-focus-visible-first-tab`、`38-focus-visible-tabbar` | `:focus-visible` 外框 | PASS | 以鍵盤 Tab 依序聚焦「依據」摘要、「需要協助」、連結、摘要，皆為 2px 黃色（`rgb(255,216,77)`）實線外框、offset 2px；分頁列連結也有 |
| 29 | `39-demo-help-submitted-ai`、`40-demo-help-submitted-ai-scrolled` | D1：AI 建議求救 | PASS | 在演練津波警報下選「水淹進來」「被困住」後送出；後端 `/distress/advice` 回 200；畫面出現「AI 建議 建議求救」，下方三條建議都標「AI 建議」；撥打 119／110 仍需自行點擊，沒有自動撥號。使用本機 ADC 呼叫 Gemini；日誌只確認呼叫成功，沒有獨立驗證回應確由 Gemini 產生 |

### 統計

| 狀態 | 數量 |
|---|---|
| PASS（含附註） | 20 |
| FAIL | 8 |
| NOT RUN | 1 |

## 3. Review Focus 1–5

1. **320px 官方海嘯警報時，狀態色帶、主要指示和「我需要幫助」在第一個畫面內**：PASS。`27-demo-now-tsunami-320.png`：狀態帶「演練 · 津波警報」、主要指示、依據列、「需要協助」按鈕（下緣 317px）都在 568px 畫面內可見，無橫向捲動。限制：這是演練重播，不是 live；且主要指示沒有顯示官方依據（見 D1）。
2. **高對比模式文字對比 ≥4.5:1**：PASS（視覺）。`33/34/35/36-theme-hc` 文字清楚可讀；數值檢查由 Task 1 的測試涵蓋，本次未重算。地圖底圖在高對比下仍為深色。
3. **舊網址仍可用**：PASS（部分）。實機開啟 `/dashboard`、`/map`、`/more`、`/demo` 都正常；`/plan`、`/sources`、`/notifications`、`/trace` 沒有在手機上逐一開啟（由 Task 3 的 `generateStaticParams` 測試涵蓋，vitest 全數通過）。
4. **離線＋SURVIVAL 省電時，底部分頁和「我需要幫助」仍可用**：部分驗證。離線時「我需要幫助」面板可開、可選標籤、撥號連結可用（`07`、`08`）。SURVIVAL 模式沒有在手機上切換：NOT RUN。離線切換底部分頁在 dev 模式不可驗證（`09`，dev 沒有 service worker），production 版沒有測：NOT RUN。
5. **螢幕閱讀器**：由測試涵蓋。本次只在手機上確認分頁列的目前頁面有加粗樣式；`aria-current`、`role="timer"`、`aria-live="off"` 由 Task 2 的測試涵蓋，沒有用 TalkBack 實測：NOT RUN。

### 先前審查要求的逐項確認

- /demo「地圖」分頁：FAIL，說明與圖例重複、畫布全黑（D6）。
- 安全確認按鈕：可讀、48px 高，但只有文字（M3）。
- 「更多 → 演練與示範」精簡地圖：PASS。
- 失去舊卡片 CSS 的 Live 子面板：首次設定可讀；聯絡人設定與位置與隱私的核取方塊（D2）、資訊來源（D3）有版面問題；路線預覽（route preview）在這個 session 沒有資料，NOT RUN；EmergencyMap 只在 demo 地圖分頁看到空畫布（D6）。
- 釘住的求助控制 vs 地圖抽屜：FAIL，`/map` 頁面沒有求助入口，`ui-help-pin` 與抽屜的 CSS 規則無從運作（D4）。
- `:focus-visible` 外框：PASS。
- 淺色／高對比主題：PASS。

## 4. 發現的缺陷

| ID | 畫面 | 問題 | 可能的檔案 |
|---|---|---|---|
| D1 | 演練「現在」頁（津波警報／大津波警報） | 狀態帶已是紅色津波警報，但主要指示仍是「正在等待已驗證的資訊」，沒有依據與倒數；官方指引只在「我需要協助」面板內。需要確認是否符合設計。 | `apps/web/components/dashboard.tsx`（hero 計算）、`apps/web/components/now-screen.tsx` |
| D2 | 更多 → 緊急聯絡人；首次設定的聯絡人表單；更多 → 位置與隱私 | 舊 CSS 消失：標籤與輸入框併排錯位，核取方塊獨立一行且過大（約 24px） | `apps/web/components/emergency-contacts-setup.tsx`、`apps/web/components/device-location.tsx`、`apps/web/components/ui/ui.css` |
| D3 | 更多 → 資訊來源 | 連結與說明文字黏在同一行；連結高度 43px（小於 44）；標題下方有大片空白 | `apps/web/components/official-source-review.tsx` |
| D4 | 地圖（`/map`）、更多 | `/map` 沒有「我需要協助」入口，釘住的求助鈕也不會出現；「更多」同時有頂端完整按鈕與釘住的「求助」兩個入口，且頂端按鈕與狀態文字緊貼 | `apps/web/app/map/page.tsx`、`apps/web/components/live-dashboard.tsx`（`showHelpPin`、`helpInNow`） |
| D5 | 首次設定、更多 → 演練與示範 | 釘住的「求助」會蓋住頁尾內容；首次設定的「需要協助」按鈕緊貼標題 | `apps/web/components/ui/ui.css`（`.ui-help-pin`、`.ui-main` 底部內距）、`apps/web/components/location-onboarding.tsx` |
| D6 | 演練「地圖」分頁 | 畫布全黑；「目前沒有涵蓋 Profile 地點的地圖包」與「Profile 參考地點」各出現兩次；說明夾在空白與抽屜之間 | `apps/web/components/map-screen.tsx`、`apps/web/components/emergency-map.tsx` |
| M1 | 狀態帶 | 「持續關注中」與「重新連線中 · …」之間沒有分隔 | `apps/web/components/ui/status-band.tsx` |
| M2 | 地圖 | 出處列底色條延伸到縮放鈕下方 | `apps/web/components/ui/ui.css`（maplibre attribution） |
| M3 | 安全確認 | 三顆按鈕只有文字沒有邊框，像連結；標題「安全確認」重複出現兩次 | `apps/web/components/vnext-experience.tsx`、`apps/web/components/ui/ui.css`（`.check-buttons`） |
| M4 | 演練控制列 | 320px 時速度下拉被截斷 | `apps/web/components/ui/ui.css`（`.ui-exercise-controls`） |
| M5 | 高對比／淺色地圖 | 底圖仍是深色 | `apps/web/components/simulation-reference-map.tsx` |

## 5. 未執行或受限的項目

- **SURVIVAL 電量模式**：沒有在手機上切換，NOT RUN。
- **離線＋底部分頁**：dev 模式沒有 service worker，無法驗證；需要 production 版。NOT RUN。
- **Live 模式的 OFFICIAL_TSUNAMI**：沒有偽造官方來源，不可達；使用 demo 版代替，已於上表標明。
- **TalkBack 螢幕閱讀器**：NOT RUN。
- **路線預覽（route preview）**：這個 session 沒有可用的路線資料，NOT RUN。
- **撥號／簡訊／SOS 送出**：沒有點擊任何會離開瀏覽器的動作。

## 6. 清理紀錄

- CDP 的視窗大小、離線、`prefers-color-scheme` 覆寫都已清除；主題已還原為「深色」；`innerWidth` 回到 411。
- 手機停在 Live 首頁 `/dashboard`。
- 兩個 server（3000、8010）已停止；沒有動 8000 埠。
- `adb reverse tcp:3000` 與 `adb forward tcp:9222` 已移除（`adb reverse --list`／`forward --list` 皆為空）。
- `git checkout -- apps/web/next-env.d.ts` 已執行。
- 沒有 commit 任何程式、腳本或 `next-env.d.ts`；沒有加入密鑰。


## 7. 最後修正輪（2026-10-14 JST，Codex）

I1–I5、D1–D6、M1–M4 的本地修正及驗證記錄在 [UI_REDESIGN_FINAL_FIX_VALIDATION.md](UI_REDESIGN_FINAL_FIX_VALIDATION.md)。M5 按使用者要求擱置。原始真機 FAIL／NOT RUN 記錄保持不變，本輪尚未真機重驗、未部署。

## 8. 修正後真機重驗（Codex）

提交 `55312a0` 的 production 真機重驗記錄見 [UI_REDESIGN_FINAL_DEVICE_VALIDATION.md](UI_REDESIGN_FINAL_DEVICE_VALIDATION.md)。D1–D6 已測修正通過；另有 R1／R2 及明列 NOT RUN 項目，整體 PARTIAL。保留以上 Claude 原始缺陷與驗收結果，不把歷史 FAIL 改成 PASS。
