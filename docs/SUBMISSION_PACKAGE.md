# 72H — Hackathon submission package

Official event: 第5回 Agentic AI Hackathon with Google Cloud  
Deadline: 2026-10-15 23:59 JST  
Public judging URL: https://h72-602701455122.asia-northeast1.run.app  
GitHub: https://github.com/jacksin2031/72H

## プロジェクト名

**72H**

## キャッチコピー

**警報から、行動へ。**

## プロジェクト説明

72Hは、日本を訪れる旅行者や在住外国人が、地震などの災害情報を受け取った後に「今何をすべきか」「次に何を確認すべきか」「避けるべき行動は何か」を判断するための災害時行動支援AIエージェントです。

災害時には、警報や交通情報を受け取るだけでは十分ではありません。利用者は、情報の出典が信頼できるか、まだ有効か、移動経路が現在も使えるか、状況変化によって以前の判断が無効になっていないかを短時間で判断する必要があります。特に日本の防災情報や交通事情に慣れていない外国人旅行者にとって、この判断負荷は大きな課題です。

72Hは、情報の出典・信頼状態・鮮度・依存関係を管理し、NOW / NEXT / AVOIDの行動計画として整理します。状況が変わると既存計画の依存条件を再評価し、古い計画を上書きせず失効理由を残したまま新しいPlan versionを生成します。

GeminiとGoogle Agent Development Kit（ADK）は、サーバー側で定義された安全な候補の中から行動意図と根拠を選択します。最終的な行動公開可否、リスク、依存関係、失効判定は決定論的なSafety Coreが担当します。これにより、LLMの提案能力を利用しながら、重要な安全判断をモデルの自由生成だけに任せない設計にしています。

また、未確認のSNS情報は観測できますが、高リスク行動の根拠には昇格しません。通信が切れた場合は、最後に検証された計画、保存済み根拠、静的な防災情報を表示し、新しいリアルタイム情報を推測で作りません。再接続後も、必要な公式・交通情報が再取得されるまで計画を最新とは扱いません。

今回の提出版では、東京・渋谷にいる旅行者が浅草の宿泊先へ戻る予定という合成地震シナリオを使用し、実際のEvidence → Situation → Plan → Safety → Invalidation → Re-plan → Offline → Reconciliationの処理経路を再現可能な形で確認できます。合成データは常にシミュレーションとして明示し、実際の災害情報として表示しません。

## 主な特徴

- 出典・信頼状態・鮮度を持つEvidence管理
- NOW / NEXT / AVOID形式の行動計画
- Plan versioningと依存条件による自動失効
- 状況変化後の自動再計画
- 未確認情報を高リスク行動の根拠から除外
- Gemini + Google ADKによるbounded candidate planning
- 決定論的Safety Coreによる最終検証
- 公開Agent Traceによる可観測性
- PWA / IndexedDB / Service Workerを利用したOffline Continuity
- 日本語・英語・繁体字中国語UI
- 駅すぱあと API MCP Serverのproduction connectivityをSecret Manager経由で検証

## Google Cloud / 技術構成

- Google Cloud Run
- Vertex AI / Gemini
- Google Agent Development Kit（ADK）
- Google Secret Manager
- Google Cloud Build
- Artifact Registry
- Next.js / TypeScript
- FastAPI / Python
- PWA / IndexedDB / Service Worker
- 駅すぱあと API MCP Server

公開Cloud Runでは、Vertex AI / Gemini + ADKの実リクエストが成功し、完全なリプレイで4つのPlan version・12 actionsを生成しました。paced production golden pathは10/10で成功し、モデルfallbackは発生しませんでした。

## 動作確認の方法

1. `https://h72-602701455122.asia-northeast1.run.app` をブラウザで開きます。
2. 「地震シミュレーション」であることを確認します。
3. 「デモを開始」を押します。
4. 必要に応じてPauseし、「次の更新」を使ってイベントを1件ずつ進めます。
5. NOW / NEXT / AVOIDの変化とPlan versionを確認します。
6. 「計画の履歴」で旧Planの失効と新Planを確認します。
7. 「情報源」でofficial / transport / unverified evidenceの扱いを確認します。
8. 「Agentの記録」で`GEMINI_CANDIDATE_APPLIED`やplan invalidationの公開traceを確認します。

認証は不要です。シミュレーション用サンプルデータはアプリ内に含まれています。

## 安全性に関する設計原則

- No Source → No High-Risk Action
- 経路が利用可能であることと、災害時に安全であることを同一視しない
- 未確認情報は高リスク行動を直接駆動しない
- 古い情報は明示的にstaleへ降格する
- LLM推論を公式情報として表示しない
- オフライン時に新しいリアルタイム情報を捏造しない

## 今回のMVPで意図的に含めていないもの

- JMAのlive feed ingestion
- Safety Tipsのlive feed ingestion
- 駅すぱあと経路結果の災害安全Evidenceへの自動昇格
- Firestoreによるdurable session persistence
- Cloud Loggingを製品trace storeとして利用する機能

これらは未実装であり、提出時にも実装済みとは主張しません。

## 提出アセット

- Deployed URL: `https://h72-602701455122.asia-northeast1.run.app`
- GitHub: `https://github.com/jacksin2031/72H`
- Architecture SVG: `docs/architecture-mvp.svg`
- Architecture upload PNG: `docs/architecture-mvp.png`
- Demo narration / shot list: `docs/DEMO_SCRIPT.md`
- YouTube URL: **PENDING**

## 最終提出前チェック

- [ ] Hackathon dashboardでGitHub Appを`jacksin2031/72H`に連携
- [ ] architecture-mvp.pngをアップロード
- [ ] 上記プロジェクト説明を最終フォームに合わせて貼り付け
- [ ] 約3分の自作デモ動画をYouTubeへ公開しURLを登録
- [ ] 参加者情報・資格条件をdashboard上で確認
- [ ] 提出前にpublic URLを再確認
- [ ] 提出ボタンを押して提出完了を確認
- [ ] 提出時の`main` SHAを記録
- [ ] 2026-12-01までdefault branchを変更せず、以後の開発は別branchで実施
