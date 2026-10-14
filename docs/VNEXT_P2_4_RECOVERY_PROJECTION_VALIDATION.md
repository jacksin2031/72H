# P2.4 C／D — 官方來源恢復與資訊投影

日期：2026-10-12 JST。基線：`c681df7`；分支：`codex/p2-4-recovery-projection`。

**本地實作及驗證：COMPLETE。完整 P2.4–P2.7 計劃仍為 PARTIAL。**
本紀錄是 C／D 的有界交付，承接 A／B 生命週期；沒有部署、production、實機或當前災害安全驗收。
GCS 是已實作及契約測試的 adapter，沒有真實 ADC／bucket 驗證。

## 儲存與補抓

- 預設官方來源使用 SQLite checkpoint、不可變 SHA-256 原文及去重索引。保存與 checkpoint CAS
  在同一交易完成；失敗或落後 writer 不會前移已提交狀態。重啟重新解析保存原文，比對 envelope。
- 長期 feed 啟動／每小時掃描；輪詢中斷超過 **應用程式設定的 300 秒**亦重新長掃。
  這是保守的連續性限制，並非 JMA 投遞保證。每輪最多五份 detail，pending queue 跨輪詢及重啟續跑。
  已處理的同一 entry signature 不會在長掃時重新填滿 queue；新 snapshot 的舊 URL audit
  只在 recovery queue 為空時輪替，亦最多五份。不能保證偵測 publisher 未更改 Atom entry 的每次原文變動。
- `last_verified_at` 是已排空的長期 feed **發表時間**。short-only／304 接收不能刷新它。
  中斷後等待發表時間不早於恢復時刻的新長期 snapshot；304 只能重用原始 representation。
  Atom 時間不作電文修訂排序或完整投遞 watermark；排序仍依 detail `Control.DateTime`。
- 長期 feed 只保留數日；舊 checkpoint 落在所見窗口之外、空恢復窗口、來源失敗、未排空及
  保存失敗都保持明確的 GAP／SCANNING／UNKNOWN。沒有把空 feed 當成沒有警報。
- 分開輸出來源連線、最新成功接收、已提交查詢時間、官方發表時間、窗口核實時間與災害有效性。
  失敗只顯示 exception 類別，不洩露 provider／ADC 詳細訊息；有界退避 5–300 秒。
- 限制：feed 1 MB、detail 2 MB、queue 1,024、每產品 archive 4,096、checkpoint 8 MB、
  raw archive 64 MB。SQLite 會清理不再引用的 feed bytes，保留全部 report 原文。
- `JMA_JOURNAL_BUCKET` 啟用 GCS（runtime identity／ADC），`JMA_JOURNAL_PATH` 可指定 SQLite。
  Cloud Run 未設定 durable store 時明示 MEMORY／UNCONFIGURED，不宣稱跨實例持久化。
  GCS v2 namespace 先對共用 byte budget 做 generation CAS，再保存原文及 CAS checkpoint；
  孤兒原文／失敗預留同樣計入 64 MB／16,384 object 上限。**不做線上刪除**，避免刪除其他 writer
  尚需引用的原文。滿額失敗關閉，需操作員另行存檔／遷移；未實作自動容量輪替。

## Safety Core 與 API／UI

- 同步／非同步 Live 都使用既有 evidence pipeline 與版本化 plan history。
  地震及海嘯任一 recovery 未完成，session 不能顯示 ONLINE_VERIFIED；已有 reconnect barrier
  時保持 RECONNECTING。CoreState readiness gate 先阻止解除 barrier，再逐群核實原有要求。
  Python 與 Zod 契約亦拒絕 ONLINE_VERIFIED 搭配未完成 recovery。
- `LiveSnapshot.official_sources` 列出兩種來源；`official_reports` 保留受限的原文參考紀錄。
  海嘯 reference API 亦提供 recovery／原文紀錄。舊快照的新增欄位有空值／空陣列預設。
- 參考資料綁定該 session 已處理的來源結果；別的 session／reference 查詢刷新共用來源，
  不會偷偷改寫此 session 的 Safety Core 投影。原文參考固定 REFERENCE_ONLY、eligible_for_action=false。
- `/sources` 的中文／日文／英文顯示來源、系統發表／業務報告／首次接收、年齡、區域代碼、
  CURRENT／STALE／WITHDRAWN／SUPERSEDED／CONFLICT／UNKNOWN、官方期限、應用期限、最後核實及限制。
  尚未映射的區域代碼不宣稱某地安全；離線／重連及本地期限到達時不保留 CURRENT。
- 撤銷資訊單位不表示區域警報解除。expiry 只變 STALE／UNKNOWN，不建立 RESOLVED 或移動授權。
  LIVE／REPLAY 來源與快照仍隔離；Gemini／ADK、Cloud Run 與既有 mobility adapter 邊界保留。

## 真實來源驗收發現與修正

1. VXSE53 包含「遠地地震に関する情報」，可沒有日本震度 Observation。
   現在只在這個確切 Head.Title 且觀測缺失時保留 empty scope 的官方參考紀錄；
   一般地震報文缺觀測仍拒絕。沒有觀測區域不會建立日本災害事件／證據。
2. A／B 將 VTSE41 一律排除 ValidDateTime 是誤讀。2026 header 表 row 39 明示
   「若干海面變動」預報失效時間。現在僅接受發表且全部 current Kind code 71 的期限；
   warning／advisory 帶該期限仍拒絕。VXSE53 仍不接受 ValidDateTime。
   證據 deadline 採 `min(Control.DateTime + 900 秒, 官方預報期限)`，不延長 TTL 或自動解除災害。
   此規則套用 journal／legacy adapter、各區域聚合、reference 與 Live evidence／GET 投影。
   GET 不重新下載亦會按 Safety Core freshness projection 將公開 evidence 轉 STALE、事件轉 UNKNOWN，
   關閉 raw evidence 的高風險 eligibility；原始儲存紀錄與過往計劃版本不被重寫。

兩份原文未修改，來源 URL、取得日期、bytes 與 hash 記錄於 `tests/fixtures/jma_lifecycle/manifest.json`。
它們是離線回歸樣本，不是目前災害狀態證據。

## 驗證

- PASS：後端完整測試 270 個；其中新增 recovery suite 36 個。
- PASS：前端 330 個測試，3 個既有 skip；typecheck、Next.js build。
- PASS：secret-pattern／credential-file gate、`git diff --check`。
- PASS：獨立唯讀審核找出的 short-only 假核實、queue starvation、GCS 無界儲存及
  海嘯未完成卻 ONLINE_VERIFIED 已修正；永久 regression 覆蓋 reconnect＋海嘯 backlog。
- PASS：實際 JMA long feed／原文經 adapter 保存及投影；舊電文保持 STALE，首次接收不刷新 TTL。
  pinned 海嘯原文重取結果 STALE、28 個區域 UNKNOWN、eligible_for_action=false。
- 本地瀏覽器驗收：來源頁的 desktop／390 px 手機版；實際資料不全時顯示補抓／未核實，
  不把 HTTP 成功或原文存檔當成當前災害安全驗收。截圖位於 `.work/p24-source-*.png`。
  1280 px 及 390 px 的文件／卡片均沒有橫向溢出；真實 queue 排空後仍維持等待較新長期 snapshot。
- UNVERIFIED：真實 GCS／ADC、多實例雲端權限、長期容量遷移、production、實機背景／GPS。

重啟恢復的是官方 journal，**不是 Live 使用者 session**。既有 session store 仍是記憶體；
服務重啟後舊 session 明示不可重新核實。瀏覽器測試發現舊 session 的重新開始流程仍需獨立修正，
本包沒有重寫 session／profile 持久化或以快取掩蓋此限制。

## 官方來源

- [JMA PULL feed 更新、保留及服務限制](https://xml.kishou.go.jp/xmlpull.html)
- [JMA FAQ：長期 feed 保留限制](https://xml.kishou.go.jp/qanda.html)
- [現行 header/control 表：row 35 與 39](https://xml.kishou.go.jp/jmaxml_guide_20260129_head_control_list.pdf)
- [地震火山電文解説：預報 ValidDateTime](https://xml.kishou.go.jp/20121115_jmaxml_info_all.pdf)
- [GCS generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions)
- [RFC 4287 Atom updated](https://www.rfc-editor.org/rfc/rfc4287.html)
- [RFC 9110 304](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5)

下一個交付仍按原順序：P2.5 官方實際觀測粒度及海嘯幾何圖層，P2.6 分類指定場所，
P2.7 先 Safety Core、後 AI 解釋。這三階段尚未達成本計劃驗收門檻。
