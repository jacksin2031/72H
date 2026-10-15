# サードパーティのライセンス情報 / Third-Party Notices

72H は以下のオープンソースソフトウェアとオープンデータを利用しています。各ソフトウェア・データの著作権は、それぞれの権利者に帰属します。ライセンス全文は各パッケージに同梱されたライセンスファイル、または下記の配布元を参照してください。

バージョンは 2026-10-15 時点の lock ファイル（`apps/web/package-lock.json`、`services/agent-api/uv.lock`）に基づきます。

## フロントエンド（apps/web）

| パッケージ | バージョン | ライセンス |
|---|---|---|
| next | 16.3.8 | MIT |
| react / react-dom | 19.3.0 | MIT |
| zod | 4.6.5 | MIT |
| maplibre-gl | 6.12.0 | BSD-3-Clause |
| @mapbox/vector-tile | 3.0.0 | BSD-3-Clause |
| @maplibre/vt-pbf | 4.3.2 | MIT |
| pbf | 5.1.2 | BSD-3-Clause |

開発用: typescript 5.9.3（Apache-2.0）、vitest 5.0.3（MIT）、jsdom 27.0.1（MIT）、@types/node・@types/react・@types/react-dom（MIT）

## バックエンド（services/agent-api、packages/contracts）

| パッケージ | バージョン | ライセンス |
|---|---|---|
| fastapi | 0.141.1 | MIT |
| starlette | 1.7.0 | BSD-3-Clause |
| uvicorn | 0.34.2 | BSD-3-Clause |
| pydantic | 2.13.5 | MIT |
| google-adk（Agent Development Kit） | 1.39.1 | Apache-2.0 |
| google-genai | 2.28.0 | Apache-2.0 |
| google-cloud-storage | 3.16.0 | Apache-2.0 |
| mcp（Model Context Protocol SDK） | 1.30.0 | MIT |
| httpx | 0.28.1 | BSD-3-Clause |

開発用: pytest 8.3.5（MIT）

上記の推移的依存関係のライセンスは、各 lock ファイルと各パッケージのメタデータを参照してください。

## データ

| データ | 出典・ライセンス | 同梱場所 |
|---|---|---|
| 指定緊急避難場所・指定避難所 | 出典：国土地理院 指定緊急避難場所・指定避難所データを加工 | `apps/web/public/hazards/`、全国避難場所データ |
| 行政区域 | 国土交通省 国土数値情報（行政区域）2026年版を加工、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | `apps/web/public/areas/`、`apps/web/public/maps/` |
| 地震情報／細分区域、津波予報区 | 気象庁の GIS データを 72H が加工。国土地理院承認番号：平30情使第401号、令2情使第125号、令3情使第90号・第123号・第648号、令4情使第437号、令5情使第71号、令6情使第382号、令7情使第395号 | `apps/web/public/hazards/jma-*` |
| 道路データ | © OpenStreetMap contributors、[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1.0/) | `apps/web/public/maps/`（詳細は `LICENSE.md`）、道路参考タイル |
| 陸地・海岸線 | [Natural Earth](https://www.naturalearthdata.com/)（パブリックドメイン） | `apps/web/public/maps/` |

各データの取得日時・加工内容・ハッシュは、同梱の `manifest.json` に記録しています。これらのデータは参考情報であり、現在の開設状況・安全な経路・公式の災害状況を示すものではありません。

## 外部サービス

- Google Cloud（Cloud Run、Vertex AI / Gemini、Secret Manager、Cloud Build、Artifact Registry）: Google Cloud の利用規約に従って利用しています。
- 駅すぱあと API（MCP Server）: 提供元の利用規約に従い、API キーは Secret Manager で管理しています。

## 生成ツール・素材

- 紹介動画のナレーションは音声合成（Microsoft Edge TTS）、BGM は本プロジェクトのためにプログラムで生成したオリジナルです。
