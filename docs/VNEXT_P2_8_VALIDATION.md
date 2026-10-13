# VNEXT P2.8 求助輔助驗收紀錄

日期：2026-10-14 JST（最終審查修正後更新）。分支：`codex/p2-8-distress-assist`。狀態：PARTIAL。
設計文件：[VNEXT_P2_8_DISTRESS_ASSIST.md](VNEXT_P2_8_DISTRESS_ASSIST.md)。

## 本機檢查結果

| 檢查 | 結果 |
| --- | --- |
| 後端 pytest（services/agent-api/tests） | 407 passed |
| 前端 vitest（apps/web） | 74 個測試檔 passed、1 skipped；483 tests passed、3 skipped |
| typecheck（tsc --noEmit） | 無錯誤，exit 0 |
| production build（node scripts/build.mjs） | 成功，exit 0；Prepared 40 static assets for offline shell |
| scripts/check_secrets.py | PASS: repository secret-pattern and credential-file checks |
| `git diff main...HEAD` 密鑰 grep | 有兩處自我引用的命中，皆非密鑰：(1) 計畫文件 `docs/superpowers/plans/2026-10-13-p2-8-distress-assist.md` 引用該 grep 指令；(2) 本驗收文件自身列出了被搜尋的樣式名稱（本文件提交後也會進入 diff）。未發現實際的 API 金鑰、私鑰或 NEXT_PUBLIC 密鑰 |

## 真實 Gemini 結果

- Task 6 distress 抽取冒煙測試：回傳標籤 WATER_RISING、WITH_DEPENDENTS，mode 為 GEMINI。
- Task 7 distress 建議冒煙測試：mode 為 GEMINI，沒有被拒絕的欄位（此結果依控制者提供的紀錄）。該次呼叫在沒有使用者訊號的情況下升級；之後已加入使用者訊號閘門，該閘門目前只有 fake-model 測試覆蓋，尚未用真實 Gemini 重跑。

## 真機驗收（Real-device acceptance）

裝置：ASUS ROG Phone 6（adb + CDP），replay 使用 `miyagi-tsunami-v1`。
截圖輸出資料夾：`output/p2-8-device/`（尚未建立，不提交）。以下全部 PENDING，由後續人工執行。

| # | 項目 | 狀態 |
| --- | --- | --- |
| 1 | 第一次使用的聯絡人引導：可略過，也可儲存 | PENDING |
| 2 | 按鈕回報 → 等級 1 就地保命文字並朗讀 | PENDING |
| 3 | 錄語音（「水が足首まで、子どもと一緒」）→ 出現標籤 → 確認後送出 | PENDING |
| 4 | 推進到 WARNING → 2a：場所、倒數、「道路候選」文字 | PENDING |
| 5 | 推進到 MAJOR_WARNING → 等級 2b 或更短倒數 | PENDING |
| 6 | 推進到解除 → 指示消失，計畫版本增加 | PENDING |
| 7 | SOS：`tel:` 開啟撥號畫面（不撥出）、`sms:` 開啟簡訊畫面（不送出）、警報聲、手電筒 | PENDING |
| 8 | 離線（須先取得使用者同意才關閉 Wi-Fi 與行動數據）：按鈕、等級 1、SOS 皆可用 | PENDING |

## 最終審查修正（C1、C2、I1–I6、M1–M8）

- C1：同地區 GPS 更新（只改 observed_at／座標）不再使 HIGH 行動失效或新增計劃版本；200 次更新後計劃數不變（live 與 mock-live）。
- C2：新增 `OFFICIAL_STALE` 等級（見設計文件 §5.4）；前端在 `trigger_expires_at` 後不再顯示「前往某地」。
- I1／I2：AI 排除只在使用者回報 `ROUTE_BLOCKED_REPORTED` 或提供封路描述時接受；主要指示的場所永遠是確定性的最短步行候選。
- I3：等級 2 主要指示下方顯示「依據：氣象廳 〇〇警報 · 發布 HH:MM」。
- I4：TRAPPED／INJURED／MOBILITY_LIMITED 回報有效 60 分鐘，SOS 置頂在本機保存同樣時間。
- I5：replay 求助路徑加入 trace 容量檢查（409）；沒有套用任何內容的 fallback 建議不寫 trace。
- I6：`/api/distress/extract` 需要存在的 session（mock-live 另需 drill key）；全域上限改為每小時滾動 100 次。
- M8 已知限制：JMA 預報區被拆分的都道府縣（北海道、東京、鹿兒島、沖繩等）到不了等級 2（設計文件 §12）。

## 未執行項目

- 真機驗收：PENDING（見上表）。
- Cloud Run 驗收：NOT RUN（需另行授權）。
- 使用者訊號閘門的真實 Gemini 驗證：NOT RUN。
- 未部署。
