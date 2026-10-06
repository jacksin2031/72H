# 72H vNext — Adaptive Dynamic UI Update Specification

> Status: DESIGN / IMPLEMENTATION SPEC
> Date: 2026-10-05 JST
> Target: post-vNext P0 consumer UI refinement
> Core principle: **畫面只顯示完成「目前下一步安全行動」所必需的資訊。**

## 1. 背景

目前 vNext P0 已完成 Map-first、Severity、Notification、Power、Life Protection、Offline Map 等核心能力，但 Consumer Home 仍然同時展示過多系統狀態、地圖、通知、定位、電力、離線資訊與測試資訊。

結果係功能完整，但資訊密度接近 dashboard / control panel，而唔似一般使用者會長期使用的手機 App。

下一階段 UI 方向不是單純「刪除功能」，而係引入 **Adaptive Dynamic UI（動態情境介面）**：

- 平常情況只顯示最少資訊；
- 當 Safety Core 判斷某項資訊對下一步行動有實際價值時，先展示對應 UI；
- Map、Route、Location、Safety Check、SOS、Power 等都不再永久常駐；
- UI 會跟隨目前安全狀態和行動需要改變。

## 2. 核心產品原則

72H 的 Home 不再是一個固定版面的 dashboard。

新定義：

> **Home = Current Situation Renderer**

Home 根據目前 Situation、Plan、Safety Core 結果與裝置狀態，選擇最少必要元件組合。

重要：**Gemini / LLM 不可以直接決定 UI。**

正確流程：

```text
Evidence
  ↓
Situation
  ↓
Gemini / ADK proposes bounded intent / candidate plan
  ↓
Deterministic Safety Core validates / decides
  ↓
Current Action + Plan State
  ↓
Deterministic UI Policy
  ↓
Adaptive Home
```

Gemini 可以影響候選行動，但 UI 顯示權由 deterministic policy 根據已批准的安全狀態決定。

## 3. 目標

1. 將一般 Home 由「資訊總覽」變成「下一步行動介面」。
2. 平常情況可以只顯示文字，不顯示 Map。
3. 只有當空間資訊對下一步有價值時先顯示 Map。
4. 只有當需要移動時先顯示 Route / Destination。
5. 只有真正 Critical + eligible 時先顯示 Safety Check。
6. 低電量時自動減少 UI 元件與渲染成本。
7. Demo / Judge / Trace / Evidence 等完整資訊仍然保留，但不干擾 Consumer Home。
8. 所有隱藏資訊仍可由使用者主動查看。

## 4. 非目標

本次 UI 更新不等於：

- 重新設計 Safety Core；
- 讓 LLM 自由生成 UI；
- 自動將 L4 等同 EVACUATE；
- 因為有 Map 就暗示使用者應該移動；
- 宣稱 Map route = safe route；
- 新增 Live JMA、Push、Rescue Beacon 或 Native background service；
- 刪除 Judge / Demo 所需的技術資訊。

## 5. Consumer Home 最小模型

正常狀態下 Home 只應該包含：

```text
72H                         🔔

● Monitoring
簡短狀態描述

NOW
目前最重要的一件事

[查看詳情]

Home      Plan      More
```

平常不應固定顯示：

- 大型 Severity 卡；
- Plan version 卡；
- Map；
- Location permission 卡；
- Notification list；
- Power selector；
- Offline memo；
- Source list；
- Replay / Trace；
- Demo controls。

以上全部改為事件觸發或 secondary surface。

## 6. Adaptive Presentation Modes

建議新增 deterministic presentation mode：

```ts
type PresentationMode =
  | 'TEXT_ONLY'
  | 'TEXT_WITH_DETAILS'
  | 'MAP_ASSISTED'
  | 'SAFETY_CHECK'
  | 'EMERGENCY_PROTECT'
  | 'SURVIVAL';
```

建議 projection：

```ts
type PresentationProjection = {
  mode: PresentationMode;
  primaryActionText: string;
  secondaryText?: string;
  showMap: boolean;
  showRoute: boolean;
  showDestination: boolean;
  showLocation: boolean;
  showNotificationsBadge: boolean;
  showEvidenceInline: boolean;
  showSafetyCheck: boolean;
  showPowerWarning: boolean;
  reasonCodes: string[];
};
```

此 projection 必須由 deterministic UI Policy 產生，不接受 LLM 直接回傳任意 boolean 控制畫面。

## 7. 狀態 → UI 對應

| Current Action / State | 建議模式 | 預設 UI |
|---|---|---|
| NORMAL | TEXT_ONLY | 簡短狀態 + NOW |
| MONITOR | TEXT_ONLY | Monitoring + NOW |
| PREPARE | TEXT_WITH_DETAILS | NOW + 可展開準備事項 |
| SHELTER_IN_PLACE | EMERGENCY_PROTECT | 大型保護指示；Map 預設隱藏 |
| EMERGENCY_PROTECT | EMERGENCY_PROTECT | 全屏/高優先指示；Map 隱藏 |
| EVACUATE | MAP_ASSISTED | 指示 + Destination + Map + Route state |
| NEEDS_ASSISTANCE | SAFETY_CHECK | Safety / Help controls |
| CANNOT_MOVE | SAFETY_CHECK | Help / SOS guidance，避免顯示不適用移動 route |
| SURVIVAL power mode | SURVIVAL | NOW + SOS + Last Known Location + 最低限度資訊 |

注意：Severity 與 Presentation Mode 不可一對一綁定。

例如：

```text
L4 + SHELTER_IN_PLACE → EMERGENCY_PROTECT，Map 隱藏
L4 + EVACUATE          → MAP_ASSISTED，Map 顯示
L2 + no movement       → TEXT_ONLY / TEXT_WITH_DETAILS
```

## 8. Map 顯示規則

Map 改為 **on-demand / action-driven component**。

### 8.1 自動顯示條件

Map 可以自動展示，只有當以下至少一個條件成立，而且 Safety Core 允許對應行動：

- current action 需要移動；
- 已有 verified / eligible destination；
- route candidate 對目前行動有價值；
- route dependency 發生變化，需要使用者理解位置影響；
- hazard / blocked area 與目前位置直接相關；
- 使用者需要比較当前位置與 safe destination。

### 8.2 不應自動顯示

- NORMAL / MONITOR 而沒有移動需要；
- 強震期間要求立即保護自己；
- SHELTER_IN_PLACE；
- 只有 route availability、但未完成安全驗證；
- destination 未被證實更安全；
- Map pack 存在但並無當前行動價值。

### 8.3 使用者仍可主動開啟

即使 policy 不自動展示 Map，使用者可以透過：

- `查看位置`
- `查看地圖`
- `查看路線`

主動進入 Map surface。

主動開啟 Map 不可以改變 Safety Core 決策，也不可以將未驗證 route 升級為推薦 route。

## 9. Map 與 Monitoring 的關係

不再將 `Monitoring` 設成一張獨立大型卡。

當 Map 顯示時，Situation status 可以整合到 Map header：

```text
● Monitoring   ✓ Verified 2m ago
[ map ]
```

或：

```text
⚠ Critical · Evacuate
[ map + destination + route state ]
```

當 Map 不顯示時，Monitoring 保留成精簡 Situation Header：

```text
● Monitoring
目前沒有需要立即移動的指示
```

## 10. NOW 作為核心 UI

任何 Presentation Mode 都必須保留單一主要 `NOW` action。

規則：

- 首屏最多一個主要 NOW；
- 不同類型行動不可同時競爭主視覺；
- NEXT / AVOID / Why / Evidence 預設折疊；
- invalid / expired action 不可作為 NOW；
- NOW 文字以人類可理解指示為主，不展示內部 policy jargon。

例如：

```text
NOW
請留在安全位置，注意落下物，並等待已確認的官方更新。
```

而非：

```text
L4 / PREPARE / ONLINE_VERIFIED / POLICY_OK
```

## 11. Progressive Disclosure

資訊分三層：

### Level 1 — Immediate

首屏只展示：

- Situation summary；
- NOW；
- 必要時 Map / Safety Check / SOS；
- notification badge；
- bottom navigation。

### Level 2 — On demand

使用者展開後才展示：

- NEXT；
- AVOID；
- Why；
- evidence summary；
- last verified time；
- route state；
- alternative destination。

### Level 3 — Technical / Judge

只在 More / Demo / Judge Mode：

- Agent Trace；
- Replay controls；
- raw evidence IDs；
- source authority details；
- plan version internals；
- developer diagnostics。

## 12. Notification UI

Notification history 不再長駐 Home。

Home 只保留：

```text
🔔 3
```

只有 IMPORTANT / CRITICAL 且與下一步行動有直接關係時，才可短暫顯示 inline alert。

例如：

```text
⚠ Plan updated
交通依賴狀態已改變。
[查看]
```

完整 inbox 放入 Notification surface。

保持既有安全規則：

- No verified state change → no action-changing notification；
- NETWORK_RESTORED ≠ VERIFICATION_RESTORED；
- stale / unverified evidence 不可觸發 Critical 行動提示。

## 13. Location UI

Location permission / Last Known Location controls 不再固定佔用 Home。

平常隱藏。

只有以下情況先顯示：

- Action 需要位置判斷；
- 使用者主動按「查看目前位置」；
- Map-assisted flow 需要当前位置；
- Safety / SOS flow 需要向使用者展示 Last Known Location。

建議 permission flow：

```text
使用你的位置？

72H 可以用目前位置判斷與你相關的災害資訊。

[暫時不要]
[只使用一次]

□ 在此裝置保存最後已知位置
```

保存 consent 與 browser geolocation permission 必須繼續分離。

## 14. Power UI

Power mode 不再永久展示 selector。

NORMAL 狀態：Home 不顯示 power card。

只有狀態改變時提示：

```text
🔋 Battery saver
```

或：

```text
⚠ Emergency power mode
```

完整 power controls 移至：

```text
More → Battery & Power
```

SURVIVAL 仍然可以覆蓋普通 adaptive layout，進入最小化畫面。

## 15. Safety Check / Life Protection UI

Safety Check 平時完全隱藏。

只有：

- prior consent 已存在；
- fresh location-relevant critical event；
- Safety Core / existing deterministic eligibility 通過；

先顯示高優先介面：

```text
你安全嗎？

[我安全]
[我需要協助]
[我暫時無法移動]
```

保持既有語義：

- silence → `UNRESPONSIVE_UNKNOWN`；
- silence 不等於 confirmed danger；
- 不因無回覆自行宣稱已 dispatch rescue；
- PWA 不宣稱 guaranteed background delivery。

## 16. Route / Destination UI

Route 只有在 `MAP_ASSISTED` 或使用者主動要求時顯示。

需要同時清晰區分：

- candidate route；
- affected / needs verification；
- blocked；
- verified usable candidate。

Route availability != route safety。

如果只收到交通 API 可用結果，但缺乏災害 / route safety evidence：

```text
路線候補
仍需確認災害影響
```

不可顯示：

```text
安全路線
```

除非現有 Safety Core contract 真正支持該表述。

## 17. UI Transition Rules

Adaptive UI 轉換必須穩定，避免資料每次更新都令整頁跳動。

建議：

- Presentation Mode 只因安全狀態、行動需求或 power class 的實質改變而切換；
- minor evidence refresh 不重排主介面；
- 同一 mode 內只更新文字 / timestamp / status；
- MAP_ASSISTED → TEXT_ONLY 必須保留足夠過渡說明，避免地圖突然消失令人誤解；
- Critical mode transitions 不使用長動畫；
- Power saving / emergency mode 停止非必要 animation。

## 18. 建議 deterministic UI Policy

示意規則：

```text
if power == SURVIVAL:
    mode = SURVIVAL
else if safety_check_required or help_state active:
    mode = SAFETY_CHECK
else if current_action in [EMERGENCY_PROTECT, SHELTER_IN_PLACE]:
    mode = EMERGENCY_PROTECT
else if current_action == EVACUATE
     and destination is eligible
     and movement is authorized:
    mode = MAP_ASSISTED
else if current_action == PREPARE:
    mode = TEXT_WITH_DETAILS
else:
    mode = TEXT_ONLY
```

Map visibility 再由：

```text
showMap =
  mode == MAP_ASSISTED
  OR user explicitly opened map
```

Route visibility：

```text
showRoute =
  showMap
  AND route candidate exists
  AND route presentation is allowed by Safety Core
```

## 19. Component 結構建議

```text
AdaptiveHome
├─ SituationHeader
├─ PrimaryNowAction
├─ ConditionalMapSurface
│  ├─ LocationMarker
│  ├─ DestinationMarker
│  ├─ RouteState
│  └─ HazardOverlay (future)
├─ ConditionalSafetyCheck
├─ ConditionalPowerWarning
├─ ExpandableActionDetails
│  ├─ NEXT
│  ├─ AVOID
│  └─ Why / Evidence
├─ NotificationBadge
└─ BottomNavigation
```

Consumer Home 不直接 mount Demo / Trace / full Notification Inbox / full Power controls。

## 20. Acceptance Criteria

本更新完成時至少要滿足：

1. NORMAL / MONITOR 狀態 Home 首屏沒有 Map。
2. NORMAL / MONITOR 首屏沒有大型 plan、location、power、notification-history cards。
3. SHELTER_IN_PLACE / EMERGENCY_PROTECT 預設不顯示 Map。
4. verified movement action 可以切換到 MAP_ASSISTED。
5. MAP_ASSISTED 顯示 destination 與 route state，但不把 route availability 誤稱 safe route。
6. Map 仍可由使用者主動開啟。
7. Safety Check 平時完全隱藏，只有 eligible event 先出現。
8. Notification history 移出 Home，只留下 badge / actionable alert。
9. Power card 平時隱藏，CONSERVE / EMERGENCY / SURVIVAL 才提升可見度。
10. `NETWORK_RESTORED` 不可以造成已重新驗證的 UI 假象。
11. offline / stale 狀態仍顯示 last verified / stale wording。
12. Consumer Home 不顯示 Agent Trace / Replay controls。
13. Judge Mode 可繼續查看完整 trace、replay、evidence、plan internals。
14. Desktop / mobile 都保持 keyboard / screen-reader 可操作。
15. 既有 Safety Core、69 backend tests、77 frontend tests不可 regression；需要新增 Adaptive UI policy tests。

## 21. 必要測試案例

至少新增：

- MONITOR → TEXT_ONLY；
- PREPARE → TEXT_WITH_DETAILS；
- L4 + SHELTER_IN_PLACE → EMERGENCY_PROTECT 且無 Map；
- L4 + EVACUATE + eligible destination → MAP_ASSISTED；
- EVACUATE 但 destination unverified → 不自動 Map-assisted movement recommendation；
- route available but unverified → candidate wording；
- user manually opens Map under MONITOR → Map 顯示，但 Safety decision 不變；
- network lost → cached action + stale state；
- physical reconnect only → RECONNECTING，不顯示 verified recovery；
- Safety Check eligible / ineligible；
- NORMAL battery → power controls hidden；
- EMERGENCY_POWER → noncritical surfaces reduced；
- SURVIVAL → minimal UI；
- notification badge / inbox separation；
- mobile viewport 首屏資訊密度驗收。

## 22. Release Strategy

此更新屬 UI / presentation architecture 改動，應避免同 Live JMA、Push、Rescue Beacon 等大型功能同一 release 一次導入。

建議：

```text
Phase A — Adaptive UI Policy + Consumer Home
Phase B — Map-assisted route experience
Phase C — Live source integration
Phase D — Push / Rescue / real-device validation
```

每個 Phase 都要保持 production baseline 可回退。

## 23. 最終產品準則

72H 的介面不應問：

> 「我們有什麼資料可以顯示？」

而應該問：

> **「使用者完成目前下一步安全行動，最少需要看到什麼？」**

因此：

- 不需要移動 → 文字優先；
- 需要準備 → 文字 + 可展開細節；
- 需要留在原地保護 → 強化文字，不用 Map；
- 需要移動到較安全地方 → 文字 + Map + destination / route state；
- 需要確認人身安全 → Safety Check；
- 電量極低 → Survival UI。

這是本次 Adaptive Dynamic UI 更新的最高優先設計原則。

## 24. Dark-first / Battery-aware Visual Theme

Adaptive UI 的 Consumer Mode 改為 **Dark-first**。目的除了降低災害環境中的視覺刺激，也要在支援 OLED / AMOLED 的手機上降低畫面功耗；LCD 裝置的節電效果有限，因此不能把暗色主題宣稱為所有裝置都能明顯延長續航。

### 24.1 預設視覺策略

- Consumer Home 預設使用深色背景，不再以大面積白色卡片為主；
- 一般背景使用接近黑色的低亮度色階，避免大量高亮區域；
- NORMAL / MONITOR 狀態保持低對比、低刺激，但文字對比必須符合可讀性要求；
- 重要狀態使用局部色彩提示，不把整個畫面改成高亮紅／橙；
- Map 只有在 UI Policy 判定需要時才 mount / render；隱藏 Map 時不應在背景持續進行不必要渲染；
- 動畫、陰影、漸變及持續更新效果應盡量減少，CONSERVE 以上模式停用非必要動畫。

### 24.2 Power Mode 與 Theme

```text
NORMAL
→ Dark-first UI
→ 必要的輕量動畫可保留

CONSERVE
→ 更低亮度視覺層級
→ 停止裝飾動畫 / transition
→ 減少 Map repaint

EMERGENCY_POWER
→ 接近純黑背景
→ 只保留 NOW / critical status / required controls
→ Map 僅在移動決策真正需要時短暫顯示

SURVIVAL
→ Pure / near-black minimal UI
→ 大字、高對比、靜態
→ NOW / SOS / last known location / essential timestamps only
```

### 24.3 OLED 與 LCD 邊界

- OLED / AMOLED：較暗像素通常可降低顯示功耗，純黑區域最有利；
- LCD：背光仍然運作，暗色 UI 本身未必帶來明顯節電；
- 所以真正跨裝置的省電仍然依賴：降低螢幕亮度、減少 Map/GPU rendering、減少動畫、降低 GPS / network refresh、減少 background work；
- 72H 不應對外宣稱「Dark Mode 必定節省 X% 電量」，除非完成真實裝置測試。

### 24.4 Accessibility / Safety

Dark-first 不可以犧牲可讀性：

- 文字與背景保持足夠 contrast；
- CRITICAL / warning 不只靠顏色區分，要同時使用文字、圖示及狀態標籤；
- 戶外強光環境需要提供足夠亮度與高對比 fallback；
- 使用者可在設定中選擇 System / Dark / High Contrast；
- EMERGENCY_PROTECT / EVACUATE 等高風險狀態優先可讀性，而不是極端省電。

### 24.5 新增驗收要求

Adaptive UI acceptance 追加以下條件：

- Consumer Home 預設為 Dark-first；
- 大面積白色 panel 不應重新成為主要版面；
- MONITOR + TEXT_ONLY 畫面可在無 Map 情況下保持完整可用；
- MAP_ASSISTED 結束後 Map 可 unmount，而不是只用 CSS 隱藏後持續渲染；
- CONSERVE / EMERGENCY_POWER / SURVIVAL 不存在非必要動畫；
- SURVIVAL 使用純黑或接近純黑的最小 UI；
- dark theme 下所有 safety status、buttons、links、focus states 通過可讀性與鍵盤操作驗收；
- 真實裝置 battery test 未完成前，文件只描述「節電設計目標」，不描述未驗證的續航百分比。

因此 Adaptive Dynamic UI 的視覺原則更新為：

> **只顯示當前安全行動所需要的內容，並以 Dark-first、低渲染成本、低視覺噪音的方式呈現。**
