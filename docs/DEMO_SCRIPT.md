# 72H judge demo draft

This script describes the implemented synthetic replay. Record the final video
only after a real successful Gemini/ADK invocation and Cloud Run acceptance.
Keep the simulation banner visible. Never describe the replay as a live alert.

## Japanese project summary (draft)

72Hは、日本を訪れる旅行者や在住外国人が、災害情報を受け取った後に何をすべきか判断するためのAIエージェントです。東京の地震を想定した合成シナリオで、公式情報と交通情報の出典・鮮度を検証し、NOW／NEXT／AVOIDの行動計画を更新します。状況が変わると依存条件を再評価し、古い計画を失効させて履歴を残します。Geminiは候補を提案し、安全性は決定論的なコードが判断します。通信が途切れても保存済み計画と防災情報を表示し、再接続後は新しい根拠を確認してから更新します。

## Approximately three minutes

| Time | Screen and action | Explain |
|---|---|---|
| 0:00–0:20 | Japanese home, Shibuya → Asakusa | A traveler receives information but needs an evolving action plan. This is a synthetic earthquake replay. |
| 0:20–0:50 | Start; pause; official update | Evidence provenance and freshness enter the real state pipeline. Show initial NOW / NEXT / AVOID plan and actual agent execution label. |
| 0:50–1:20 | Next transport update; Plan history | A route dependency changes. Old plan evaluation becomes invalid, a new version is appended, and route availability never means safety. |
| 1:20–1:40 | Social report; Sources | Unverified content is visible but excluded from trusted claims and action evidence. Plan version remains stable. |
| 1:40–2:15 | Network-loss and local-clock events; actual browser offline reload | Saved plan persists. Expiration and source age are explicit. Static emergency guidance remains available. Label actual network loss separately from replay events. |
| 2:15–2:40 | Restore actual network; replay reconnect; official then transport refresh | Reconnecting alone does not restore verification. Both scoped current sources must arrive after restoration before reconciliation completes. |
| 2:40–3:00 | Sources and public trace; deployed Cloud Run URL | Show reasons/evidence, actual Gemini/ADK success, and deterministic safety decisions. No private model reasoning is displayed. |

For repeatable inspection, pause and use **Next update**. Reset clears the local
server replay history for that session; inspect historical versions before reset.
If the server session was lost, explicitly start a new demo. Offline checks must
begin with a nonempty verified plan, and the operator must restore connectivity.

## Submission assets still required

- Cloud Run judging URL and source SHA/image digest.
- Actual Gemini/ADK execution evidence in the recording.
- Final architecture image matching deployment (`architecture-mvp.svg` is a draft).
- Accessible self-made YouTube video and Hackathon GitHub integration.
- Participant eligibility and every team member's registration confirmation.

The project summary describes intended agent integration; final text must be
checked against shipped behavior before submission. Uploading or public release
has not been performed by creating these files.
