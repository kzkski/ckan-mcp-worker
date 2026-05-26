# 本番デプロイ

## 初回セットアップ（自動）

Cloudflare にログインしたうえで、次を **1 コマンド** で実行できます。

```bash
npx wrangler login
npm run setup:prod -- --deploy
```

`setup-prod` が行うこと:

1. KV 名前空間 `CACHE_KV`（本番 + preview）の作成と `wrangler.jsonc` 更新
2. D1 `ckan-mcp-logs` の作成と `wrangler.jsonc` 更新
3. `ADMIN_TOKEN` の生成（未指定時）と `wrangler secret put`
4. D1 マイグレーション（remote）
5. `wrangler types` の再生成
6. `--deploy` 指定時は `wrangler deploy`

トークンを自分で指定する場合:

```bash
ADMIN_TOKEN="$(openssl rand -hex 32)" npm run setup:prod -- --deploy
```

ローカル開発用トークンは `.dev.vars` に設定します（リポジトリには含めない）。

```bash
cp .dev.vars.example .dev.vars
# .dev.vars を編集
```

## 2 回目以降のデプロイ

### 手元から

```bash
npm run deploy:prod
```

（リモート D1 マイグレーション → Worker デプロイ）

### GitHub Actions（自動）

`main` への push で、CI 成功後に自動デプロイされます。

### 必要な GitHub Secrets

リポジトリの **Settings → Secrets and variables → Actions** に登録:

| Secret | 取得方法 |
|--------|----------|
| `CLOUDFLARE_API_TOKEN` | [API トークン](https://dash.cloudflare.com/profile/api-tokens) を作成。権限: Account / Workers Scripts Edit、Account / Workers KV Storage Edit、Account / Workers R2 Storage Edit（不要なら省略）、Account / D1 Edit、Account / Workers Tail Read（任意） |
| `CLOUDFLARE_ACCOUNT_ID` | ダッシュボード右サイドバーまたは `wrangler whoami` |

`ADMIN_TOKEN` は **GitHub には不要**です。初回 `setup:prod` で Cloudflare Worker のシークレットに保存済みであること。

### API トークン作成の目安

「Edit Cloudflare Workers」テンプレートをベースに、D1 編集権限を追加するのが簡単です。

## 動作確認

```bash
export BASE="https://ckan-mcp-worker.<your-subdomain>.workers.dev"

curl "$BASE/"
curl "$BASE/tools/call" \
  -H "Content-Type: application/json" \
  -d '{"name":"search_datasets","arguments":{"portal":"sendai","keyword":"test","limit":2}}'
```

管理画面: `$BASE/admin`（セットアップ時に表示した `ADMIN_TOKEN` でログイン）

## トラブルシュート

| 問題 | 対処 |
|------|------|
| KV/D1 binding エラー | `npm run setup:prod` を再実行するか、`wrangler.jsonc` の ID を確認 |
| `/admin` が 503 | `npx wrangler secret put ADMIN_TOKEN` |
| Actions デプロイ失敗 | Secrets の `CLOUDFLARE_*` を確認。初回は手元で `setup:prod` 済みか |
