# 72H — Final 3-minute demo script

Public demo: https://h72-602701455122.asia-northeast1.run.app

This recording must keep the simulation banner visible and must never describe the replay as a live earthquake alert. Record with the production URL, not localhost.

## Japanese narration script

### 0:00–0:20 — Problem

画面: トップページ、`SHIBUYA → ASAKUSA`、地震シミュレーション表示。

ナレーション:

「72Hは、訪日外国人や在住外国人が、災害情報を受け取った“その後”の行動を判断するためのAIエージェントです。警報を見るだけでは、今どこに留まるべきか、移動してよいのか、情報が変わったらどうすべきかまでは分かりません。このデモでは、東京で地震が発生した合成シナリオを使います。」

### 0:20–0:50 — Start / first plan

操作: `Start demo` → 必要なら Pause → `Next update`。NOW / NEXT / AVOID と Gemini / ADK 表示を見せる。

ナレーション:

「72Hでは、情報をそのままAIに渡して自由に回答させません。出典、信頼状態、鮮度、依存関係をまず状態として管理します。GeminiとGoogle ADKは、許可された候補の中から行動意図を選びます。最終的に公開できる行動は、決定論的なSafety Coreが検証します。」

### 0:50–1:20 — Plan invalidation / re-plan

操作: 交通更新まで進める → Plan history を開く。

ナレーション:

「交通条件が変わると、既存計画の依存条件を再評価します。古い計画を書き換えるのではなく、失効理由を残したまま新しいPlan versionを追加します。重要なのは、経路が存在することと、災害時に安全であることを同一視しない点です。」

### 1:20–1:40 — Unverified social information

操作: SNS/unverified update → Sources。

ナレーション:

「未確認のSNS情報も観測結果として表示できますが、信頼できる行動根拠には昇格しません。No Source、No High-Risk Actionというルールで、出典のない高リスク行動を防ぎます。」

### 1:40–2:10 — Offline continuity

操作: replay の network-loss / local-clock event を進める。可能なら DevTools などで実ネットワークを一度 offline にして reload し、保存済み Plan と emergency pack が残る様子を短く見せる。

ナレーション:

「通信が切れても、72Hは新しいリアルタイム情報を捏造しません。最後に検証された計画、保存済み根拠、防災情報を表示し、時間経過で古くなった情報は明示的にstaleへ降格します。」

### 2:10–2:35 — Reconnect / verification gate

操作: network restored → official update → transport update。

ナレーション:

「再接続しただけでは、計画を最新とは扱いません。必要な公式情報と交通情報が再取得され、依存条件が確認されて初めてONLINE_VERIFIEDへ戻ります。」

### 2:35–3:00 — Trace / deployed proof

操作: Agent trace、Sources、Cloud Run URLが見える状態。

ナレーション:

「この公開版はGoogle Cloud Run上で動作し、Vertex AIのGeminiとGoogle ADKを実際に使用しています。公開traceでは、どの根拠からどの計画が生成・失効したかを確認できますが、モデルの非公開な思考過程は表示しません。72Hは、警報を“次の行動”へ変えることを目指しています。」

## Recording checklist

- Use the public Cloud Run URL.
- Keep the synthetic simulation banner visible.
- Show `Gemini / ADK` on a successful production run; do not submit a fallback run.
- Show at least one plan invalidation and a later plan version.
- Show unverified evidence excluded from trusted action evidence.
- Show Sources and Agent Trace.
- If demonstrating actual browser offline mode, clearly distinguish it from replayed network events.
- Keep total duration around 3 minutes.
- Do not expose Google credentials, Ekispert key, Cloud Console secrets, or private logs.
- Upload the self-made recording to YouTube and register the URL in the Hackathon dashboard.

## Verified production facts for narration

- Public revision: `h72-00005-vql`
- Full replay result: four plans / twelve actions
- Planner mode: `GEMINI_ADK`
- Production golden path: 10/10 paced runs passed with no model fallback
- Ekispert MCP production connectivity: verified by Cloud Run Job
- Safety decision remains deterministic application logic
