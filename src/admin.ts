import { Hono } from "hono";
import type { Env } from "./env";
import {
  deleteOldLogs,
  getRecentLogs,
  getStats,
  type StatsPeriod,
} from "./logger";

const admin = new Hono<{ Bindings: Env }>();

function parsePeriod(value: string | undefined): StatsPeriod {
  if (value === "7d" || value === "30d") return value;
  return "24h";
}

export function isAuthorized(c: {
  req: { header: (n: string) => string | undefined };
  env: Env;
}): boolean {
  const token = c.env.ADMIN_TOKEN;
  if (!token) return false;
  const auth = c.req.header("Authorization");
  return auth === `Bearer ${token}`;
}

admin.use("/api/*", async (c, next) => {
  if (!c.env.ADMIN_TOKEN) {
    return c.json({ error: "ADMIN_TOKEN is not configured" }, 503);
  }
  if (!isAuthorized(c)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

admin.get("/", (c) => {
  if (!c.env.ADMIN_TOKEN) {
    return c.text("ADMIN_TOKEN is not configured", 503);
  }
  return c.html(dashboardPage());
});

admin.get("/api/stats", async (c) => {
  const period = parsePeriod(c.req.query("period"));
  const stats = await getStats(c.env.LOG_DB, period);
  return c.json(stats);
});

admin.get("/api/logs", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const logs = await getRecentLogs(c.env.LOG_DB, limit);
  return c.json({ logs });
});

admin.post("/api/prune", async (c) => {
  const deleted = await deleteOldLogs(c.env.LOG_DB);
  return c.json({ deleted });
});

function dashboardPage(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CKAN MCP — 統計ダッシュボード</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem 1.5rem 2rem; line-height: 1.5; }
    h1 { font-size: 1.25rem; }
    #loginPanel { max-width: 20rem; margin: 2rem 0; padding: 1rem; border: 1px solid #8884; border-radius: 8px; }
    #loginPanel input, #loginPanel button { width: 100%; padding: 0.5rem; margin-top: 0.5rem; box-sizing: border-box; }
    #dashboard { display: none; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 1rem; }
    select, button { padding: 0.35rem 0.6rem; cursor: pointer; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
    .card { border: 1px solid #8884; border-radius: 8px; padding: 0.75rem 1rem; }
    .card strong { display: block; font-size: 1.5rem; }
    .card span { font-size: 0.85rem; opacity: 0.8; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { border-bottom: 1px solid #8884; padding: 0.4rem 0.5rem; text-align: left; }
    th { position: sticky; top: 0; background: Canvas; }
    .err { color: #c00; }
    .ok { color: #080; }
    section { margin-bottom: 2rem; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 700px) { .grid2 { grid-template-columns: 1fr; } }
    #status { font-size: 0.9rem; opacity: 0.7; }
  </style>
</head>
<body>
  <h1>CKAN MCP 統計ダッシュボード</h1>

  <div id="loginPanel">
    <p>ADMIN_TOKEN を入力してログインしてください。</p>
    <input type="password" id="tokenInput" placeholder="トークン" autocomplete="current-password" />
    <button type="button" id="loginBtn">ログイン</button>
  </div>

  <div id="dashboard">
    <div class="toolbar">
      <label>期間 <select id="period">
        <option value="24h">24時間</option>
        <option value="7d">7日</option>
        <option value="30d">30日</option>
      </select></label>
      <button type="button" id="refresh">更新</button>
      <button type="button" id="logout">ログアウト</button>
      <span id="status"></span>
    </div>

    <div class="cards" id="summary"></div>

    <div class="grid2">
      <section>
        <h2>ツール別</h2>
        <table><thead><tr><th>ツール</th><th>件数</th></tr></thead><tbody id="byTool"></tbody></table>
      </section>
      <section>
        <h2>ポータル別</h2>
        <table><thead><tr><th>ポータル</th><th>件数</th></tr></thead><tbody id="byPortal"></tbody></table>
      </section>
    </div>

    <section>
      <h2>人気キーワード（search_datasets）</h2>
      <table><thead><tr><th>キーワード</th><th>件数</th></tr></thead><tbody id="keywords"></tbody></table>
    </section>

    <section>
      <h2>直近のリクエスト</h2>
      <table>
        <thead>
          <tr>
            <th>時刻</th><th>ツール</th><th>ポータル</th><th>キーワード</th>
            <th>状態</th><th>ms</th><th>cache</th><th>国</th>
          </tr>
        </thead>
        <tbody id="logs"></tbody>
      </table>
    </section>
  </div>

  <script>
    function getToken() { return sessionStorage.getItem('adminToken'); }
    function setToken(t) { sessionStorage.setItem('adminToken', t); }
    function clearToken() { sessionStorage.removeItem('adminToken'); }

    function authHeaders() {
      return { Authorization: 'Bearer ' + getToken(), Accept: 'application/json' };
    }

    function showDashboard(show) {
      document.getElementById('loginPanel').style.display = show ? 'none' : 'block';
      document.getElementById('dashboard').style.display = show ? 'block' : 'none';
    }

    async function api(path) {
      const res = await fetch(path, { headers: authHeaders() });
      if (res.status === 401) {
        clearToken();
        showDashboard(false);
        throw new Error('認証に失敗しました');
      }
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }

    function row(cells) {
      const tr = document.createElement('tr');
      cells.forEach((html) => {
        const td = document.createElement('td');
        td.innerHTML = html;
        tr.appendChild(td);
      });
      return tr;
    }

    function fillTable(id, rows, emptyMsg) {
      const el = document.getElementById(id);
      el.replaceChildren();
      if (!rows.length) {
        el.appendChild(row([emptyMsg || '—']));
        return;
      }
      rows.forEach((r) => el.appendChild(row(r)));
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    async function load() {
      const period = document.getElementById('period').value;
      document.getElementById('status').textContent = '読み込み中…';
      try {
        const [stats, logsData] = await Promise.all([
          api('/admin/api/stats?period=' + period),
          api('/admin/api/logs?limit=50'),
        ]);
        const s = stats.summary;
        document.getElementById('summary').innerHTML = [
          ['総リクエスト', s.total],
          ['エラー', s.errors],
          ['レート制限', s.rate_limited],
          ['キャッシュヒット', s.cache_hits],
          ['平均応答 ms', s.avg_duration_ms ?? '—'],
        ].map(([label, val]) =>
          '<div class="card"><strong>' + val + '</strong><span>' + label + '</span></div>'
        ).join('');

        fillTable('byTool', stats.byTool.map((x) => [x.tool, x.count]));
        fillTable('byPortal', stats.byPortal.map((x) => [x.portal, x.count]));
        fillTable('keywords', stats.topKeywords.map((x) => [escapeHtml(x.keyword), x.count]), 'データなし');

        fillTable('logs', logsData.logs.map((l) => [
          l.ts,
          l.tool,
          l.portal || '—',
          escapeHtml(l.keyword || '—'),
          l.rate_limited ? '<span class="err">429</span>' :
            (l.is_error ? '<span class="err">ERR</span>' : '<span class="ok">' + l.status + '</span>'),
          l.duration_ms,
          l.cache_hit ? 'HIT' : '—',
          l.country || '—',
        ]), 'ログなし');

        document.getElementById('status').textContent = '更新: ' + new Date().toLocaleString('ja-JP');
      } catch (e) {
        document.getElementById('status').textContent = 'エラー: ' + e.message;
      }
    }

    document.getElementById('loginBtn').onclick = () => {
      const t = document.getElementById('tokenInput').value.trim();
      if (!t) return;
      setToken(t);
      showDashboard(true);
      load();
    };

    document.getElementById('refresh').onclick = load;
    document.getElementById('period').onchange = load;
    document.getElementById('logout').onclick = () => {
      clearToken();
      showDashboard(false);
    };

    if (getToken()) {
      showDashboard(true);
      load();
    } else {
      showDashboard(false);
    }
  </script>
</body>
</html>`;
}

export { admin };
