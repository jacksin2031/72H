# 311 評審體驗正式發佈

日期：2026-10-15 JST。狀態：**COMPLETE — Cloud Run 部署及正式網址驗收**。

- 正式入口：https://h72-vux6j7xjka-an.a.run.app/judge
- 提交表格可直接使用的日文說明：[動作確認の方法](../JUDGING_INSTRUCTIONS_JA.md)。
- Runtime source：`4503c5eba19f1b0b90893c8fe1ae81ba2404e185`；其後的說明／證據提交不改變 runtime。
- Cloud Build：`0e873296-75cc-450c-b79f-25495793e80f`，SUCCESS。
- 映像：`asia-northeast1-docker.pkg.dev/h-japan/h72/72h@sha256:4edd3b076de4c80c106d0322571cc91fd3a882335f8b6a3f0c379bcf1f904b1d`。
- 正式 revision：`h72-judge-4503c5e`，100% traffic。
- Preview：https://judge-4503c5e---h72-vux6j7xjka-an.a.run.app/judge
- 回復版本：`h72-submit-b390b8a`。

## 發佈方式及結果

從 `git archive 4503c5e` 建立不可變 source，不包含工作目錄內尚未提交的文件整理。
Cloud Build 成功後，先以 digest-pinned image 建立 `--no-traffic` 預覽，通過驗收才切換正式流量。
目前 GitHub main 的 runtime source 已獨立確認；其 CI：
https://github.com/jacksin2031/72H/actions/runs/38750871025 。

服務原有環境變數（含 Secret Manager 綁定）與舊 revision 逐項比較相同；沒有輸出秘密值。
保留公開 invoker、`h72-runtime@h-japan.iam.gserviceaccount.com`、CPU 1、1 GiB、最多 1 個實例、
concurrency 8 及 timeout 60 秒。

| 驗證 | 結果 |
|---|---|
| 後端完整測試／秘密掃描 | PASS；528 項測試；既有 Starlette deprecation warning |
| 前端／TypeScript | 797 PASS、3 原有 skipped；TypeScript PASS |
| Linux production build | Cloud Build SUCCESS，容器正常啟動 |
| 預覽及正式 HTTP | 首頁、judge、demo、disaster-test、more、health、version 均 200 |
| 靜態資產 | 23 個引用資產均 200；正式 SW 及 precache manifest SHA256 與預覽相同 |
| 預覽及正式 Tokyo replay | 各 11 件事件、計劃 v1–v4；OFFLINE_RECENT → OFFLINE_STALE → RECONNECTING → ONLINE_VERIFIED |
| 預覽及正式 Judge 瀏覽器 | 各 4 件事件、計劃 v1–v3、真實 Gemini/ADK 4 成功、0 fallback、0 未執行 |
| 顯示及互動 | 預覽 390px 完整流程；正式桌面完整流程及依據展開；正式 390px 回顧／入口，無橫向溢出 |
| 正式存取 | 無登入、無演習存取密鑰；日文預設；實際 API 回應已保存 |
| Live 獨立探測 | 預覽及正式均 INVALID_RESPONSE / ONLINE_DEGRADED；零計劃，沒有移動授權 |

3.11 演習只將歷史事件當作合成輸入。AI 執行成功並不代表已核實安全場所、路線或實際移動許可。
Live 上游的 INVALID_RESPONSE 原樣保留，沒有以演習資料替代真實災害資訊。

## 證據與限制

本次 source、build、revision、traffic、API 回應、前端測試日誌及畫面保存在
`output/judge-311-release/`。`preview-judge.json`、`production-judge.json` 是兩次瀏覽器的實際回應，
步數均為 0–4；本地 timeout fixture 並非本次雲端 AI 證據。

這次驗證演習事件中的斷線／重連狀態轉換及靜態離線資產，沒有重做真機斷網／離線 reload、GPS、
背景執行或電池驗收。手機寬度是桌面瀏覽器 viewport，不宣稱真機驗收。
公開演習仍有每 process 每分鐘 4 次開始、8 個未完成 session、30 分鐘閒置過期及共享模型預算；
session 保存在記憶體，實例重啟後須重新開始。

需要回復時執行：

```powershell
gcloud run services update-traffic h72 --project h-japan --region asia-northeast1 --to-revisions h72-submit-b390b8a=100
```

本次沒有提交 Hackathon 表格；日文說明已準備好供貼上。
