# P2.4 A＋B — 官方事件契約與生命週期

日期：2026-10-12 JST。分支：`codex/p2-4-event-lifecycle`。基線：`b057929`。

狀態：**首包 A＋B COMPLETE（本地）；整體計劃 PARTIAL。**

範圍：新版 [P2.4 至 P2.7 計劃](VNEXT_P2_4_P2_7_ROADMAP.md) 的首個實作包 A＋B。
P2.4 C／D（持久化、缺口補齊及完整投影）與 P2.5–P2.7 尚未完成，整體計劃保持 PARTIAL。
舊石卷 pilot 的 P2.4 名稱與驗收紀錄保持不變。

## 官方規格核實與需求修正

以現行產品表覆蓋通用運用指針的例外；不以舊 adapter 的行為當官方規則：

- [2026-04-30 Header／Control 表](https://xml.kishou.go.jp/jmaxml_guide_20260430_head_control_list.pdf)，第 1 頁 rows 35／39 及 EventID 註 1／2：
  VXSE53／VTSE41 只列 `発表/取消`。修訂透過重新 `発表`；未列出的 `訂正` 不作有效 live 輸入。
  地震／海嘯以 Title、Status 及 EventID 組合識別資訊單位，**官署切換不建立另一個群組**。
  VTSE41 的 Serial 不使用，且可以列出多個 EventID。
- [運用指針](https://xml.kishou.go.jp/jmaxml_guide_20130412.pdf)，2.1.3：
  最新判斷依 `Control.DateTime`，不是 Serial、Head.ReportDateTime 或接收時間。
  `取消` 撤銷整個資訊單位，不表示災害解除。允許 `訂正` 的其他產品不在本包範圍。
- [2026-01-29 版本表](https://xml.kishou.go.jp/jmaxml_guide_20260129_dic_schema_list.pdf)：
  兩產品現行支援版本固定 `1.0_1`；其他版本、缺身份／時間及訓練／試驗輸入失敗關閉。

因此，原計劃的「地震訂正」落實為 **官方重新發表的修訂生命週期**，不是接受不存在於產品表的操作。
這是依更具體官方來源作出的契約修正，沒有放寬安全規則。

## 實作

- `official_events.py`：不可變、嚴格驗證的 envelope，保留產品、官署、版本、來源 URL、原始 hash、
  系統發表／業務發表／目標／發生／接收時間、EventID、Serial 及目標代碼。
  這兩產品不提供 ValidDateTime，保留空值；15 分鐘 TTL 仍是應用證據政策，不是警報結束時間。
- 純函式 reducer：只按官方系統時間前移；重送不刷新時間；同時戳不同原文保持衝突；
  只有嚴格較新電文能取代衝突。保留有界歷史及取消 tombstone，較舊電文不能恢復舊狀態。
- 兩個來源 adapter 採原子批次更新。取消無事件 Body 資料時，envelope 不虛構發生時間。
  若已保存較早官方電文，使用其既有發生時間及範圍作 UNKNOWN 的兼容 Safety Core 投影；
  冷啟動只有取消且沒有先前已核實快照時，不製造 DisasterEvent 或目標區域。
- VXSE53 修訂撤下舊範圍及舊震度；缺失區域保持 UNKNOWN。VTSE41 `取消` 的參考狀態為 UNKNOWN；
  只有官方區域解除資料可投影為 CANCELLED／RESOLVED。兩者不授權安全目的地或移動。
- sync／async Live pipeline 撤下同群舊證據、阻止倒序取代，保留 plan history。
  不同資訊單位獨立聚合；取消其中一個不能清除另一個當前事件。
  新地震群組重連亦需要逐群核實，維持 LIVE／REPLAY 隔離。
- 舊 snapshot ID 相容：按官方產品及完整單一 EventID 辨認原先地震／海嘯 ID，
  在同一 reducer batch 將舊證據標記 STALE、事件 UNKNOWN 並移除舊 active ref。
  原先時間、範圍及 plan history 保留；較新快照不被較舊電文覆蓋。
  舊 snapshot 只存業務時間，故先重取原始官方 XML，核對產品、原 URL、完整單一 EventID、
  Serial／舊 ID 公式及 ReportDateTime，恢復真正 Control.DateTime 與完整 Title／Status 身份。
  原文缺失、身份不符或同時戳不同 hash 時，來源 INVALID_RESPONSE、舊證據 STALE／UNKNOWN；
  不以 Serial、本機接收時間或業務時間推測排序。複合 EventID 不作部分匹配。
  重新取得舊電文不延長 TTL，亦不能冒充重連後的新發表證據。
- 公開 snapshot schema 未改；新增 envelope 留在來源邊界。舊 snapshot／合成 replay 不需要補新欄位。

## 官方測試樣本

原樣保存四個 [官方 2026-09-17 樣本 ZIP](https://xml.kishou.go.jp/jmaxml_20260917_Samples.zip) 的 XML，
`services/agent-api/tests/fixtures/jma_lifecycle/manifest.json` 記錄來源、ZIP hash、原文 hash 及長度：

| 樣本 | 驗證用途 |
| --- | --- |
| `32-39_11_05_240613_VXSE53.xml` | 311 地震、現行格式 1.0_1、原始區域震度及 envelope roundtrip |
| `32-35_06_06_100915_VXSE53.xml` | 有 Body/Text、無地震記錄的歷史取消；1.0_0 不冒充現行 live 格式 |
| `38-39_02_04_250206_VTSE41.xml` | 多 EventID 與兩個 Earthquake 發生時間保留 |
| `38-39_03_01_210805_VTSE41.xml` | 空 Serial、取消及缺發生時間 |

這些是離線官方格式樣本，並非實際當前災害、即時 feed 覆蓋或實機驗收證據。
其餘合成測試只控制事件輸入，經真實來源解析與 Safety Core，不使用步數硬切計劃。

## 已知限制與後續包

- 歷史及取消狀態目前只在 process memory；重啟恢復、長期 feed 補齊與完整覆蓋證明屬 C。
  不聲稱已能補齊公開 feed 的所有缺口。feed 每次最多五份 detail 的原有限制保留。
  舊 snapshot 相容重取另有同 poll interval／detail_limit 的有界掃描，最多五份歷史原文、
  最多 64 個身份 cache；它只協助重建身份及時鐘，不能製造當前事件或完整覆蓋證明。
  原始 XML 已不可取得或屬未支援格式時，原有 session 保持未核實；完整恢復流程屬 C。
- 每來源最多 64 個資訊單位、每單位最多 256 份 envelope；達上限失敗關閉，不能任意丟棄取消狀態。
  C 須完成持久化及可恢復的保留策略，才能作長期服務驗收。
- 舊 snapshot 沒有原始 XML hash／完整標題。重取只能核對目前官方 URL 的內容與舊 ID、
  業務時間及來源身份，不能密碼學證明與歷史 snapshot 的原文 bytes 完全相同。
  相容遷移仍採信 JMA detail URL 的官方原文身份；無法取回或不符即降級，完整歷史保存屬 C。
- 同時戳不同 raw hash 即保守標記衝突，未以 XML 語意相同消除衝突。
  EventID 組合按完整成員匹配；部分取消或組合變動不推測跨群取代。
- 尚無完整官方預報區幾何映射，仍只對原有精確都道府縣名稱作安全投影。
- 新 metadata 的完整 API／使用者可見修訂歷史屬 D；此次沒有新增地圖安全着色或改動 AI 權限。
- 本地驗證不代表 Preview／正式環境更新或當前災害驗收；本次沒有部署。

## 驗證紀錄

- PASS：後端完整套件 **234 個測試**；其中 `test_official_events.py` 的 **57 個測試**涵蓋
  現行官方樣本、同 Serial 修訂／取消、官署切換、重送、倒序、衝突、批次原子性、
  舊 snapshot ID 同步／非同步遷移、冷來源取消及逐群重連。
  額外驗證原 Control 晚於舊接收時間、業務／系統時間分歧、原文身份不符、原文不可取得、
  同時戳原文衝突、新舊群組混合及重取舊原文不能完成重連。歷史／Mock Live 隔離回歸亦通過。
  指令：`services/agent-api/.venv/Scripts/python.exe -m pytest services/agent-api/tests -q`。
- PASS：前端 **325 個測試、3 個既有 skip**；TypeScript `tsc --noEmit` 通過。
  本包沒有前端程式改動；這些是相容性回歸，並非新畫面或部署驗收。
- PASS：`scripts/check_secrets.py` 與 `git diff --check`。
- 獨立 Luna Max 審核：首次發現舊 snapshot ID 無法被新取消淘汰；已修正並加入上述遷移回歸。
  第二輪發現舊業務時間被誤當系統時間，以及本機接收時間不能保證官方 Control 上界。
  已改為重取原始官方 XML 並核實身份及原始時鐘。
  **最終覆核 PASS，沒有 blocking findings**；Reviewer 自行執行單檔 **57 PASS**、
  三個相關套件 **96 PASS**。上述歷史 bytes 相容性假設與後續持久化限制維持明示。
- NOT RUN：新瀏覽器畫面驗收、實機、當前災害 feed 覆蓋、持久化重啟恢復、Preview／正式環境部署。
  這些未執行項目不聲稱通過；其中持久化及覆蓋驗收是後續 C／D 的完成門檻。
- 現有 Starlette／httpx 測試客戶端棄用警告仍存在；不影響本次測試結果。
