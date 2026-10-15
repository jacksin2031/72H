# 72H — ハッカソン提出パッケージ（vNext）

- 公式イベント: 第5回 Agentic AI Hackathon with Google Cloud
- 締切: 2026-10-15 23:59 JST
- サービスURL: https://h72-602701455122.asia-northeast1.run.app
- GitHub: https://github.com/jacksin2031/72H

## vNext 公開状況

- Source SHA: `8d1836ef6cc973cd98597e2f090329e4e6351535`（merge / push 済み）
- Cloud Build: `623824c3-128e-403e-8d12-cc883e699182`（**SUCCESS**）
- Image digest: `sha256:9d7e22b877aff64502903cfe90b233c8365a8df065e8e3b75fee5bcda6eb3005`
- vNext production revision: `h72-vnext-8d1836e`（100% traffic）
- Canonical CLI: **PASS** — 11 events / 4 plans / 12 actions / 4 candidate-applied / fallback 0 / `ONLINE_VERIFIED`（build `kwavxW-VSKN8tUxQJoWo4`）
- Focused frontend boundary tests: **PASS** — 8 tests
- Canonical clean-browser / UI acceptance: **PASS** — Tokyo 11 events / 4 plans / final `L1 / MONITOR` / `ONLINE_VERIFIED`; 4 `GEMINI_CANDIDATE_APPLIED`, fallback 0
- Physical offline / cached reload / reconnect: **PASS** — cached Plan v2 + SURVIVAL → physical online `RECONNECTING` → fresh official + transport at step 10 → `ONLINE_VERIFIED`
- Mobile 390×844 and consented mock LKL opt-in / save / reload LAST with same capture time / forget: **PASS**
- サービスの100% traffic切替: **PASS**
- vNext revision のproduction acceptance: **PASS**
- YouTube URL、Hackathon dashboard 登録、参加資格確認、final submission: **PENDING**

Cloud Buildは成功し、vNext revisionを100% trafficへ切り替えました。Canonical CLI run、focused frontend boundary tests、clean-browser replay、physical offline/reconnect、consented mock LKL、mobile checksがPASSし、vNext production acceptanceを確認しました。canonical replayの最終Home表示は`L1 / MONITOR`です。これは最新の同地域assessmentが`ACTIVE`でseverity値を含まない結果であり、危険が確定的に解除されたことを意味しません。以前のrevisionで記録されたproduction golden path 10/10は履歴情報で、このvNext revisionの受け入れ結果としては扱いません。

## プロジェクト名とキャッチコピー

**72H**
**警報から、次の行動へ。**

## プロジェクト説明

72Hは、災害情報を受け取った後に「今できること」「次に確認すること」「避ける行動」を整理する災害時行動支援アプリです。出典、鮮度、対象地域、情報の矛盾を決定論的に評価し、現在の計画に必要な根拠が変わったときは、過去の計画を残したまま新しいversionを作成します。

通常画面は **Home / Plan / More** です。Homeでは利用可能なNOW行動を先に示し、利用者プロフィールの参考地点と地図カタログを使って地図を表示します。現在インストール済みの地図パックは中央東京の参照用道路地図だけです。ShibuyaやAsakusaのプロフィール座標はデモ設定上の参考地点で、端末位置や安全な経路を意味しません。

Last Known Locationは、利用者が明示的に位置取得を開始し、保存にも同意した場合に、最新の1点だけを端末内へ保持します。位置履歴やサーバー送信はありません。保存位置は再表示しても最新位置へ更新されず、LIVE位置とLast Known Locationを区別します。

安全確認は、同意済みの利用者に対するアプリ内の自己申告確認です。対象地域に関係する鮮度のある重大評価を条件とし、応答がない場合は「状態不明」として扱います。確認結果から救助機関へ連絡したり、救助Beaconを起動したりしません。

Power modesはアプリ内の更新頻度・表示を保守的に切り替える設定です。AUTO、CONSERVE、EMERGENCY POWER、SURVIVALを備え、電池情報が不明な場合も安全側へ扱います。OSの電池予約、実機での電池測定の保証、バックグラウンド動作は主張しません。

TokyoとOsakaの登録済みシナリオは合成データです。Osakaは汎用プロフィール・area catalog・typed disaster assessmentが同一のSafety Coreを通ることを確認するための構成検証で、対応地図パックはありません。Osakaの地図・現地情報対応を示すものではありません。

## 実装範囲と安全境界

- **Evidence / Safety Core**: source registry、明示的なcanonical area IDと祖先関係、typed disaster assessment、freshness、conflict、plan dependencyを使った決定論的評価。
- **Plan**: immutable plan history、NOW / NEXT / AVOID、根拠失効後の再評価とversion追加。
- **Offline Continuity**: アプリ内に保存済みの計画・根拠・静的参照地図を利用し、通信断中に新しい公式情報を作りません。再接続だけでは最新と扱わず、必要な根拠を再検証します。
- **通知**: アプリ内通知Inbox。Web Pushは提供しません。
- **安全確認**: 端末内の同意ベース自己申告確認。無応答は不明であり、救助連絡・Rescue Beaconはありません。
- **地図**: catalog選択式の中央東京参照用道路データのみ。hazard overlay、避難所判定、safe-route判定はありません。

Gemini / Google ADKは、Safety Coreが承認した行動への説明文・根拠の割り当て（ADK）、救助要請の音声・文字からの状況タグ抽出（Gemini）、演習での所在地に応じた行動評価（ADK）、救助時の助言の保守的な調整（Gemini）に使います。いずれも構造化された選択肢から選ぶだけで、計画の生成・再計画、公開可能な行動とplan dependencyはSafety Coreが決定論的に行います（2026-10-15 時点の提出版。初期版の候補intent選択経路は現在呼び出されていません）。最新の提出用説明文は `output/promo/zenn-project-description.md` を参照してください。Canonical CLIとclean-browser replayがPASSし、vNext production acceptanceは **PASS** です。最終状態の`L1 / MONITOR`は、最新assessmentの`ACTIVE`にseverity情報がないことを示し、確定的な危険解除を意味しません。

次の機能は今回の完成機能として扱いません: JMA live feed、live hazard / shelter情報、safe-route判定、Web Push、Rescue Beacon、native background service、OS電池予約。

## デモの確認方法

vNext production acceptanceは **PASS** です。[DEMO_SCRIPT.md](DEMO_SCRIPT.md)の順序で公開デモを収録できます。scenario selectorで「Tokyo Earthquake Replay」を明示選択してから開始してください。合成シナリオの表示を保ち、live災害情報と説明しないでください。

## 提出アセットと最終チェック

- Architecture SVG: [docs/architecture-mvp.svg](architecture-mvp.svg)
- Architecture PNG: [docs/architecture-mvp.png](architecture-mvp.png)
- Demo narration / shot list: [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md)
- YouTube URL: **PENDING**

- [x] vNext公開revisionとacceptanceを確認して記入
- [ ] Hackathon dashboardにGitHub Appを`jacksin2031/72H`へ連携
- [ ] architecture-mvp.pngをアップロード
- [ ] プロジェクト説明を最終フォームへ登録
- [ ] 約3分の自作デモ動画をYouTubeへ公開しURLを登録
- [ ] 参加者情報・資格条件をdashboard上で確認
- [x] 公開URLがvNext revisionを返すことを確認
- [ ] 提出ボタンを押し、submission完了を確認
- [ ] 提出時の`main` SHAを記録
- [ ] 2026-12-01までdefault branchを変更せず、以後の開発は別branchで実施
