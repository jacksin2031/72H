# 311 評審引導體驗 — 本地驗證

日期：2026-10-15 JST。分支：`codex/judge-311`；基底：`a4add97`。
狀態：**COMPLETE — 本地實作及驗證**。
範圍：評審入口、固定歷史演習、逐步事件、行動與依據、實際執行結果回顧。
這是本地實作紀錄；未部署，沒有改變目前 Cloud Run 版本或提交狀態。

## 評審怎樣體驗

1. 開啟 `/judge`，或由未設定位置的首頁／更多的演習清單進入。
2. 預設日文、311 情境及石卷市演習區域；亦可於開始前選擇英文、繁體或簡體中文。
3. 按「3.11体験を始める」。不用管理員密鑰，不要求 GPS、帳戶或個人資料。
4. 每次按「次の出来事へ」只送入一個事件，不等待歷史時間間隔。
5. 四步完成後按「体験を振り返る」，查看真正建立的計劃、事件及 AI 執行結果。

時間線沿用 `historical_cases.py` 的 311 紀錄：14:46 地震、14:49 大海嘯警報、
15:14 警報範圍／預測更新、15:15 餘震。
[日本氣象廳原始紀錄](https://www.jma.go.jp/jma/en/2011_Earthquake/Information_on_2011_Earthquake.html)。
人物及位置是演習假設，不代表完整重建 2011 年的實際個人／當地狀況。

## 執行與安全界線

- `POST /api/judge/start` 只接受 `language`，其餘條件由 server 固定。
- `POST /api/judge/{uuid}/next` 不接受 body 或 query，只認得此入口建立的 session。
- 沿用 Mock Live 的合成來源、Live reducers、Safety Core、不可變計劃及 SimulationAdvisor。
- 事件輸入控制推進；沒有按事件序號硬編排計劃或成功結果。
- AI 統計取實際 `movement_assessment_history.ai_mode`；成功、fallback、NOT_RUN 分開顯示。
- 合成來源不授權真實移動，不核實特定目的地或安全路線。
- 目的地移動被阻止時沿用共享的 `exerciseHeroText` 一般防護指引，不展示被阻止的目的地指令。
- `projectContinuity` 重用現有到期、依據及行動失效規則；只將輸入型別收窄為它實際讀取的欄位，沒有修改其 runtime 決策。
- 模擬時間、當前執行時間與歷史紀錄分開標示；回顧頁明示不是目前行動指示。
- 前端 session 只存於記憶體，不寫入 Live cache、localStorage、IndexedDB 或 URL。
- 請求期間鎖定按鈕；回應 session／步數不符或結果不明時要求重新開始，避免盲目重送而跳步。
- 斷線後不會因單純恢復網絡而重新顯示舊指示；須成功評估下一事件。
- Active marker 在等待事件評估前即延長 TTL，避免臨近到期的 in-flight 請求失去 marker；
  底層 session 已消失時亦會清除 marker。完成 marker 的 409 請求不延長 TTL。

## 容量及操作限制

公開 Judge 與受保護 Mock Live 使用獨立 session pool，但共用同一個 CandidatePlanner、
SimulationAdvisor 及模型預算。每 process 每滾動 60 秒最多開始 4 次；最多 8 個未完成
session，閒置 30 分鐘過期。完成即釋放 session 及 per-session 預算記帳；最多保留 8 個
完成 marker，保留期間再次 next 回 409。全域模型限額不因釋放而退款。

中途離開的 session 仍會暫佔容量至閒置到期。所有 session、marker、限流均是 process-local；
多實例分流／server 重啟的持續性及 Cloud Run 驗收尚未涵蓋。這次沒有新增部署設定。

## 驗證證據

| 檢查 | 結果 |
|---|---|
| 後端完整測試 | 528 PASS；既有 Starlette/httpx deprecation warning |
| Judge API | 18 PASS，包含 9 次完成／容量隔離／共享預算／嚴格輸入及權限／TTL 競態 |
| 前端完整測試 | 797 PASS / 3 原有 skipped（`--maxWorkers=4`） |
| 新增前端契約及互動測試 | 10 PASS；包含錯誤、重複點擊、過期、斷線／重連、步數錯誤、AI fallback 統計 |
| TypeScript | PASS |
| Production build | PASS，包含 `/judge` 及 39 個 offline shell assets |
| 秘密掃描與 diff whitespace | PASS |
| 真實模型／瀏覽器完整四步 | 最終文案已重驗：5 個請求、步數 0–4、計劃 v1/v2/v3、Gemini/ADK 4 成功／0 fallback、movement_authorized=false |
| 排版與入口 | 320×740 完整流程無橫向溢出；390×844 入口；1280×900 桌面入口／重設／首頁入口（按鈕 y=256） |
| 真機／Cloud Run／部署 | NOT RUN |

完整前端預設高併行的一輪曾在未變更的 `road-tiles.test.ts` R22 零延遲排程檢查失敗；
限制為 4 workers 的完整測試通過，沒有修改道路實作或其測試。初次新增導覽連結時，
兩個既有清單測試預期不含 `/judge`；已更新為保留原有三個入口並在前方加入新入口。

本機 standalone 啟動遇到既有 Windows pnpm symlink `EPERM`；直接 `next start`
啟動被自動審批拒絕（沒有提供具體原因）。本輪瀏覽器使用本機 Next dev server，
不把 build 成功寫成 production runtime 驗收。舊 origin 的 Turbopack HMR 模組錯誤
獨立保留為失敗證據；最終瀏覽器使用新本地 origin。

`output/judge-311/` 保存畫面、測試／build 日誌、實際瀏覽器回應與測試用 envelope。
`envelopes.json`／`tests/fixtures/judge-311.json` 是固定 timeout runner 產生的真實 pipeline
測試 fixture，四步標示 fallback；不能作真實 Gemini 成功證據。
`browser-*.json` 才是本輪真正 Gemini／ADK 執行的回應。

獨立 Luna Max 複審重現並促成兩項修正：完成 session 未釋放的容量問題，及 marker
接近到期時的競態。一般並行最後一步另重現為一個 200／一個 409。
最終窄項複審 18/18 通過，未發現新 blocker；GitHub 上載結果以最後交付的 commit／CI 狀態為準。
