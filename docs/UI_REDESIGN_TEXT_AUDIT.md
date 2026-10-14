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
| Legend: tsunami forecast lines on | 海嘯電文 · 預報區海岸線 / 津波電文 · 予報区海岸線 / Tsunami bulletin · coastal line | shorten | 海嘯預報區：最新電文參考 / 津波予報区：最新電文の参考 / Tsunami areas: latest bulletin reference |
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
