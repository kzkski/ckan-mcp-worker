# ckan-mcp-worker

日本のオープンデータポータル（CKAN）向け MCP サーバー。Cloudflare Workers + Hono で動作します。

## 対応ポータル

| キー | ポータル |
|------|----------|
| `sendai` | [仙台市オープンデータ](https://data.city.sendai.jp) |
| `geospatial` | [G空間情報センター](https://www.geospatial.jp/ckan) |
| `bodik` | [BODIK（全国自治体オープンデータ）](https://data.bodik.jp) |

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

本番の `ADMIN_TOKEN` は `wrangler.jsonc` の `vars` ではなくシークレットで設定してください。

```bash
npx wrangler secret put ADMIN_TOKEN
```

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
| POST | `/tools/call` | ツール実行 |
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

```bash
# Cloudflare にログイン（初回のみ）
npx wrangler login

# KV 名前空間を wrangler.jsonc に設定したうえでデプロイ
npm run deploy
```

デプロイ後は `https://ckan-mcp-worker.<your-subdomain>.workers.dev` でアクセスできます。

## MCP ツール

| ツール名 | 説明 |
|----------|------|
| `search_datasets` | キーワードでデータセット検索 |
| `get_dataset` | データセット詳細・リソース一覧 |
| `search_records` | DataStore レコード検索（未対応時は `{ "available": false }`）。G空間情報センターは `datastore_search` 非対応 |
| `list_organizations` | 組織一覧 |

## リクエストログ・ダッシュボード

`POST /tools/call` のたびに D1（`LOG_DB`）へ以下を記録します。

- 日時、ツール名、ポータル、キーワード（要約）
- HTTP ステータス、エラー有無、処理時間、キャッシュヒット
- IP の SHA-256 ハッシュ（先頭16文字）、国コード、User-Agent

### ダッシュボード

ブラウザで `http://localhost:8787/admin` を開き、ローカル開発時の `ADMIN_TOKEN`（`wrangler.jsonc` の `vars`、既定: `dev-admin-token-change-me`）でログインします。

API から直接取得する場合:

```bash
curl "http://localhost:8787/admin/api/stats?period=24h" \
  -H "Authorization: Bearer dev-admin-token-change-me"

curl "http://localhost:8787/admin/api/logs?limit=20" \
  -H "Authorization: Bearer dev-admin-token-change-me"
```

`period` は `24h` / `7d` / `30d` です。90日より古いログは毎日 4:00 UTC の Cron で自動削除されます。

## レート制限

IP アドレス（`CF-Connecting-IP`）ごとに 60 リクエスト / 60 秒です。超過時は HTTP 429 を返します。

## キャッシュ

KV（`CACHE_KV`）にレスポンスをキャッシュします。

| 操作 | TTL |
|------|-----|
| データセット検索・詳細・組織一覧 | 3600 秒 |
| レコード検索 | 1800 秒 |
