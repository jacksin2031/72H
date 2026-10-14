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
