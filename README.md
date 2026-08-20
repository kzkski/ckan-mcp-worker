# ckan-mcp-worker

日本のオープンデータポータル（CKAN）向け MCP サーバー。Cloudflare Workers + Hono で動作します。

## 対応ポータル

| キー | ポータル |
|------|----------|
| `sendai` | [仙台市オープンデータ](https://data.city.sendai.jp) |
| `geospatial` | [G空間情報センター](https://www.geospatial.jp/ckan) |
| `bodik` | [BODIK（全国自治体オープンデータ）](https://data.bodik.jp) |
| `shizuoka` | [静岡県オープンデータ](https://opendata.pref.shizuoka.jp)（※標準CKANではなくCMS「シラサギ」独自API。`list_organizations` / `search_records` は非対応。`get_dataset` の `id` には検索結果の `uuid` または `id` を指定する） |

## 開発の進め方

このリポジトリは **GitHub Flow** で運用します。`main` への直接 push は行わず、feature ブランチから Pull Request でマージしてください。詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

```bash
npm run check   # 型チェック + テスト（PR 前に実行）
```

## セットアップ

```bash
npm install
```

### KV 名前空間の作成（本番デプロイ時）

```bash
npx wrangler kv namespace create CACHE_KV
npx wrangler kv namespace create CACHE_KV --preview
```

出力された `id` / `preview_id` を `wrangler.jsonc` の `kv_namespaces` に設定してください。

### D1 データベース（リクエストログ）

```bash
npx wrangler d1 create ckan-mcp-logs
```

出力された `database_id` を `wrangler.jsonc` の `d1_databases` に設定し、マイグレーションを適用します。

```bash
# ローカル
npm run db:migrate:local

# 本番
npm run db:migrate:remote
```

本番の `ADMIN_TOKEN` は `npm run setup:prod` が自動登録するか、手動で `npx wrangler secret put ADMIN_TOKEN` を実行してください。ローカルは `.dev.vars` を使用します。

## ローカル開発

```bash
# ローカル起動
npm run dev
# または
wrangler dev
```

サーバーは `http://localhost:8787` で起動します。

### エンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/` | サーバー情報 |
| GET | `/tools` | MCP ツール定義一覧 |
| POST | `/tools/call` | ツール実行（REST） |
| POST | `/mcp` | MCP（Streamable HTTP / JSON-RPC） |
| GET | `/admin` | 統計ダッシュボード（HTML） |
| GET | `/admin/api/stats` | 集計 JSON（要認証） |
| GET | `/admin/api/logs` | 直近ログ JSON（要認証） |

### 動作確認用 curl

```bash
# 仙台市でデータセット検索
curl http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"search_datasets","arguments":{"portal":"sendai","keyword":"公共施設","limit":5}}'

# G空間情報センターでデータセット検索
curl http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"search_datasets","arguments":{"portal":"geospatial","keyword":"PLATEAU","limit":5}}'

# BODIK でデータセット検索
curl http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"search_datasets","arguments":{"portal":"bodik","keyword":"施設","limit":5}}'

# 静岡県でデータセット検索
curl http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"search_datasets","arguments":{"portal":"shizuoka","keyword":"人口","limit":5}}'
```

### その他のツール例

```bash
# データセット詳細
curl http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"get_dataset","arguments":{"portal":"sendai","id":"DATASET_ID"}}'

# レコード検索（DataStore 対応ポータルのみ）
curl http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"search_records","arguments":{"portal":"sendai","resource_id":"RESOURCE_ID","limit":10}}'

# 組織一覧
curl http://localhost:8787/tools/call \
  -H "Content-Type: application/json" \
  -d '{"name":"list_organizations","arguments":{"portal":"geospatial","limit":10}}'
```

## デプロイ

詳細は [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) を参照してください。

### 初回（自動セットアップ）

```bash
npx wrangler login
cp .dev.vars.example .dev.vars   # ローカル開発用

# KV / D1 作成・シークレット登録・マイグレーション・デプロイまで一括
npm run setup:prod -- --deploy
```

### 2 回目以降

```bash
npm run deploy:prod
```

`main` への push で [GitHub Actions](./.github/workflows/deploy.yml) からも自動デプロイできます（要 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）。

デプロイ後は `https://ckan-mcp-worker.<your-subdomain>.workers.dev` でアクセスできます。

## MCP クライアント接続

手順の詳細は **[docs/MCP_CLIENT_SETUP.md](./docs/MCP_CLIENT_SETUP.md)** を参照してください。

| クライアント | 推奨 |
|--------------|------|
| **OpenCode** | `type: "remote"` + **`/mcp`**（[設定例](./opencode.json.example)） |
| **Cursor / Claude Desktop** | stdio ブリッジ（[`.cursor/mcp.json.example`](./.cursor/mcp.json.example)） |

### OpenCode（推奨）

OpenCode のリモート MCP は **Streamable HTTP（`/mcp`）** に対応しています。URL は **`/mcp` で終えて**ください。

```json
{
  "mcp": {
    "ckan": {
      "type": "remote",
      "url": "https://ckan-mcp-worker.workers.dev/mcp"
    }
  }
}
```

ローカル（`wrangler dev` 起動中）は `http://localhost:8787/mcp` に置き換えてください。

## MCP ツール

| ツール名 | 説明 |
|----------|------|
| `search_datasets` | キーワードでデータセット検索 |
| `get_dataset` | データセット詳細・リソース一覧 |
| `search_records` | DataStore レコード検索（未対応時は `{ "available": false }`）。G空間情報センター・静岡県は `datastore_search` 非対応 |
| `list_organizations` | 組織一覧（静岡県は非対応） |

## ADMIN_TOKEN とは

**管理ダッシュボード（`/admin`）と統計 API を守るための共有パスワード**です。

| 項目 | 説明 |
|------|------|
| 用途 | `/admin/api/stats`・`/admin/api/logs` へのアクセス認証（`Authorization: Bearer <トークン>`） |
| ローカル | `.dev.vars` の `ADMIN_TOKEN`（`.dev.vars.example` をコピー） |
| 本番 | **必ず** `wrangler secret put ADMIN_TOKEN` で独自の長いランダム文字列を設定する |
| MCP 利用者 | **不要**（`/tools/call` には使わない） |

ブラウザで `/admin` を開くとトークン入力欄が表示され、入力値は `sessionStorage` にだけ保存されます（サーバーへは API 呼び出し時の Bearer ヘッダーのみ送信）。

IP ハッシュ用の `LOG_HASH_SALT` が未設定の場合、ログ記録では `ADMIN_TOKEN` をソルトの代替として使います。本番では `LOG_HASH_SALT` も別途設定することを推奨します。

## リクエストログ・ダッシュボード

ツール実行（`POST /tools/call` または `POST /mcp` の `tools/call`）のたびに D1（`LOG_DB`）へ以下を記録します。

- 日時、ツール名、ポータル、キーワード（要約）
- HTTP ステータス、エラー有無、処理時間、キャッシュヒット
- IP の SHA-256 ハッシュ（先頭16文字）、国コード、User-Agent

### ダッシュボード

ブラウザで `http://localhost:8787/admin` を開き、`.dev.vars` の `ADMIN_TOKEN` でログインします。

API から直接取得する場合:

```bash
curl "http://localhost:8787/admin/api/stats?period=24h" \
  -H "Authorization: Bearer dev-admin-token-change-me"

curl "http://localhost:8787/admin/api/logs?limit=20" \
  -H "Authorization: Bearer dev-admin-token-change-me"
```

`period` は `24h` / `7d` / `30d` です。90日より古いログは毎日 4:00 UTC の Cron で自動削除されます。

## レート制限

IP アドレス（`CF-Connecting-IP`）ごとに 60 リクエスト / 60 秒です。超過時は HTTP 429 を返します。`POST /tools/call` と `POST /mcp` に適用されます。

## キャッシュ

KV（`CACHE_KV`）にレスポンスをキャッシュします。

| 操作 | TTL |
|------|-----|
| データセット検索・詳細・組織一覧 | 3600 秒 |
| レコード検索 | 1800 秒 |
