# 模擬地圖拖曳修正 — 本地驗收

2026-10-13 JST，延續 `codex/simulation-gemini-location`，基線 `55625fb`。
使用者要求地圖可滑動移動，並移除「全日本參考地圖」卡片。

- 原因：compact 地圖明確停用 dragPan/touchZoomRotate；資訊卡 pointer-events:auto 亦截取部分手勢。
- 修正：compact 與 full 都啟用 dragPan、touchZoomRotate、scrollZoom，仍禁用旋轉；模擬首頁、事件及全屏地圖不顯示資訊卡，保留可穿透拖曳的細字限制與資料署名。其他官方圖層頁預設仍保留完整圖例。
- 不改 Gemini、Safety Core、GPS 私隱、地震波時鐘或移動授權。

## 證據

- 回歸測試先 RED（compact 沒有啟用任何手勢），修正後 GREEN；相關 14 項通過。
- 全套 frontend **367 passed / 3 原有 skips**；TypeScript exit 0。
- `pnpm build` exit 0，build ID `OiBt0_O77yih_Bm-Ka8Ft`，37 offline assets。
- secret gate 及 diff whitespace check：PASS。
- 真實瀏覽器 `127.0.0.1:3036/simulation`：首頁拖曳震央標記 x=269→358.07；全屏 x=257→354.38；滾輪後 marker transform 亦隨相機更新。DOM `.sim-map-information` 數量為 0。
- 觸控容器 computed touch-action=none，啟用 pan/pinch 的配置測試通過；IAB 不支援 Input.dispatchTouchEvent，未做觸控實機驗收。
- 本地截圖 `.work/map-pan-home.jpg`、`.work/map-pan-fixed.jpg`。驗收後刪除臨時演習密鑰傳遞檔；密鑰不進 repo。

只完成本地 UI 修正，沒有部署。Windows 本地沿用已 build 的 next start；不等同 standalone 容器驗收。
