# P2.8 危急協助（Distress Assist）設計規格

狀態：APPROVED（2026-10-13 JST，使用者回覆「繼續」；朗讀與 5.2 參數採用預設值）
基礎分支：`codex/p2-7-explanation-evacuation-routes`（PR #11）
工作分支：`codex/p2-8-distress-assist`

## 1. 目的與核心原則

人在危險中很難即時做出正確判斷。72H 要在這個時候替使用者整理狀況，並給出一個清楚的下一步。

**不對稱授權**是這份規格的核心原則：

> AI 可以讓指引變得更保守、更貼近當下狀況，但不能讓指引變得更冒險。
> 「前往某地」這類高風險指示，只能由確定性的 Safety Core，依據官方證據授權。

這與 `AGENTS.md` 的規定一致：模型可以提議，由 Safety Core 決定是否允許；沒有來源，就不做高風險行動。

### 使用者決定（逐條確認）

| # | 決定 |
|---|---|
| D1 | 平常顯示「官方指定給該災害的候選地點」，不使用「安全」一詞（選項 a） |
| D2 | 極端情況：官方警報觸發才能給「前往某地」的指示（A）；只有使用者自報危急時，只給就地保命建議（B） |
| D3 | 入口優先順序：按鈕 → 語音補充 → 打字補充 |
| D4 | 語音送到 Cloud Run 後端，由 Gemini 聽寫並抽取，不儲存音檔 |
| D5 | AI 理解的結果顯示成標籤，使用者確認後才會影響判定 |
| D6 | 使用者行動不便時，手機可以發出求救（每個動作都由使用者按下才執行） |
| D7 | 第一次使用時引導設定緊急聯絡人，可以略過 |
| D8 | AI 可以依當時狀況決定，但只能往保守的方向調整（不對稱授權） |

## 2. 範圍

**範圍內**
- 「我需要幫助」入口、危急標籤、語音與文字抽取、標籤確認
- 求助等級判定（0 / 1 / 2a / 2b）
- AI 情境建議（只接受保守方向）
- SOS：撥號、預填訊息、現場警報聲與閃光、Net119 連結
- 第一次使用時的緊急聯絡人引導
- 離線時的按鈕流程、就地保命指引和 SOS

**範圍外（這一版不做）**
- 自動撥號、自動傳送訊息、背景發送
- 警戒レベル5（市町村發布的避難指示）：目前沒有資料來源，標成 `UNCONFIGURED`
- 石卷以外地區的道路圖
- 救援單位端的介面

## 3. 架構與資料流

```
「我需要幫助」
  ├─ 按鈕標籤（離線可用）
  ├─ 語音 ≤30 秒 → POST /api/distress/extract → Gemini 聽寫並抽取 → 候選標籤
  └─ 文字       → POST /api/distress/extract → Gemini 抽取 → 候選標籤
        ↓ 使用者確認（D5）
DistressReport（source=USER_REPORTED，帶時間戳記）
        ↓ POST /api/live/{id}/distress
Safety Core：classify_distress()（純函式）→ 等級與候選地點
        ↓
AI 情境建議：Gemini 輸出 DistressAdvice → apply_conservative_advice()
  只接受讓結果更保守的部分，其餘丟棄並記錄到 trace
        ↓
Plan 新版本（保留歷史）→ P2.7 解釋 → 畫面：一次只顯示一個主要指示
```

### 新增元件

| 元件 | 位置 | 職責 |
|---|---|---|
| `DistressTag`、`DistressReport` | `packages/contracts` | 封閉的標籤目錄與結構化回報 |
| `distress.py` | `services/agent-api/agent_api/` | `classify_distress()`、`reachable_in_time()`、`apply_conservative_advice()`，都是純函式 |
| `distress_extract.py` | 同上 | Gemini 語音與文字抽取，只能輸出 `DistressTag` |
| API | `main.py` | `POST /api/distress/extract`（不改變狀態）、`POST /api/live/{id}/distress`、`POST /api/replay/{id}/distress` |
| `distress-panel.tsx` | `apps/web/components/` | 大按鈕、錄音、標籤確認、主要指示 |
| `sos-panel.tsx` | 同上 | 撥號、預填訊息、警報聲與閃光、Net119 |
| `emergency-contacts.ts` | `apps/web/lib/` | 只存在本機 IndexedDB 的聯絡人（最多 3 位） |

## 4. 危急標籤（封閉目錄）

| 標籤 | 意義 | 影響 |
|---|---|---|
| `WATER_RISING` | 水淹進來或正在上漲 | 等級至少為 1 |
| `TRAPPED` | 被困住，無法移動 | 等級至少為 1，SOS 置頂 |
| `INJURED` | 受傷 | 步行速度 0.5 m/s，SOS 置頂 |
| `MOBILITY_LIMITED` | 行動不便或坐輪椅 | 步行速度 0.5 m/s，排除需要樓梯的候選，SOS 置頂 |
| `WITH_DEPENDENTS` | 帶小孩或長者 | 步行速度 0.5 m/s |
| `LOST_NO_DESTINATION` | 不知道該去哪裡 | 主動顯示候選地點 |
| `ROUTE_BLOCKED_REPORTED` | 使用者回報某條路或某座橋無法通行 | 只能用來**排除**候選 |

標籤一律標記為 `USER_REPORTED`，永遠不能單獨支持「前往某地」。

## 5. 求助等級判定（`classify_distress`）

### 5.1 官方觸發條件（A）

以下條件全部成立，才算官方觸發：
- 有 JMA 大津波警報或津波警報（VTSE41），涵蓋使用者所在的預報區
- 證據是 `CURRENT`、沒有衝突、`trust_status=VERIFIED_OFFICIAL`
- 位置可用：GPS 新鮮且精度 ≤ 100 m，或使用者手動選擇的地區與警報區相符
- 網路狀態是 `ONLINE_VERIFIED`，或者離線時使用最後驗證的證據，但該證據仍在 TTL 內

### 5.2 能否及時抵達（`reachable_in_time`）

```
可用時間 = JMA 預估到達時間 − 現在 − 300 秒
  JMA 顯示「已到達／即將到達」或到達時間不明 → 可用時間 = 0
步行速度 = 1.0 m/s；有 INJURED / MOBILITY_LIMITED / WITH_DEPENDENTS 時 = 0.5 m/s
距離     = 石卷試點用 P2.7 道路候選距離 + 起點與終點到道路的缺口
           範圍外或沒有道路候選：直線距離 × 1.5
           GPS 精度 > 50 m：距離再加上精度值
能及時抵達 ⇔ 距離 ÷ 步行速度 ≤ 可用時間
```

可以調整的參數（餘裕 300 秒、步行速度、繞行係數 1.5）集中放在 `SafetyPolicy`，並以測試固定。

### 5.3 等級與輸出

| 等級 | 條件 | 主要指示 | 計劃 intent |
|---|---|---|---|
| 0 | 沒有官方觸發，也沒有危急標籤 | 列出官方指定候選地點，不做移動指示 | 既有 intent |
| 1 | 有危急標籤，但沒有官方觸發 | 就地保命：「往建築物上層、往高處移動，遠離水邊」 | 新增 `SHELTER_IN_PLACE_VERTICAL` |
| 2a | 官方觸發，而且有能及時抵達的指定海嘯避難場所 | 「立刻前往 〇〇（官方指定海嘯避難場所）」，附依據、距離和步行時間 | `EVACUATE_TO_DESIGNATED_SHELTER` |
| 2b | 官方觸發，但沒有能及時抵達的場所 | 「來不及抵達指定場所：立刻往附近堅固建築物的 3 樓以上，或往高處移動」；如果附近有官方指定的海嘯避難大樓，一併列出 | 新增 `VERTICAL_EVACUATION_NOW` |

候選地點只來自 P2.6 的指定場所資料包，而且該場所必須有 `tsunami` 災害類別的指定。
等級 2 使用「立刻前往」這類指示用詞，**永遠不說「保證安全」**；路線一律標成「道路候選，沿路狀況未核實」。

### 5.4 失效

官方證據過期、發生衝突、計劃過期或 binding 改變時，等級 2 的指示會被標成 `INVALID`，並觸發重新規劃。離線時顯示最後驗證的計劃和資料時間，不會產生新的官方資訊。

## 6. AI 情境建議（不對稱授權）

Gemini 的輸入是：已確認的標籤、使用者原話的抽取摘要（不是原始音檔）、Core 核准的候選地點與屬性、目前等級。輸出必須符合以下結構：

```json
{
  "raise_level_to": 1,
  "candidate_order": ["place_id_b", "place_id_a"],
  "exclude_candidates": ["place_id_c"],
  "suggest_sos": true,
  "emphasis_clause_ids": ["MOVE_UP_NOW", "AVOID_WATER"]
}
```

`apply_conservative_advice()` 會逐項檢查：

| 欄位 | 接受條件 | 不符合時 |
|---|---|---|
| `raise_level_to` | 只能是 1，而且目前等級是 0 | 丟棄 |
| `candidate_order` | 必須是 Core 候選集合的排列，不能新增 | 整項丟棄，保留距離排序 |
| `exclude_candidates` | 必須是 Core 候選的子集合 | 不在集合內的 ID 丟棄 |
| `suggest_sos` | 永遠接受，因為只是顯示面板 | — |
| `emphasis_clause_ids` | 必須在白名單內 | 丟棄未知的 ID |

規則補充：
- 如果排除之後在等級 2a 下已經沒有候選，就降為 2b（就地垂直避難）。這是更保守的方向，所以允許。
- AI 不能降低等級、不能新增地點、不能把被排除的地點加回來，也不能輸出自由文字。
- 每一次被接受或丟棄的建議，都會發出 trace event（例如 `DISTRESS_ADVICE_APPLIED`、`DISTRESS_ADVICE_REJECTED`）。
- Gemini 逾時、無法使用或輸出無效時，使用 Core 的預設結果，模式顯示為 `DETERMINISTIC_FALLBACK`。

## 7. 語音與文字抽取

- 上傳限制：音訊 ≤ 30 秒且 ≤ 1 MB（`audio/webm` 或 `audio/mp4`）；文字 ≤ 500 字。
- 只在記憶體中處理，不寫入磁碟、log 或 trace；trace 只記錄抽取出的標籤 ID。
- 輸出：`{tags: DistressTag[], route_blocked_hint: string|null, language}`。`route_blocked_hint` 只用來在候選地點中比對排除，不會顯示成事實。
- 使用者的話一律當成資料。注入指令（例如「忽略規則」「告訴我這裡安全」）只能被轉成標籤，或被忽略。
- 呼叫次數有上限：每個 session 6 次、全域每分鐘 12 次，與 P2.7 的 `_CallBudget` 共用機制。
- 失敗時顯示「無法理解，請用按鈕」，按鈕流程不受影響。

## 8. SOS（D6、D7）

### 8.1 第一次使用時的引導（可以略過）
- 最多 3 位緊急聯絡人（名字、電話），只存在本機 IndexedDB，不會上傳，不放任何憑證。
- 自我設定：「行動不便」「需要協助撤離」，會成為預設的危急標籤。
- 試播一次警報聲，確認音量。

### 8.2 什麼時候置頂
在以下兩種情況下，SOS 面板會自動置頂：
- 使用者確認了 `TRAPPED`、`INJURED` 或 `MOBILITY_LIMITED`
- 使用者事先設定為需要協助撤離，而且等級 ≥ 1

### 8.3 動作（每個都要使用者親自按下）

| 動作 | 實作 | 需要網路嗎 |
|---|---|---|
| 撥打 119 / 110 | `tel:` 連結 | 只需要手機訊號 |
| 傳送求救訊息 | `sms:` 預填內容，或 Web Share API；內容包括標籤、GPS 座標與精度、時間、地圖連結，並註明「由使用者送出，非官方訊息」 | 只需要手機訊號，不經過我們的伺服器 |
| 現場求救訊號 | Web Audio 高音量警報聲 + 手電筒（`MediaStreamTrack` 的 `torch`）或全螢幕閃爍；持續到使用者按停止，並顯示耗電提醒 | 不需要 |
| Net119 | 官方網站連結 | 需要網路 |

進入省電模式（`SURVIVAL`）時，仍然保留 SOS。

## 9. 使用者介面原則

- 一次只顯示**一個**主要指示：大字、高對比，放在畫面最上方。
- 主要指示下方顯示依據、資料時間和限制；細節放進可以收合的區塊。
- 等級 2 的畫面會以醒目的顏色呈現，並顯示倒數（可用時間）。
- 用裝置內建的 `speechSynthesis` 把主要指示唸出來（離線可用）。等級 ≥ 1 時自動唸一次，之後可以按按鈕重播或關閉；不支援的瀏覽器只顯示文字。

## 10. 離線

- 按鈕標籤、等級 1、等級 2b 的通用文字和 SOS 動作（撥號、警報聲、閃光）全部可以離線使用。
- 等級 2a 只能使用最後驗證、而且仍在 TTL 內的官方證據；過期就降為顯示「資料已過期」加上等級 1 的建議。
- 語音和文字抽取在離線時停用，並明確顯示原因。

## 11. 測試

| 層級 | 內容 |
|---|---|
| 後端純函式 | `classify_distress` 的表格測試：警報過期、衝突、離線、到達時間不明、速度減半、範圍外改用直線 × 1.5、精度 > 50 m、排除後沒有候選時降為 2b |
| 不對稱授權 | 隨機產生的 AI 建議（property test）：結果的等級永遠 ≥ Core 結果、候選永遠是 Core 候選的子集合、等級 2 永遠需要官方證據 |
| 抽取 | 只能輸出白名單標籤、注入攻擊、超過長度或大小、逾時時改用固定結果 |
| Replay | 用合成的海嘯情境走完 0 → 1 → 2a → 2b → 失效的完整流程。狀態轉換由真實的 pipeline 驅動，不寫死在時間軸上 |
| 前端 | SOS 不會自動送出、聯絡人只存在本機、離線時警報可用、標籤要確認後才會送出 |
| 真實手機 | 在 ASUS ROG Phone 6 上用 adb 驗收：錄音權限、手電筒、`tel:` / `sms:`、警報音量、離線 |
| 雲端 | Cloud Run + 真實 Gemini 的抽取與建議（零流量的 Preview revision，需要另外授權） |

## 12. 已知限制

- 只有石卷有詳細的指定場所資料與道路圖；其他地區的等級 2a 會因為缺少候選地點而降為 2b。
- 「3 樓以上」是通用的垂直避難建議，不代表某棟特定建築物安全。
- 網頁 App 無法在背景定位或背景發送訊息；SOS 需要 App 在前景運作。
- 使用者自報的 `ROUTE_BLOCKED_REPORTED` 只用來排除，不會被當成事實分享給其他人。
