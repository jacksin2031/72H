# 海陸與海岸線對齊 — 本地驗收

2026-10-13 JST，基線 `70a6c6f`，分支 `codex/simulation-gemini-location`。

## 原因及修正

Natural Earth 1:50m 概覽陸地填色與 GSI 精細水域／道路疊加，放大時產生可見差距。
依 [GSI 官方樣式](https://raw.githubusercontent.com/gsi-cyberjapan/gsivectortile-mapbox-gl-js/master/std.json) 的 land-background / waterarea 組合，僅在成功解碼的水域圖磚內補上 tile-local 陸地底色；從相同水域 rings 產生邊線，不手調經緯度或平移道路。排除沿裁切圖磚邊界的假海岸，保留跨界真實線段。

原始 PBF 作為輸出前綴，逐 byte 保留；附加 `72h-land-coverage`／`72h-water-edges`。新 URL `?geometry=aligned-v1` 避免舊圖磚快取。未取得細節、空資料及 GPS 私隱模式仍沿用已驗證概覽；不新增安全／浸水／道路通行判斷。

套件使用 MapLibre 已存在的相同版本：vector-tile 3.0.0、vt-pbf 4.3.2、pbf 5.1.2。只將它們列為 server 直接依賴；canonical package-lock 保留原有版本及 integrity，未升級依賴。

## 驗證

- 新回歸先 RED，再 GREEN：PBF 前綴及水域幾何不變、底色與邊線同一 extent、無矩形 tile 邊線、空／壞／過大資料拒絕。
- 獨立審查發現 ClosePath 重複次數可在解碼前放大配置；已加入 raw command preflight，拒絕超限 ClosePath、點數／圖層／features／extent／座標及截斷資料。38-byte regression 確認 `loadGeometry()` 未被呼叫。Reviewer 核對 blocker 已關閉。
- Frontend **370 passed / 3 原有 skips**；TypeScript 及 build PASS。
- Build ID `cquCG_DC9GyxM54ULdLrN`；37 offline shell assets。
- Secret gate、diff whitespace、canonical lock manifest 與 pinned versions 一致檢查 PASS。
- 真實圖磚 API：z4/14/6、z7/113/50、z9/454/201、z9/454/202、z16/58220/25801 全部 HTTP 200，含新增 layers。GSI z4–7 extent=16384，z9/16=4096，各自保持原 scale。
- 瀏覽器核對東京灣港口及日本概覽；碼頭、水域、陸地邊緣對齊，無額外 MapLibre console errors。現有模擬頁已重開載入更新；參考卡仍移除。

只完成本地地理顯示修正；沒有部署或重新核實現實海岸、場所安全及通行狀態。
本機 native npm 仍有既有 minipass runtime 錯誤，npm lock regeneration 未通過；三項套件已在原 lock 的 transitive graph，僅同步 root declarations 並核對版本。未宣稱 Linux npm ci／standalone 容器驗收。
截圖保存於忽略的 `.work/coast-aligned-simulation.jpg`；臨時演練密鑰檔在驗收後刪除，不進 Git。

## 連續縮放全綠修正（基線 `3948c07`）

上一輪只核對概覽與詳細海岸，未涵蓋中間縮放。已在模擬地圖連續放大重現：海洋被整片綠色蓋住，只剩湖泊。實際 GSI 東京圖磚 z4–7 的 waterarea 為 `ftCode=55000` 內陸水域，不能作海洋遮罩；z8 起詳細水域為 `5000`。

- API 明確傳入已驗證的 tile zoom；z4–7 原始 PBF 不加陸地矩形，z8+ 仍要求 polygon 的已知 `5000` schema。保留現有容量及 raw command preflight 限制。
- `reference-land.minzoom=8` 防止過渡期間顯示舊概覽底色；URL 改為 `aligned-v2` 避免 v1 快取。概覽陸海及精細水域／海岸線保留，GPS 圖磚私隱規則不變。
- 兩項新回歸先 RED 再 GREEN；前端 **372 passed / 3 原有 skips**，TypeScript/build PASS，Build ID `hvoM4pGkQ-nsR3bmJrl60`。
- 實際 API z4/14/6、z7/113/50 回傳 HTTP 200、land layer=0；z8/227/100、z9/454/201、z16/58220/25801 回傳 HTTP 200、land layer=1，水域保留。
- 實際 `/simulation` 從全日本連按放大五次，原本出錯級別保持藍色海洋；東京視野由概覽經十次小幅滾輪放大至精細道路／東京灣，切換時海灣保持藍色。另核對公共 `/map` 的連續放大。截圖 `.work/zoom-green-before.jpg`、`zoom-fixed-step-1` 至 `5.jpg`、`zoom-green-fixed.jpg`。
- 已重開本地 311 模擬載入修正版；臨時演練密鑰檔刪除。未部署，未做實體手機觸控驗收。
