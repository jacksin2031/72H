# 地震模擬：Gemini 及用戶所在地區

2026-10-13 JST，使用者要求地震模擬實際呼叫 Gemini，按用戶位置評估原地、避難所或高處。
本次範圍是本地模擬，不改 production Safety Core 的移動授權，不部署。

## 明確契約

1. 用戶以裝置內 GPS→N03地區解析，或自行選擇所在地區。只傳完整 canonical area IDs、來源及觀測時間；精確座標不進 server、Gemini、Trace或持久快取。
2. 歷史事件所在地與用戶位置分開。未設定、GPS過期、區域無效不能默認為震央附近或安全。演練情境將災害套用至選定地區的假設須明示，不能稱為當地歷史實測。
3. 海岸／建物／高處／場所開放／路線狀態採封閉枚舉的演練條件；它們不是GPS推論或真正官方證據。預設未知。Synthetic資料永遠不授予真實移動或路線權限。
4. Deterministic gate先產生可選行動、已知facts、限制及版本。Gemini／ADK只在可選集合內評估、選擇並引用fact IDs，無自由目的地／路線／安全判斷文字。
5. 原地防護不是原地安全。海嘯情境不能單憑地區／海拔選高處，缺避難地點或路線條件不選具體移動；不能移動時顯示求援／協助。
6. 回應核對版本、決策白名單、facts及所有限制，超時、無效、舊版本、斷線或過期使用固定三語保守回退。Gemini成功、fallback與未執行分開。
7. 保留原有真實Live處理及Safety Core計劃歷史；新增演練評估仍REFERENCE_ONLY，不寫HIGH ALLOW，不提供實際路線。

## 執行及驗收

- 重用ADK、ADC、bounded call budget、三語及既有area resolver／picker。
- 新契約保持舊mock payload可讀；新介面預設要求Gemini，缺credential明示fallback。
- 測試三個主要選項、未知位置、GPS age、區域／來源／坐標拒絕、缺開放／路線、行動障礙、海嘯情境、提示注入、越權／晚到輸出、offline及重連。
- 全套backend／frontend、typecheck／build／secret scan、獨立審查、手機／桌面及實際Gemini模擬證據。
- 真實GPS裝置、全國災害／開放資料及production驗收另記；不能以這次模擬宣稱安全地點已核實。

本需求允許模擬中的受限選項評估；完整P2.7將所有Live／Replay遷移至Safety Core後的解釋流程仍屬另一交付。不得把本次局部接入宣稱為P2.7全數完成。
