# MCP クライアント接続ガイド

この Worker は MCP トランスポート（**`/sse`**・`/mcp`）と REST API（`GET /tools`・`POST /tools/call`）を提供します。

| 接続方式 | 向いている用途 |
|----------|----------------|
| **`type: "remote"` + `/sse`**（推奨） | **OpenCode**（リモート MCP は SSE のみ対応） |
| **stdio ブリッジ** | Cursor、Claude Desktop |
| **`POST /mcp`**（Streamable HTTP） | OpenCode 非対応。将来のクライアント向け |
| **HTTP を直接呼ぶ** | curl、自作アプリ、n8n 等 |

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

## 2. OpenCode（推奨: リモート SSE）

OpenCode は `opencode.json` の `mcp` で **`type: "remote"`** を指定します。

> **重要:** OpenCode のリモート MCP は **SSE トランスポート（`/sse`）のみ**対応です。`POST /mcp` の Streamable HTTP は **使えません**。URL は必ず **`/sse` で終えて**ください。

### 2-1. 設定例

```bash
# どちらか一方をコピー
cp opencode.json.example opencode.json
# または
mkdir -p .opencode && cp .opencode/opencode.json.example .opencode/opencode.json
```

**本番**（`YOUR_SUBDOMAIN` を置き換え）:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ckan-open-data": {
      "type": "remote",
      "url": "https://ckan-mcp-worker.YOUR_SUBDOMAIN.workers.dev/sse",
      "enabled": true,
      "timeout": 120000
    }
  }
}
```

**ローカル**（`npm run dev` 起動中）:

```json
"url": "http://localhost:8787/sse"
```

接続の流れ:

1. OpenCode が `GET /sse` で SSE を開く
2. Worker が `event: endpoint` / `data: /message` を送信し、セッション Cookie を設定
3. OpenCode が `POST /message` で JSON-RPC を送り、応答を SSE で受信

設定例: [`opencode.json.example`](../opencode.json.example) / [`.opencode/opencode.json.example`](../.opencode/opencode.json.example)

### 2-2. グローバル設定

`~/.config/opencode/opencode.json` に同じ `mcp` ブロックを書けます。

### 2-3. 確認

1. プロジェクトルートで `opencode` を起動（本番 URL の場合は Worker がデプロイ済みであること）
2. `/status` または MCP 一覧で `ckan-open-data` が表示されるか確認
3. 例: 「仙台市のオープンデータで『人口』を search_datasets して」

### 配置場所（優先度の目安）

| ファイル | スコープ |
|----------|----------|
| `~/.config/opencode/opencode.json` | 全プロジェクト |
| `opencode.json`（リポジトリルート） | このプロジェクト |
| `.opencode/opencode.json` | このプロジェクト（推奨ディレクトリ） |

### OpenCode で使えない URL

| URL | 理由 |
|-----|------|
| `https://...workers.dev`（パスのみ `/`） | MCP エンドポイントではない |
| `https://...workers.dev/mcp` | OpenCode は Streamable HTTP 未対応 |
| `https://...workers.dev/tools` | REST API（MCP ではない） |

> **注意:** SSE セッションは Worker インスタンス内のインメモリ Map で管理します。Cloudflare Workers の接続時間制限の影響を受けることがあります。

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
| レート制限 | 同一 IP で 60 リクエスト / 60 秒（`POST /tools/call`・`POST /mcp`。超過時 HTTP 429） |
| SSE セッション | インメモリ Map（同一 Worker インスタンス内のみ。長時間接続に制限あり） |
| 認証 | ツール API は公開（トークン不要）。`/admin` のみ `ADMIN_TOKEN` |
| キャッシュ | 同一条件の検索は KV にキャッシュ（最大 1 時間程度） |
| G空間 | `search_records`（DataStore）は利用不可のことが多い |

---

## 8. トラブルシュート

| 症状 | 対処 |
|------|------|
| Cursor にツールが出ない | `mcp.json` のパス・JSON を確認。Reload Window |
| OpenCode に MCP が出ない | `opencode.json` の場所・URL が **`/sse` で終わっているか**。再起動 |
| OpenCode で接続できない | `/mcp` ではなく **`/sse`** か確認。本番は Worker デプロイ済みか |
| `ECONNREFUSED`（Cursor ブリッジ） | `CKAN_MCP_BASE_URL`・`npm run dev` / 本番 URL を確認 |
| ブリッジ起動でモジュールエラー（Cursor） | リポジトリで `npm install` |
| 429 | しばらく待つか、リクエスト頻度を下げる |

関連: [README.md](../README.md) · [DEPLOYMENT.md](./DEPLOYMENT.md)
