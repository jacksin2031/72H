# UI redesign text audit (Task 6: distress / SOS)

Three-language parity kept (zh-TW / ja / en). Safety text that must survive is unchanged: official basis and data time, countdown, exercise label, AI-suggestion labels, offline "last verified" text, and exactly one "suggestion, not a guarantee" note.

| Location | Original | Action | New text |
|---|---|---|---|
| distressText.notGuaranteed (zh-TW), shown once under the primary block | 這是建議，不代表地點或路線一定沒有危險。請依現場狀況與官方指示判斷。 | shorten | 這是建議，不代表一定沒有危險。請依現場與官方指示判斷。 |
| distressText.notGuaranteed (ja) | これは提案です。場所や道に危険がないという意味ではありません。現地の状況と公式の指示で判断してください。 | shorten | これは提案です。危険がないという意味ではありません。現地と公式の指示で判断してください。 |
| distressText.notGuaranteed (en) | This is a suggestion. It does not mean the place or road is free of danger. Follow local conditions and official instructions. | shorten | This is a suggestion, not a guarantee of safety. Follow local conditions and official instructions. |
| Disclaimer element in DistressPanel | `<small>` inside the primary block | move | Same single note, now a `now-meta` line at the end of the primary block (still `data-testid=distress-disclaimer`); no second copy anywhere in the panel |
| sosText.privacy (new; was sosText.battery in the SOS panel, zh-TW) | 聯絡人只存在這支手機，不會上傳。電量低時請先節省電力。 | shorten + move | 一句：聯絡人只存在這支手機。 ／ 其餘移到「了解更多」：聯絡人不會上傳。電量低時請先節省電力。 |
| sosText.privacy (ja) | 連絡先はこの端末にのみ保存され、送信されません。電池が少ないときは先に節電してください。 | shorten + move | 連絡先はこの端末にのみ保存されます。 ／「詳しく見る」：連絡先は送信されません。電池が少ないときは先に節電してください。 |
| sosText.privacy (en) | Contacts stay on this phone and are never uploaded. If your battery is low, save power first. | shorten + move | Contacts stay on this phone. / "Learn more": They are never uploaded. If your battery is low, save power first. |
| sosText.learnMore (new) | (none) | add | 了解更多 / 詳しく見る / Learn more (Disclosure summary) |
| sosText.battery (kept) | unchanged | keep | Still used by the first-run contact setup screen, which is out of scope for this task |
| Exercise label | plain text pill | keep text, restyle | `Tag tone="exercise"`; text unchanged |
| AI suggestion labels (primary, other candidates, emphasis, SOS) | custom `.distress-ai` span | keep text, restyle | `Tag tone="ai"`; text unchanged |
| AI suggest_sos note | SOS block moved above the instruction | move | SOS never moves; the `Tag tone="ai"` plus "建議求救 / 救助要請をおすすめ / Calling for help is suggested" appears inside the lower SOS area |
| Offline reason and last-verified | custom class | keep text | Unchanged text, `now-meta` style |
| Official basis, data time, countdown, stale notices | unchanged text | keep | Unchanged; restyled with `now-meta` / tokens |
| Buttons (send, record, stop, type instead, analyze, confirm, replay, mute, call 119/110) | unchanged text | keep text, restyle | Shared `Button` variants, call buttons use danger; tag buttons are `.ui-chip` pills |

# Task 7: Map screen

The map page carries exactly one "not for evacuation navigation / not a safety determination" note: the last part of the one-line legend (always shown, even with every layer off). The safety status lines tied to specific data stay: "safest route: undetermined", "opening: unverified" on every place, designation reference-only wording, and the inundation query's "safety undetermined" status.

| Location | Original | Action | New text |
|---|---|---|---|
| Map page h1 (zh-TW) | (none; lost in Task 3) | add, visually hidden | 全日本參考地圖 |
| Map page h1 (ja) | (none) | add, visually hidden | 日本全国の参考地図 |
| Map page h1 (en) | (none) | add, visually hidden | All Japan reference map |
| Map legend card: quick caution (zh-TW) | 海岸線 ≠ 海嘯浸水區 · 不可作避難導航 | replace with the page's single note, in the legend line | 僅供參考：不可作避難導航，也不是安全判定 |
| Map legend card: quick caution (ja) | 海岸線 ≠ 津波浸水範囲 · 避難経路に使用不可 | same | 参考情報：避難ナビ・安全判定には使えません |
| Map legend card: quick caution (en) | Coastline ≠ tsunami zone · no safe routes | same | Reference only: not for evacuation navigation or a safety determination |
| Map legend card: map label (zh-TW / ja / en) | 全日本參考地圖 + 官方想定資料 · 安全性未判定 / 日本全国の参考地図 + 公式想定データ · 安全性未判定 / All Japan reference map + Official scenario data · safety undetermined | remove on /map (`legend="none"`); kept on exercise maps | title moves to the hidden h1; safety wording covered by the single legend note |
| Map legend card: land/sea/roads/rail swatches and layer swatches | 陸地 · 海洋 · 參考道路 · 鐵路 · 浸水想定 · … / 陸地 · 海 · 参考道路 · 鉄道 · 浸水想定 · … / Land · Sea · Reference roads · Rail · Inundation scenario · … | replace on /map with one line built from the layers that are on | see legend rows below |
| Map details disclosure (地圖限制與資料 / 地図の注意事項 / Map details & limits) | long coastline / P-S caution | remove on /map (no P/S wavefronts on this page; navigation note is the legend line); kept on exercise maps | (none) |
| Legend: inundation layer on (zh-TW / ja / en) | 浸水想定 (swatch) | shorten into the line | 浸水想定：官方靜態想定，非即時 / 浸水想定：公式の静的想定・リアルタイムではない / Inundation: official static scenario, not live |
| Legend: places layer on | 指定場所圖層 (checkbox) | shorten into the line | 避難場所：官方指定，開放未核實 / 避難場所：公式指定・開設は未確認 / Places: official designations, opening unverified |
| Legend: tsunami forecast lines on (fix round 1: follows the drawn line states) | 海嘯電文 · 預報區海岸線 + 舊資料／未核實／取消 (dashed swatch) / 津波電文 · 予報区海岸線 + 過去／未確認／取消 / Tsunami bulletin · coastal line + Old / unverified / cancelled | replace with a state-driven line; "current" wording only when every drawn line is ACTIVE | all ACTIVE: 海嘯預報區：期限內電文（實線） / 津波予報区：期限内の電文（実線） / Tsunami areas: bulletin within reference time (solid); mixed: 海嘯預報區：實線＝期限內電文，灰色虛線＝過期／未核實／取消 / 津波予報区：実線＝期限内の電文、灰色の破線＝期限切れ／未確認／取消 / Tsunami areas: solid = bulletin within reference time, grey dashed = old / unverified / cancelled; none ACTIVE: 海嘯預報區：灰色虛線＝過期／未核實／取消，並非目前資訊 / 津波予報区：灰色の破線＝期限切れ／未確認／取消・現在の情報ではない / Tsunami areas: grey dashed = old / unverified / cancelled, not current; nothing drawn: 海嘯預報區：未取得可核實電文 / 津波予報区：検証可能な電文なし / Tsunami areas: no verifiable bulletin |
| Legend: inundation entry (fix round 1) | shown whenever the chip is on | show only when the verified pack is loaded | unchanged text |
| EvacuationRoutePanel origin hint (fix round 1) | 請在地圖點選起點或按上方 GPS 查詢。 / 地図で出発点を選ぶか、上のGPS照会を利用してください。 / Select an origin on the map or use the GPS query above. | fix location (GPS is in the official-data section below) | 請在地圖點選起點，或在「官方資料」使用 GPS 查詢。 / 地図で出発点を選ぶか、「公式情報」のGPS照会を利用してください。 / Select an origin on the map or use the GPS query under Official data. |
| Legend: intensity regions on | 地域最大觀測 · 非逐點實測 / 地域最大観測 · 各地点の実測ではない / Region maximum · not point measurements | reword | 震度地域：地域最大值，非逐點實測 / 震度地域：地域の最大値・各地点の実測ではない / Intensity regions: regional maxima, not point readings |
| Layer checkboxes (OfficialHazardPanel 浸水想定圖層 / 指定場所圖層; DisasterMapPanel 海嘯預報區（海岸線） / 地域最大震度) | checkbox labels | move to one chip row | 浸水想定 · 避難場所 · 海嘯預報區 · 震度地域 / 浸水想定 · 避難場所 · 津波予報区 · 震度地域 / Inundation · Places · Tsunami areas · Intensity regions |
| DisasterMapPanel "海嘯預報區（海岸線）" | checkbox label | keep text, now a plain caption above the colour key | unchanged |
| Bottom sheet peek (new) | (none) | add | 附近 N 處指定避難場所 / 付近の指定避難場所 N か所 / N designated places nearby |
| Sheet section titles (new) | panel h1/h2 titles | replace with Section titles | 道路候選 · 避難場所 · 官方資料 / 道路候補 · 避難場所 · 公式情報 / Road candidates · Evacuation places · Official data |
| EvacuationRoutePanel title h2 | 避難路線評估 / 避難経路の検討 / Evacuation route review | remove (Section title 道路候選 / 道路候補 / Road candidates) | (none) |
| EvacuationRoutePanel scope | 石卷道路候選試點 · 非避難導航 / 石巻の道路候補試行 · 避難ナビではありません / Ishinomaki road-candidate pilot · not evacuation navigation | shorten (navigation note lives once in the legend) | 石卷道路候選試點 / 石巻の道路候補試行 / Ishinomaki road-candidate pilot |
| EvacuationRoutePanel seven check rows | 7 rows of "label — 未核實 / 參考資料已核對 / 不可使用" | compress into one line + Disclosure; blocked checks stay visible as their own line | 還有 N 項未確認 / 未確認 N 件 / N items unverified; Disclosure: 查看全部 7 項檢查 / 7 項目の確認状況 / All 7 checks; blocked: 「檢查名稱：不可使用」 |
| JapanShelterPanel h1 | 全日本官方避難場所 / 全国の公式避難場所 / Official places across Japan | demote to h3 sub-heading inside the 避難場所 section | unchanged text |
| DesignatedPlacesPanel h2 | 官方指定場所 · N / 公式指定場所 · N / Official designated places · N | demote to h3 | unchanged text |
| OfficialHazardPanel h2 | 石卷海嘯浸水想定 / 石巻の津波浸水想定 / Ishinomaki inundation scenario | demote to h3 | unchanged text |
| DisasterMapPanel / LiveTsunamiReference h2 | 官方事件圖層 · LIVE 參考 / JMA 即時海嘯資訊 (and ja/en) | demote to h3 | unchanged text |
| Historical epicenter picker (顯示歷史震央 / 過去の震央を表示 / Show historical epicenter) | select on the map | remove from /map (Task 8 re-adds under More → Exercises & demo) | (none on /map) |
| Historical epicenter picker (過去の地震 select + option set) | removed from /map in Task 7 | move to More → 演練與示範 / 演習とデモ / Exercises & demo, with an 演練 / 演習 / Exercise tag and an exercise-only reference map | unchanged option text; new note: 歷史震央僅作演練參考，不是目前的災害資訊。 / 過去の震央は演習用の参考で、現在の災害情報ではありません。 / Historical epicenters are exercise references, not current disaster information. |
| More heading `messages.more` plus top-of-page language `<label>` + `<select>` | language select shown on /more | delete (the 語言 / 言語 / Language subpage is the only language control; the first-run onboarding screen without a session keeps its select) | 更多 / その他 / More |
| More destination cards (本人・家族 / 表示・アクセシビリティ / オフラインへの備え / プライバシー) | 4 card buttons | delete; replaced by nine plain rows | 語言 · 外觀 · 電量模式 · 緊急聯絡人 · 位置與隱私 · 通知 · 資訊來源 · 演練與示範 · 關於 (ja / en in components/more-screen.tsx) |
| More top links 演練與示範 → and 全日本避難場所及參考地圖 → | two link lines | delete (map is a tab) / move (演練與示範 becomes a row) | (none) |
| More 測試・診斷 `details.more-lab-entry` (災害シミュレーション（模擬のみ）) | collapsed disclosure | move into 演練與示範 subpage as the 災害測試 / 災害テスト / Disaster test link | 災害測試 / 災害テスト / Disaster test |
| More location card (area, GPS button, change area), personal summary, profile edit | main list | move into 位置與隱私 subpage; privacy sentence kept, device-location controls move behind 了解更多 / 詳しく見る / Learn more | unchanged except 了解更多 |
| More 表示 subpanel: text-size help, theme select, language select | settings panel | split: theme becomes 3 check rows in 外觀; text-size help kept under 外觀; language select deleted (see above); PowerControls move to 電量模式 | unchanged help text |
| More emergency footer (119 · 110 · 72H link, 緊急時の基本) | main list footer | move into 關於 subpage next to the offline readiness panel and emergency guide | unchanged |
| Desktop settings block (desktop-settings: profile form, location, safety check, route preview, handoff, offline, plan history, emergency guide, refresh) | one long panel | delete; desktop uses the same nine-row More. Route preview and plan history stay in the Now basis details. | (none) |
| More subpage back control | `.more-back` 「その他に戻る」 button | shorten | ‹ 返回 / ‹ 戻る / ‹ Back |
| 關於 subpage version row (new) | (none) | add | 版本 / バージョン / Version + package version |
| 位置與隱私 privacy text (`locationPrivacy`, 4 sentences) | shown in full on the subpage | shorten to the first sentence; the full text moves into the 了解更多 Disclosure | 精確座標只在此裝置上使用。 / 正確な座標はこの端末内でのみ使います。 / Exact coordinates stay on this device. |
| 演練與示範 map legend card | default reference-map caution card | delete (the subpage's exercise note is the single caution) | (none) |
