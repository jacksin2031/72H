# P2.6 分類指定場所 — 本地資料包與 adapter 驗收

日期：2026-10-12 JST。基線 `d4942d2`；分支 `codex/p2-6-designated-places`。
程式碼、資料版本及本紀錄隨同同一 Git commit 保存。

狀態：**COMPLETE（本地只讀指定資料包／開放 adapter 邊界）／PARTIAL（全國覆蓋及真實開放來源）**。
整體 P2.4–P2.7 仍 PARTIAL；P2.7 尚未實作。本次沒有部署、真實裝置或當前災害安全驗收。

## 交付與身份邊界

- GSI 石卷 CSV：300 指定緊急避難場所、95 指定避難所，共 395 個角色紀錄。
  八類災害分類保留指定／非指定／缺值，CSV 空欄有官方「非該類指定」定義。
- 官方 GeoJSON：`skhb05/10/914/393` 的 85 個海嘯場所及 `sih/10/914/393` 的
  74 個一般避難所。兩者皆 Point，沒有 feature id／共通 ID。
  Tile 包含附近其他地方，不能當作完整石卷市或全國目錄。
- 格式切換、八類篩選及搜尋共用同一 subset；地圖會移除上一次格式／篩選的點。
  CSV 海嘯篩選有 266 筆，普通避難所不能因同址而進入海嘯緊急場所分類。
  GeoJSON 僅海嘯及普通避難所分片通過；其他災害圖層未載入。
- `skhb04/10/914/393` 實際 HTTP 404；紀錄為 UNAVAILABLE_404，
  沒有建立空 FeatureCollection 或假稱零個地震場所。CSV 的地震篩選零筆
  只表示該公開目錄沒有相符標記，不能證明當地沒有其他場所。
- GeoJSON 採核實的 `GSI_SPARSE_DISASTER_FLAGS_V1`：property=1 為指定；
  property 省略為非指定；明確 null 保持 UNKNOWN。一般避難所八類保持 UNKNOWN。
  這是指定用途，並非災害安全、開放或移動許可。
- CSV 身份是 `(role, common ID)`；GeoJSON 身份只限 `raw hash + feature ordinal` 的快照。
  不以名稱、地址、附近座標或內容相似猜測跨格式穩定身份。
  官方「與另類場所地址相同」註記保留，但不合併 ID／角色／用途。
- 實際「渡波中学校」緊急場所 ID `E0420200002201`、避難所 ID `E0420200002111`
  不同；兩 CSV 同名同址同座標，GeoJSON 顯示至約六位小數。樣本內容與分類可對照，
  不能當作全目錄或 opening feed 的身份 crosswalk。
- 場所點選使用 OFFICIAL_PLACE／null 精度，只是參考座標，不是 GPS。
  危險查詢回 UNKNOWN／SOURCE_LOCATION_ACCURACY_UNKNOWN，介面不顯示虛構 ±0m。
  使用者地圖查詢座標亦不呈現定位誤差保證；GPS 才顯示實際回報精度。

## 官方來源、時間及資料包

官方定義：[GSI 指定場所](https://www.gsi.go.jp/bousaichiri/hinanbasho.html)、
[CSV 欄位／公開更新列表](https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html)、
[現行 GeoJSON 圖層](https://cyberjapandata.gsi.go.jp/development/ichiran.html)。
[GSI 技術說明 PDF 頁 3](https://www.gsi.go.jp/common/000190664.pdf) 明述省略 disaster property 的含義；
舊文內 layer 拼字以現行官方圖層 URL 為準。

| 原始資料 | SHA-256 | bytes／結果 |
|---|---|---|
| `04202_2.csv` | `39592fc1e527254ea29b7ff612d89494df809f3db1feecdca2ed5b1d291a1d5b` | 36,441／300 |
| `04202_1.csv` | `a8af51698b6f0aa246aa39f68039eb76660138f96dda8ef5d0e406d970b87c0a` | 10,616／95 |
| `skhb05/10/914/393.geojson` | `ad4d864de5eb72178b7edf42b410cda1c3dcf3cc20738b649d89301605c53bc8` | 23,243／85 |
| `sih/10/914/393.geojson` | `c1c2045b31bf6fb50ee10fdeabdbe0d468fb4bc1f5976c6cc311b5cd4227909d` | 18,499／74 |
| `publicHistoryListData.csv` | `c92eab3a0ec750295f63f0fdce96f60f60f97ef1a92a8d685ec7435554f784c2` | 90,459／石卷資料庫日期 |
| `skhb04/10/914/393` 404 body | `ff18ba67fc88f7525ce905ee2f4a0649906fea430ea3a670c5b67fbbff8e1b77` | 320／NoSuchKey |

原始來源 URL、HTTP 狀態及各自擷取時間在 manifest；擷取日期為 2026-10-12。
石卷目錄公開 2017-02-22、GSI 資料庫更新 2026-06-12。
這些不是市長指定日期，不是 GeoJSON 逐點更新時間，也不是 current opening。
各紀錄的公布／更新／指定有效期未提供，保持未知。

產物三個 hash 命名 assets 共 592,032 bytes；每 asset 及 manifest 有 byte/hash/schema 檢查。
Builder 只用 stdlib；`--source-dir`、`--receipts`、`--reviewed-at`、`--previous-catalog` 可重現來源收據及差異。
容量上限／非法 schema／分類／座標／重複 ID 先拒絕，不發布截斷或部分版本。
先生成完整 hash assets，再取代 manifest；client 驗證全部後才切換，沒有舊／新場所累加。
目錄移除是 `absent_in_new_snapshot`，不能改稱官方撤銷、已關閉或災害解除。
先行包的 395 個 role ID 全部保留，新增／移除皆零；新增欄位與 source keys 令 payload changed=395，
這是格式差異紀錄，並非 395 個場所被官方修訂的聲明。

GSI 只公開自治體登錄且同意公開的資料，可能未更新或未掲載。
保留出處、加工聲明及 [GSI PDL 利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)。
分區資產只在請求後快取，沒有全國強制 precache；既有 SW no-cache 重新核對及 hash URL
避免新 pin 永久讀到舊目錄。舊資料不能透過重新下載變成新指定證據。

## 開放來源及安全邊界

`GET /api/reference/place-opening/04202` 使用可替換的自治體 adapter；預設
UNCONFIGURED、records=[]、REFERENCE_ONLY，safe_location_verified／route_authorized 固定 false。
沒有寫入端點、精確位置輸入或 LIVE session 建立，也沒有進入 Safety Core。
現時未有可靠實際開放 feed 與 GSI 角色 ID crosswalk，所有場所開放仍 UNKNOWN。

已實作的來源邊界要求：人工覆核的 authority／HTTPS 原典／自治體 scope／exact destination IDs、
原始發表及收到時間、有效期、限制；未來時間、錯誤 scope／來源／身份及超限均拒絕整批。
選擇最新發表紀錄，亂序舊 OPEN 不覆寫新 CLOSED；同時間衝突保持 UNKNOWN。
原典有效期及發表後 300 秒 app policy 取較短者，重取不刷新 TTL。
來源覆核到期、擷取失敗及缺紀錄保持 UNKNOWN；來源不再成功時不回退舊 OPEN。
Client 另拒絕未來／晚到 API、offline 及重連前舊 fetch，保留匹配的過期／離線紀錄
來源、原始時間及原因；來源／身份／行政區不符則不附帶紀錄。

OPEN 只表示來源報告開放；仍沒有核實災害適用、目的地、移動指示及路線等全部依賴。
Safety Core 的 production movement allowlists 及 plan history 沒有更改。
Synthetic adapter tests 不代表實際自治體開設驗收。Q-ANPI 雖是官方參與回報服務，
尚無可靠 GSI-ID crosswalk／全面覆蓋，亦可能為訓練資料；本次不把它接作全場所開放證據。

## 驗證證據

- Backend 全套：297 passed；既有 Starlette/httpx deprecation warning 保留。
- Frontend 全套：361 passed／3 原有 skipped；typecheck／production build 通過。
- Build-time pinned designation assets、secret scan、`git diff --check` 通過。
- 新 tests 覆蓋 sparse absence／null、八類／角色、實際兩格式樣本、錯誤軸／範圍／boolean座標、
  容量／腐敗資料、snapshot移除、opening OPEN／CLOSED／TTL／conflict／authority／ID／scope、
  future／late／offline／reconnect、read-only API、map/list一致、場所未知精度。
- Luna Max 獨立唯讀審查：未發現 blocking regression，提出場所 ±0m 及 expired opening 來源
  遺失兩項 P2，均修正及回歸測試；覆查 23/23 targeted PASS。
  尚未在 UI test 直接覆蓋所有 stale/conflict details 的字句；純函式／實際 rendering code 已審查。
- GUI 最後 build `ynrieZx3OUSAsN-SGbU4q`，本地 `http://127.0.0.1:3036/map`。
  390×844／1280×900，無橫向溢出；中文／日文／英文顯示角色、來源年齡與未知開放。
  已驗 395 CSV→266海嘯、GeoJSON159→85海嘯→地震404；offline reload保留395／159及原時間。
  最後修正版點選渡波中学校顯示 OFFICIAL_PLACE、精度未提供、UNKNOWN，沒有點GPS或傳座標。
  本地截圖 `.work/p26-mobile-designations.jpg`、`.work/p26-desktop-designations.jpg` 未提交Git。
  瀏覽器 error log空；網絡／viewport覆寫已恢復。這是尺寸模擬及本地驗收，並非實際裝置或部署。

下一階段 P2.7：決定性計劃先於 AI；使用批准 facts／actions／ID／plan version 的 Gemini／ADK 解釋。
全國其餘市町村／六類 GeoJSON 分片、可靠開放 feed與官方身份crosswalk、實際裝置及部署
各按門檻繼續，不能據此宣稱全日本安全地點或已核實避難路線。
