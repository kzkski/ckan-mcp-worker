#!/usr/bin/env bash
# 本番用 Cloudflare リソースの初回セットアップ（KV / D1 / シークレット / マイグレーション）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WRANGLER_JSONC="wrangler.jsonc"
SKIP_DEPLOY=true
SKIP_SECRETS=false

usage() {
  cat <<'EOF'
Usage: scripts/setup-prod.sh [options]

Options:
  --deploy          セットアップ後に wrangler deploy を実行
  --skip-secrets    ADMIN_TOKEN / LOG_HASH_SALT の登録をスキップ
  --skip-deploy     （既定）デプロイしない
  -h, --help        このヘルプを表示

環境変数:
  ADMIN_TOKEN       本番用管理トークン（未設定時は自動生成して表示）
  LOG_HASH_SALT     任意。IP ハッシュ用ソルト

例:
  scripts/setup-prod.sh --deploy
  ADMIN_TOKEN="$(openssl rand -hex 32)" scripts/setup-prod.sh --deploy
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy) SKIP_DEPLOY=false; shift ;;
    --skip-deploy) SKIP_DEPLOY=true; shift ;;
    --skip-secrets) SKIP_SECRETS=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

log() { echo "==> $*"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required." >&2
    exit 1
  fi
}

need_cmd npx
need_cmd openssl

if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "Error: Not logged in. Run: npx wrangler login" >&2
  exit 1
fi

is_placeholder_kv() {
  grep -q '"id": "00000000000000000000000000000000"' "$WRANGLER_JSONC"
}

is_placeholder_d1() {
  grep -q '"database_id": "00000000-0000-0000-0000-000000000001"' "$WRANGLER_JSONC"
}

if is_placeholder_kv; then
  log "Creating KV namespace CACHE_KV (production)…"
  npx wrangler kv namespace create CACHE_KV --update-config
  log "Creating KV namespace CACHE_KV (preview)…"
  npx wrangler kv namespace create CACHE_KV --preview --update-config
else
  log "KV IDs already configured in wrangler.jsonc — skipping KV creation"
fi

if is_placeholder_d1; then
  log "Creating D1 database ckan-mcp-logs…"
  npx wrangler d1 create ckan-mcp-logs --update-config
else
  log "D1 database_id already configured — skipping D1 creation"
fi

if [[ "$SKIP_SECRETS" == false ]]; then
  if [[ -z "${ADMIN_TOKEN:-}" ]]; then
    ADMIN_TOKEN="$(openssl rand -hex 32)"
    echo ""
    echo "Generated ADMIN_TOKEN (save securely):"
    echo "  $ADMIN_TOKEN"
    echo ""
  fi
  log "Setting ADMIN_TOKEN secret on Cloudflare…"
  printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN

  if [[ -n "${LOG_HASH_SALT:-}" ]]; then
    log "Setting LOG_HASH_SALT secret…"
    printf '%s' "$LOG_HASH_SALT" | npx wrangler secret put LOG_HASH_SALT
  else
    log "LOG_HASH_SALT not set — skipping (optional)"
  fi
fi

log "Applying D1 migrations (remote)…"
npm run db:migrate:remote

log "Regenerating TypeScript types…"
npm run cf-typegen

if [[ "$SKIP_DEPLOY" == false ]]; then
  log "Deploying to Cloudflare…"
  npm run deploy
  echo ""
  echo "Done. Worker URL:"
  npx wrangler deployments list 2>/dev/null | head -5 || true
  echo "Dashboard: https://dash.cloudflare.com/"
  echo "Admin UI: https://ckan-mcp-worker.<your-subdomain>.workers.dev/admin"
else
  echo ""
  echo "Setup complete. Deploy when ready:"
  echo "  npm run deploy:prod"
fi
