# 所在地 Gemini 演練 — 本地驗收

2026-10-13 JST。分支 `codex/simulation-gemini-location`，基線 `d593555`。
本次範圍 **COMPLETE（本地模擬接入）**；不代表完整 P2.7、真實災害安全判斷或部署完成。
契約：[VNEXT_SIMULATION_GEMINI_LOCATION.md](VNEXT_SIMULATION_GEMINI_LOCATION.md)。

## 已驗證

- Backend：`services/agent-api/.venv/Scripts/python.exe -m pytest`，**304 passed**。
- Frontend：`pnpm test`，**366 passed / 3 原有 skips**。
- TypeScript：`pnpm exec tsc --noEmit`，exit 0。
- `pnpm build`：exit 0；build ID `oqI4cjSQoGlt6-pmuroeM`，37 個 offline shell assets。
- `scripts/check_secrets.py` 與 `git diff --check`：PASS。
- 新測試涵蓋 canonical area、禁止座標欄位、未知位置不代入歷史災區、GPS 120 秒過期、搖晃期間不允許移動、避難所／高處條件、無法移動求助、模型版本／facts／限制、timeout／budget／offline，以及重連不復活舊判斷。
- 現有 Replay、Live、plan history、synthetic provenance 和禁止 HIGH ALLOW／route／destination 的契約測試仍通過。
- Luna Max 獨立審查發現的 DURING、basic assistance、未知位置及模式顯示問題均已修正；最後核對沒有新 blocker。

## 真正 Gemini／ADK

使用既有 ADC、`h-japan/global`、`gemini-3.5-flash-lite`，沒有 API key 或 credentials 檔案加入 repo。
最後程式版本的 API probe 三項均 `GEMINI_ADK`，沒有 fallback：

| 演練假設 | 真正模型選項 | Session |
|---|---|---|
| 石卷市、搖晃期間、室內 | STAY_PROTECT | `8c706f9c-e2e4-48ed-8e8e-863cacce94f5` |
| 石卷市、搖晃後、建物損毀、避難所開放、路線可通行 | EVACUATE_SHELTER | `75942572-e61d-4d13-922c-986a4a8dd98a` |
| 石卷市、311 海嘯警報、沿岸低地、搖晃後、高處與路線可用 | HIGH_GROUND | `9275ca31-246a-4bc9-aa1d-695bb7aae5b9` |

Probe 同時驗證 assessment 與 current step 相符、`route_authorized=false`、`safe_location_verified=false`、真實 movement 未授權、routes/destinations 為空。
可重現的模型結果不保證總是選非 UNKNOWN；安全 gate 允許模型保守選 UNKNOWN。

## 瀏覽器及 311

本地 API `127.0.0.1:8000`、frontend `127.0.0.1:3036`。
手機 390×844 和桌面 1366×900 檢查所在地、AI 成功標示、演練限制及排版，手機沒有橫向溢出；測試後已還原 viewport。
311 全部四個里程碑經 UI → Mock Live → 實際 ADK，session `f3ce36c2-5e51-4bdd-98d0-9cfa190841fd`。
4/4 模型輸出成功；在同一組「沿岸、搖晃後」假設下，主震尚未有海嘯情境時 UNKNOWN，其後三步 HIGH_GROUND。
後續 GPS 過期 guard 修補不改這組手動位置條件；最後程式的三類 API probe 已再核實。
實際服務仍是合成演練，時間線不證明用戶所在地的歷史震度或現時安全。

忽略的本地證據：`.work/gemini-311-mobile.jpg`、`.work/gemini-311-desktop.jpg`、`.work/gemini-311-assessments.json`、`.work/gemini-simulation-probe.json`。
演習密鑰只在程序與頁面記憶體；暫存傳遞檔於驗收後刪除，不會 commit。

## 邊界及限制

- 未做真實手機 GPS、背景／電量、Cloud Run 或 Preview／production 驗收；本次沒有推送或部署。
- GPS 來源標記由 client 提供，server 驗證路徑及時間，不能以此證明真實 GPS 或安全。
- 真實避難所開放、高處適用性及安全路線未核實，畫面只作演練參考。
- Windows `pnpm start` 的 standalone dependency link 出現 EPERM。本地以已 build 的 `next start` 驗收，保留 standalone 警告；不能把它稱為 standalone 容器驗收。
- 原有 Starlette/httpx deprecation 及 ADK AFC 建議訊息不影響上述結果；未改 SDK 或依賴。
