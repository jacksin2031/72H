# 72H — 最終3分デモ台本（vNext）

公開サービスURL: https://h72-602701455122.asia-northeast1.run.app

**録画ゲート: vNext revision `h72-vnext-8d1836e` は100% trafficに切替済みで、Cloud Run上のcanonical replay、clean-browser、offline/reconnect、LKL、mobile checksを含むvNext production acceptanceはPASSです。公開URLで最終デモを収録できます。** 以前のrevisionのproduction golden path 10/10は、このvNextデモの証拠ではありません。

この台本は、確認済みrevisionで後日録画するための草稿です。全編で合成シナリオ表示を維持し、実際の地震・JMA更新として説明しません。

## 日本語ナレーションと画面

### 0:00–0:15 — 課題とHome

画面: Home。合成シナリオ表示、NOWカード、プロフィール参考地点、地図の範囲表示。

ナレーション:

「災害の情報を受け取っても、その後に何を確認し、どの計画を見直すべきかはすぐには分かりません。72Hは、出典と情報の鮮度、対象地域を整理し、確認できる次の行動を示すアプリです。この画面は合成データによるデモです。」

### 0:15–0:35 — 参照地図と位置

画面: 中央東京の参照用オフライン道路地図と、プロフィール座標由来の参考ピンを見せる。位置設定の同意・最新1点の説明を示す。

ナレーション:

「Homeの地図はカタログから利用可能なパックを選びます。現在のパックは中央東京の参照用道路地図で、安全な経路や危険区域を示すものではありません。プロフィール位置は参考地点です。端末位置の保存は別途同意が必要で、保存するのは最新の1点だけです。」

端末位置の保存が録画環境で使えない場合は位置取得を試さず、設定項目とプロフィール参考地点だけを示します。実GPSの取得や精度を主張しません。

### 0:35–0:55 — Demoと地域スコープ

操作: More → Demo / Judge Modeを開き、scenario selectorで「Tokyo Earthquake Replay」を明示選択してから開始する（Osakaが先頭に表示される場合がある）。安全確認を見せる場合は、重大イベントの前に同意を設定する。

表示上の注意: 最終snapshotのseverityはL1 / MONITORです。これは同じ地域の最新assessmentがACTIVEでseverity値を含まないためで、確定的な危険解除やL4からの安全なde-escalationを示すものではありません。

ナレーション:

「area IDとarea catalogはサーバー側で検証され、表示名や座標だけでは出典の権限は変わりません。災害評価は対象areaとevent typeを持つ型付きデータです。Osakaも同じデータ経路の構成検証に使いますが、現地の地図対応を意味しません。」

### 0:55–1:20 — Gemini / ADK候補とSafety Core

操作: 合成公式更新を進め、Agent Traceで`GEMINI_CANDIDATE_APPLIED`を確認する。対応するNOW actionと根拠を見せる。

ナレーション:

「GeminiとGoogle ADKは許可された候補から行動意図を提案します。Safety Coreは根拠と依存条件を決定論的に検証してからPlanへ反映します。公開traceでは候補が適用された事実を確認できます。」

### 1:20–1:40 — Plan invalidation / re-plan

操作: transport updateまで進め、Plan画面で旧versionの失効、新しいversionと根拠を見せる。

ナレーション:

「交通情報が変わると、計画の依存条件を再評価します。古いPlanを消したり上書きしたりせず、失効理由を残して新しいversionを追加します。交通状態だけから経路の安全性は判断しません。」

### 1:40–1:55 — 未確認情報

操作: unverified reportまで進め、MoreのSourcesまたはDemo / Judge Modeの根拠表示を開く。

ナレーション:

「未確認情報は確認対象として表示できますが、検証済みの行動根拠へ昇格しません。出典が不足しているとき、Safety Coreは高リスク行動を許可しません。」

### 1:55–2:15 — Offline Continuity / 再接続

操作: network lossを進め、保存済みPlanと情報の鮮度を確認。その後、network restoredと再取得した根拠を進める。

ナレーション:

「通信が切れた間は保存済みのPlanと根拠を使い、新しい公式情報を作りません。再接続だけでは最新扱いへ戻しません。必要な根拠を再取得し、照合できてから状態を更新します。」

### 2:15–2:30 — 同意ベースの安全確認

操作: 対象地域の重大評価がある状態で安全確認カードを見せ、自己申告の選択肢を短く表示する。

ナレーション:

「同意済みの場合に限り、アプリ内で安全状態を確認します。応答がない場合は危険と決めつけず、状態不明として残します。」

### 2:30–2:40 — Power modes

操作: Power modeのAUTO、CONSERVE、EMERGENCY POWER、SURVIVALを示し、SURVIVALの最小画面を短く確認してHomeへ戻る。

ナレーション:

「Power modesはアプリ内の節電ポリシーです。状態不明時も保守的に動き、SURVIVALでは重要な表示を優先します。OSレベルで電池を予約したり、アプリ終了後の処理を保証したりする機能ではありません。」

### 2:40–3:00 — 公開実行とAgent Trace

画面: 確認済みの公開Cloud Run URL、Agent Traceの`GEMINI_CANDIDATE_APPLIED`、plan invalidationと再生成を見せる。記録時点での公開revisionが確認済みであることをチェックする。

ナレーション:

「この公開版はGoogle Cloud Run上で動き、GeminiとGoogle ADKが制約された行動意図を提案します。公開traceでは提案の適用と、状況変化後のPlan失効・再生成を確認できます。最終判断は決定論的なSafety Coreが行います。」

## 録画チェックリスト

- [x] 主線がclean-browser verificationとoverall production acceptanceを確認済み（PASS）
- [ ] scenario selectorで「Tokyo Earthquake Replay」を選択してから開始する（Osakaは地図なしの構成検証用）
- [ ] 公開URLが確認済みのvNext revisionを返すことを確認する
- [ ] 合成シナリオ表示を維持する
- [ ] Home / Plan / Moreの構成と中央東京参照地図の範囲を示す
- [ ] Agent Traceで`GEMINI_CANDIDATE_APPLIED`を確認する
- [ ] TokyoのPlan version変更と根拠を示す
- [ ] 少なくとも一度Plan invalidationと再生成を示す
- [ ] 未確認SNS情報が検証済みaction evidenceから除外されることを示す
- [ ] Offline Continuityと再接続後の検証ゲートを示す
- [ ] Osakaの地図非対応表示を、地域対応の証拠として説明しない
- [ ] 位置取得が使えない環境では操作を試さず、参考地点と同意境界だけを示す
- [ ] 安全確認への同意と、無応答が不明であることを示す
- [ ] 通信断中の保存情報と再接続検証を示す
- [ ] Power modesをOS機能や実機保証として説明しない
- [ ] Live JMA、hazard/shelter情報、safe route、Web Push、Rescue Beacon、native background serviceを完成機能として説明しない
- [ ] YouTube URLをHackathon dashboardに登録する
- [ ] 参加資格と最終提出状態をdashboardで確認する
- [ ] Google credentials、transport keys、Cloud Console secrets、private logsを映さない

## 現在の記録項目

- Source SHA: `8d1836ef6cc973cd98597e2f090329e4e6351535`（merge / push 済み）
- Image digest: `sha256:9d7e22b877aff64502903cfe90b233c8365a8df065e8e3b75fee5bcda6eb3005`
- Cloud Build: `623824c3-128e-403e-8d12-cc883e699182`（**SUCCESS**）
- vNext production revision: `h72-vnext-8d1836e`（100% traffic）
- Canonical CLI: **PASS** — 11 events / 4 plans / 12 actions / 4 candidate-applied / fallback 0 / `ONLINE_VERIFIED`（build `kwavxW-VSKN8tUxQJoWo4`）
- Focused frontend boundary tests: **PASS** — 8 tests
- Preview browser GUI checks: **PASS** — map/profile, consented LKL, offline/SURVIVAL, mobile 390×844, console errors 0
- 100% traffic切替: **PASS**
- Canonical clean-browser / UI acceptance: **PASS** — Tokyo 11 events / 4 plans / final `L1 / MONITOR` / `ONLINE_VERIFIED`; 4 `GEMINI_CANDIDATE_APPLIED`, fallback 0
- Physical offline / cached reload / reconnect: **PASS** — cached Plan v2 + SURVIVAL → physical online `RECONNECTING` → fresh official + transport at step 10 → `ONLINE_VERIFIED`
- Mobile 390×844 and consented mock LKL opt-in / save / reload LAST with same capture time / forget: **PASS**
- vNext production acceptance: **PASS**
- Expected offline RSC `ERR_INTERNET_DISCONNECTED` once: not a runtime defect
- Real GPS / device battery behavior: **NOT RUN**
- YouTube URL: **PENDING**
- Dashboard registration / eligibility / final submission: **PENDING**
