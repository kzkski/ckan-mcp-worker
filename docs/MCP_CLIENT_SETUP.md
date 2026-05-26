# MCP クライアント接続ガイド

この Worker は **HTTP API**（`GET /tools`・`POST /tools/call`）を提供します。  
Cursor / OpenCode / Claude Desktop などの **標準 MCP（stdio）** から使うには、同梱の **stdio ブリッジ** を経由します。

| 接続方式 | 向いている用途 |
|----------|----------------|
| **stdio ブリッジ**（推奨） | Cursor、OpenCode、Claude Desktop |
| **HTTP を直接呼ぶ** | curl、自作アプリ、n8n 等 |
| **`type: "remote"` + Worker URL** | 非対応（MCP Streamable HTTP ではない） |

`ADMIN_TOKEN` は **管理画面（`/admin`）専用**です。MCP ツールの利用には不要です。

---

## 1. Cursor（推奨）

### 1-1. 本番 Worker に接続

プロジェクト直下、またはホームディレクトリに `.cursor/mcp.json` を作成します。

```json
{
  "mcpServers": {
    "ckan-open-data": {
      "command": "node",
      "args": ["/absolute/path/to/ckan-mcp-worker/scripts/mcp-stdio-bridge.mjs"],
      "env": {
        "CKAN_MCP_BASE_URL": "https://ckan-mcp-worker.YOUR_SUBDOMAIN.workers.dev"
      }
    }
  }
}
```

- `args` のパスは **絶対パス** にしてください（クローン先に合わせて変更）。
- リポジトリ内の例: [`.cursor/mcp.json.example`](../.cursor/mcp.json.example) をコピーして編集。

### 1-2. ローカル開発（`wrangler dev`）に接続

別ターミナルで `npm run dev` を起動したうえで:

```json
{
  "mcpServers": {
    "ckan-open-data": {
      "command": "node",
      "args": ["/absolute/path/to/ckan-mcp-worker/scripts/mcp-stdio-bridge.mjs"],
      "env": {
        "CKAN_MCP_BASE_URL": "http://localhost:8787"
      }
    }
  }
}
```

### 1-3. 有効化

1. Cursor を再起動するか、コマンドパレット → **Developer: Reload Window**
2. **Settings → Tools & MCP** で `ckan-open-data` が有効か確認
3. Agent / Composer で「仙台市のオープンデータで公共施設を検索して」などと依頼

### 配置場所

| ファイル | スコープ |
|----------|----------|
| `<project>/.cursor/mcp.json` | このリポジトリだけ |
| `~/.cursor/mcp.json` | 全プロジェクト |

---

## 2. OpenCode

OpenCode は `opencode.json` の `mcp` オブジェクトで MCP を定義します。  
本サーバーは **stdio ブリッジ**（`type: "local"`）で接続してください。

### 2-1. プロジェクトで使う（推奨）

リポジトリをクローンしたディレクトリで:

```bash
cd /path/to/ckan-mcp-worker
npm install

# どちらか一方をコピー（中身は同等の例）
cp opencode.json.example opencode.json
# または
mkdir -p .opencode && cp .opencode/opencode.json.example .opencode/opencode.json
```

`CKAN_MCP_BASE_URL` と、使うサーバー定義の `enabled` を編集します（本番だけ使うなら `ckan-open-data-production` を `enabled: true` に）。

**本番の例**（`opencode.json`）:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ckan-open-data": {
      "type": "local",
      "command": ["node", "scripts/mcp-stdio-bridge.mjs"],
      "enabled": true,
      "timeout": 120000,
      "environment": {
        "CKAN_MCP_BASE_URL": "https://ckan-mcp-worker.YOUR_SUBDOMAIN.workers.dev"
      }
    }
  }
}
```

**ローカル**（`wrangler dev` 起動中）:

```json
"environment": {
  "CKAN_MCP_BASE_URL": "http://localhost:8787"
}
```

- `command` は **プロジェクトルートからの相対パス**で動作します（OpenCode をリポジトリ直下で開く想定）。
- 設定例ファイル: [`opencode.json.example`](../opencode.json.example) / [`.opencode/opencode.json.example`](../.opencode/opencode.json.example)

### 2-2. 全プロジェクトで使う（グローバル）

`~/.config/opencode/opencode.json` に同じ `mcp` ブロックを書きます。  
`command` にはブリッジの **絶対パス**を指定してください。

```json
"command": ["/absolute/path/to/ckan-mcp-worker/scripts/mcp-stdio-bridge.mjs"]
```

### 2-3. CLI で追加（対話式）

```bash
opencode mcp add
```

プロンプトに従い、`type: local`・`command`・環境変数 `CKAN_MCP_BASE_URL` を設定します。  
反映後は **OpenCode を再起動**してください。

### 2-4. 確認

1. プロジェクトルートで `opencode` を起動
2. `/status` または MCP 一覧で `ckan-open-data` が表示されるか確認
3. 例: 「仙台市のオープンデータで『人口』を search_datasets して」

### 配置場所（優先度の目安）

| ファイル | スコープ |
|----------|----------|
| `~/.config/opencode/opencode.json` | 全プロジェクト |
| `opencode.json`（リポジトリルート） | このプロジェクト |
| `.opencode/opencode.json` | このプロジェクト（推奨ディレクトリ） |

### OpenCode で使わない設定

```json
{
  "mcp": {
    "ckan-open-data": {
      "type": "remote",
      "url": "https://ckan-mcp-worker.example.workers.dev"
    }
  }
}
```

上記は **動作しません**（当 Worker は MCP over HTTP ではなく REST API のため）。必ず `type: "local"` + ブリッジを使ってください。

---

## 3. Claude Desktop

`claude_desktop_config.json` に追加します（macOS の例）。

```json
{
  "mcpServers": {
    "ckan-open-data": {
      "command": "node",
      "args": ["/absolute/path/to/ckan-mcp-worker/scripts/mcp-stdio-bridge.mjs"],
      "env": {
        "CKAN_MCP_BASE_URL": "https://ckan-mcp-worker.YOUR_SUBDOMAIN.workers.dev"
      }
    }
  }
}
```

| OS | 設定ファイル |
|----|----------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Claude Desktop を再起動してください。

---

## 4. ブリッジを手動で試す（デバッグ）

```bash
cd /path/to/ckan-mcp-worker
npm install

# ローカル Worker が起動している状態で
CKAN_MCP_BASE_URL=http://localhost:8787 node scripts/mcp-stdio-bridge.mjs
```

別ターミナルから MCP クライアント（例: `npx @modelcontextprotocol/inspector`）で stdio 接続を試せます。

---

## 5. HTTP API を直接使う（MCP 以外）

エージェント不要で API だけ使う場合の例です。

```bash
export BASE="https://ckan-mcp-worker.YOUR_SUBDOMAIN.workers.dev"

# ツール一覧
curl "$BASE/tools"

# データセット検索（仙台市）
curl "$BASE/tools/call" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "search_datasets",
    "arguments": {
      "portal": "sendai",
      "keyword": "公共施設",
      "limit": 5
    }
  }'
```

### ツールとポータル

| ツール | 説明 | portal |
|--------|------|--------|
| `search_datasets` | キーワード検索 | `sendai` / `geospatial` / `bodik` |
| `get_dataset` | データセット詳細 | 同上 |
| `search_records` | 表データ検索（DataStore 対応時のみ） | 同上（G空間は非対応のことが多い） |
| `list_organizations` | 組織一覧 | 同上 |

### レスポンス形式

成功時（MCP 互換）:

```json
{
  "content": [{ "type": "text", "text": "{ ... JSON ... }" }]
}
```

エラー時:

```json
{
  "content": [{ "type": "text", "text": "エラーメッセージ" }],
  "isError": true
}
```

---

## 6. 利用例（エージェントへの指示例）

Cursor / OpenCode のエージェントにそのまま渡せるプロンプト例です。

```
ckan-open-data の search_datasets で、portal=sendai、keyword=人口、limit=5 として検索し、
結果のデータセット名を要約してください。
```

```
geospatial ポータルで PLATEAU を検索し、先頭のデータセットの id を get_dataset で詳細を取得してください。
```

---

## 7. 制限・注意

| 項目 | 内容 |
|------|------|
| レート制限 | 同一 IP で 60 リクエスト / 60 秒（超過時 HTTP 429） |
| 認証 | ツール API は公開（トークン不要）。`/admin` のみ `ADMIN_TOKEN` |
| キャッシュ | 同一条件の検索は KV にキャッシュ（最大 1 時間程度） |
| G空間 | `search_records`（DataStore）は利用不可のことが多い |

---

## 8. トラブルシュート

| 症状 | 対処 |
|------|------|
| Cursor にツールが出ない | `mcp.json` のパス・JSON を確認。Reload Window |
| OpenCode に MCP が出ない | `opencode.json` の場所（ルート or `.opencode/`）。再起動。`npm install` 済みか |
| `ECONNREFUSED` | `CKAN_MCP_BASE_URL` が正しいか、`npm run dev` / 本番 URL を確認 |
| ブリッジ起動でモジュールエラー | リポジトリで `npm install` |
| 429 | しばらく待つか、リクエスト頻度を下げる |

関連: [README.md](../README.md) · [DEPLOYMENT.md](./DEPLOYMENT.md)
