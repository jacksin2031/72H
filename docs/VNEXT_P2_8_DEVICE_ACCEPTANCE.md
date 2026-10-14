# P2.8 危急協助：真實手機驗收報告與待執行清單

- 分支：`codex/p2-8-distress-assist`（worktree `C:\Users\jacks\.codex\worktrees\85de\72H`，尚未 push）
- 程式碼狀態：HEAD `b98e889`。後端 424 passed；前端 487 passed、3 skipped；`tsc` 無錯誤；`node scripts/build.mjs` 成功；`check_secrets` PASS。
- 最終審查：C1、C2、I1–I6、M1–M8、F1–F7 全部確認已修正（審查紀錄在 `.superpowers/sdd/2026-10-13-p2-8-distress-assist/`）。
- 本文件的用途：記錄已完成的真機結果，並列出剩下要由 **Codex 執行** 的真機驗收項目。

---

## 1. 測試環境

| 項目 | 值 |
|---|---|
| 手機 | ASUS ROG Phone 6（`ASUS_AI2201`，adb serial `N7AIOC0638678TY`），Chrome |
| 連線方式 | USB `adb reverse tcp:3000 tcp:3000`；用 Chrome DevTools Protocol 操作頁面：`adb forward tcp:9222 localabstract:chrome_devtools_remote` |
| adb 路徑 | `C:\Users\jacks\AppData\Local\Android\Sdk\platform-tools\adb.exe`（不在 PATH 裡） |
| 後端 | `uv run --project services/agent-api python -m uvicorn agent_api.main:app --app-dir services/agent-api --host 127.0.0.1 --port 8010`。環境變數：`GOOGLE_CLOUD_PROJECT=h-japan GOOGLE_CLOUD_LOCATION=global GOOGLE_GENAI_USE_VERTEXAI=true GEMINI_MODEL=gemini-3.5-flash-lite PLANNER_MODE=deterministic`。本機已有 ADC，會呼叫真實 Gemini。 |
| 前端 | 在 `apps/web` 執行 `API_BASE_URL=http://127.0.0.1:8010 ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3000` |
| 情境 | Replay `miyagi-tsunami-v1`（石卷，`USER_SELECTED`），共 4 個事件：地震 → 津波警報（到達 +1800 秒）→ 大津波警報（到達 +600 秒）→ 解除 |

### 注意事項
- **全域 npm 壞掉**（minipass），**不要用 `npm` 或 `npx`**。改用 `./node_modules/.bin/<tool>` 或 `node scripts/*.mjs`。
- **8000 埠已被另一個舊的 72H 後端佔用**，不要關它，後端一律用 8010。
- 不要用 standalone 的 `node scripts/start.mjs`：在 Windows 上會出現 EPERM symlink 錯誤，請用 dev server。
- `next dev` 會改寫 `apps/web/next-env.d.ts`，**不要 commit 這個檔案**。commit 前執行 `git checkout -- apps/web/next-env.d.ts`。
- **重啟後端後**，所有 replay session 都會消失，手機會顯示「伺服器上的示範已結束」。要先清掉網站的暫存（保留 IndexedDB `72h-sos`），再用情境選單選 `miyagi-tsunami-v1` 重新開始（腳本見附錄 A）。手動把 `localStorage['72h-session']` 換成新的 id **沒有用**，頁面會繼續用舊的快取快照。
- 每執行一次 `/next`，畫面要等約 5–8 秒才會更新。讀取面板前請先等待，否則會讀到舊內容。

---

## 2. 已完成的結果（2026-10-14，Claude 執行）

截圖在 `output/p2-8-device/`。

| # | 項目 | 結果 | 證據 |
|---|---|---|---|
| 2 | 按鈕回報 → 等級 1，並且朗讀 | **PASS**：主要指示為「現在往上走／往高處去，遠離水。」，`speechSynthesis.speak` 只呼叫 1 次 | `02-level1.png`、`11-report-level1.png` |
| 4 | 津波警報 → 官方等級 | **PASS**：顯示依據行「依據：氣象廳 津波警報 · 發布 14:49」，倒數 25:00，有「演練／模擬」標籤。真實 Gemini 的 advice 有套用（建議求救＋強調條款），每一項都標「AI 建議」 | `11-report-level1.png` |
| 4b | 2a（前往場所） | **未覆蓋**：手機實際不在石卷，裝置沒有新鮮的石卷定位，所以依設計顯示 2b（垂直避難）＋「沒有可靠的目前位置」。這是正確的保守行為，2a 留給 T7 驗證 | 同上 |
| 5 | 大津波警報 | **PASS**：依據改為「大津波警報 · 發布 14:51」，倒數縮短為 05:00 | `12-major-warning.png` |
| 6 | 警報解除 | **PASS**：伺服器等級變回 `USER_REPORTED`，面板回到等級 1 的文字，依據行消失（`/next` 之後幾秒才更新） | `13-cancelled.png` |

### 真機發現的問題（尚未修正）
- **D1（UX，Important）**：AI 建議「求救」（`suggest_sos`）時，SOS 區塊會排在**主要指示的上方**，主要指示被推到螢幕中間（`11-report-level1.png`）。這違反「一次只顯示一個主要指示、放在最上方」的原則。建議改成：主要指示永遠在最上方；只有使用者自己回報 TRAPPED／INJURED／MOBILITY_LIMITED 時，SOS 才排在主要指示正下方。
- **D2（樣式，Minor）**：「撥打 119／撥打 110」兩個連結的樣式和其他按鈕不一致（綠底連結，看起來不像按鈕）。

---

## 3. 待執行清單（交給 Codex）

使用者已同意執行以下所有項目，包括會發出聲音、需要權限、會暫時關閉網路的測試。每一項都要截圖，存到 `output/p2-8-device/<編號>-<名稱>.png`，並把結果填回第 4 節的表格。

### T1：第一次使用的緊急聯絡人引導（Live）
1. 手機開啟 `http://localhost:3000/dashboard`，完成位置設定（選擇地區即可）。
2. **預期**：在**非緊急模式**下，緊急內容（AdaptiveHome）之後會出現「緊急聯絡人設定」。
3. 輸入一筆不合法的電話（例如 `abc`），**預期**：「儲存」按鈕停用。
4. 輸入 `測試 / 090-0000-0000`，勾選「我行動不便」，按儲存。**預期**：重新整理後不再出現引導；IndexedDB `72h-sos` 有這筆資料。
5. 在 DevTools 的 Network 確認：**沒有任何請求帶出聯絡人資料**。
6. 按「試播警報聲」，**預期**：約 1 秒的嗶聲。

### T2：語音回報（需要使用者在手機旁說話）
1. 在 replay `miyagi-tsunami-v1` 執行第一個 `/next` 後，切到「計畫歷史」分頁的危急面板。
2. 按「錄音」，Chrome 第一次會跳出麥克風權限，請允許。
3. 請使用者說：「水が足首まで、子どもと一緒」（或中文「水淹到腳踝，帶著小孩」）。
4. **預期**：
   - 顯示「分析中…」，接著出現**尚未勾選**的標籤「水淹進來」「帶小孩或長者」，以及「AI 聽到：…」。
   - 按「確認」之前，**不會**送出 `/distress`（看後端 log）。
   - 確認後，等級變成 `USER_REPORTED`。
5. 錄音中途關閉面板，**預期**：沒有呼叫 `/api/distress/extract`，麥克風指示燈熄滅。
6. 讓錄音一直跑，**預期**：30 秒時自動停止。
7. 在 Chrome 的網站設定封鎖麥克風後再按錄音，**預期**：顯示「無法使用麥克風，請用上方按鈕」。

### T3：SOS 撥號與簡訊（只開啟畫面，不撥出、不送出）
1. 在危急面板按「撥打 119」，**預期**：Android 撥號畫面開啟並預填 119。**不要按撥出**，用 `adb shell input keyevent KEYCODE_BACK` 返回。
2. 在已有聯絡人（T1）的情況下按「傳送求救訊息」，**預期**：簡訊 App 開啟。收件人是聯絡人，內容包含標籤、座標或「無法取得位置」、裝置本地時間（帶時區、沒有毫秒），以及「由使用者送出，非官方訊息」。**不要送出**，按返回。
3. 確認訊息裡的時間是**按下按鈕當下**的時間（M1）。

### T4：現場求救訊號（警報聲＋手電筒）
1. 按「播放警報聲」，**預期**：高音量的脈衝警報。第一次會跳出相機權限（手電筒用），請允許。**預期**：背面閃光燈亮起；如果手電筒不支援，改為全螢幕閃爍。
2. 約 3 秒後按「停止」，**預期**：警報停止、閃光燈熄滅、相機使用指示消失。
3. 警報中直接切換分頁或關閉面板，**預期**：一樣會停止（卸載清理）。

### T5：離線（會暫時關閉手機網路，完成後一定要恢復）
1. 在 replay 的津波警報步驟（等級 `OFFICIAL_TSUNAMI`），執行：
   `adb shell svc wifi disable` 與 `adb shell svc data disable`。adb reverse 走 USB，頁面仍連得到 localhost，所以要靠瀏覽器的 `navigator.onLine` 或 DevTools Network「Offline」來模擬。**兩種都試**。
2. **預期**：
   - 面板顯示離線原因與最後確認時間。
   - 錄音和文字輸入停用，並說明原因。
   - 7 個情況按鈕仍可使用：按下後在手機上顯示等級 1 的指引，並提示「未能送出」。
   - SOS 的撥號與警報仍可使用；Net119 標示「需要網路」。
3. 在 DevTools 把裝置時間推到超過 `trigger_expires_at`，或等待證據 TTL 到期。**預期**：OFFICIAL_TSUNAMI 降級為垂直避難＋「官方資料已超過有效時間，最後確認 HH:MM」，**絕不**顯示「前往某地」（C2）。
4. **恢復網路**：`adb shell svc wifi enable` 與 `adb shell svc data enable`，並取消 DevTools 的 Offline。
5. **預期**：恢復連線後，離線時的回報**不會自動重送**（依裁決，使用者要再按一次）。

### T6：省電模式（SURVIVAL）與定位刷新（F2）
1. 在 dashboard 把電量模式設為 `SURVIVAL`，進入官方等級。
2. **預期**：「我需要幫助」入口仍在；裝置每 90 秒仍會上傳同地區定位（後端 log 會看到 location 請求），而且 trace 不會增加（F3）。
3. 停止提供定位超過 2 分鐘（拒絕權限，或關閉定位）。**預期**：等級變成 `OFFICIAL_STALE`，原因是 `LOCATION_STALE`，顯示「位置資料過舊，最後定位 HH:MM」，加上垂直避難；**不是**變回 NONE。

### T7：2a（前往指定場所）
石卷試點範圍外的實機沒辦法自然觸發 2a，請擇一：
- 用 DevTools 的 **Sensors → Location** 把裝置位置設為石卷站前（38.4333737, 141.3037166），精度 10 m，然後重新整理定位；或
- 在 `distress-panel` 的單元測試已覆蓋的前提下，**只做畫面檢查**。

**預期**：
- 顯示「立刻前往 {場所名}（官方指定海嘯避難場所）」、步行分鐘與距離、倒數，以及「這是道路候選路線，沿途狀況未經確認」。
- 主要場所是**確定性的第一名**；AI 排序只出現在「其他候選」，並標「AI 建議」（I2）。
- 在大津波警報（到達 +600 秒）時，如果走不到，改為 2b。
- 回報「路被擋住」並說出地名後，AI 排除該場所時，原因顯示為「依你回報的封路，AI 建議排除」（I1）。

### T8：效能觀察
石卷範圍內有道路圖時，記錄從等級變成 `OFFICIAL_TSUNAMI` 到主要指示出現的時間，以及計算期間畫面是否卡頓（期間應顯示垂直避難＋「計算中」，不會空白）。

---

## 4. 結果記錄表（Codex 填寫）

| 項目 | 結果（PASS / FAIL / BLOCKED） | 截圖 | 備註 |
|---|---|---|---|
| T1 聯絡人引導 | | | |
| T2 語音回報 | | | |
| T3 撥號／簡訊 | | | |
| T4 警報＋手電筒 | | | |
| T5 離線 | | | 網路已恢復：是／否 |
| T6 SURVIVAL＋定位刷新 | | | |
| T7 2a | | | |
| T8 效能 | | | |
| D1 SOS 排在主要指示上方 | 已知問題 | `11-report-level1.png` | 待修 |

FAIL 的項目請附重現步驟、截圖、後端 log 片段，並對照 `docs/VNEXT_P2_8_DISTRESS_ASSIST.md` 的對應章節。

---

## 附錄 A：CDP 操作腳本

把下面的內容存成 `cdp.mjs`（放在 repo 外，或放在已忽略的 `.superpowers/` 裡）：

```js
// node cdp.mjs <targetId> "<js expression>"
const [, , target, expr] = process.argv;
const ws = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${target}`);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
ws.onopen = async () => { const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  const v = res.result?.result?.value ?? res.result?.exceptionDetails?.exception?.description ?? res; console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1)); ws.close(); };
```

- 取得分頁 id：`curl -s http://127.0.0.1:9222/json`（只看 `type==="page"`，再用 `document.visibilityState` 找出前景分頁）。
- 截圖：`adb exec-out screencap -p > output/p2-8-device/<name>.png`

**重新開始 Miyagi 情境**（在 `/demo` 頁面執行）：
```js
(async()=>{const dbs=(await indexedDB.databases?.())||[];for(const d of dbs){if(d.name!=='72h-sos')indexedDB.deleteDatabase(d.name);}localStorage.clear();location.reload();})()
// 等約 12 秒後：
(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('change',{bubbles:true}))};
 set([...document.querySelectorAll('select')].find(x=>x.getAttribute('aria-label')==='Language'),'zh-TW');await s(400);
 set(document.querySelector('.scenario-picker select'),'miyagi-tsunami-v1');await s(400);document.querySelector('.scenario-picker button').click();})()
```
- 推進事件：按文字以「下一則更新」開頭的按鈕。
- 危急面板在 demo 控制列的第二個分頁 `nav.controls button:nth-child(2)`（「計畫歷史」）裡，選擇器是 `.distress-panel`，主要指示是 `.distress-primary-text`。
- 檢查朗讀：先包裝 `speechSynthesis.speak`，記錄 `u.text` 後再呼叫原函式。

## 附錄 B：不在本次範圍
- **Cloud Run 與真實 Gemini 的雲端驗收：NOT RUN**，需要使用者另外授權部署到零流量的 Preview revision。
- 使用者訊號門檻（AI 升級）只有假模型測試涵蓋；**用真實 Gemini 驗證這個門檻：NOT RUN**。
