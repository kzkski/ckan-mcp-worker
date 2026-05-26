import type { Env } from "./env";

export type RequestLogInput = {
  ip: string;
  country: string | null;
  userAgent: string | null;
  tool: string;
  portal: string | null;
  keyword: string | null;
  argsJson: string;
  status: number;
  isError: boolean;
  durationMs: number;
  cacheHit: boolean;
  rateLimited: boolean;
};

const RETENTION_DAYS = 90;

export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export function summarizeArgs(
  args: Record<string, unknown>
): { json: string; keyword: string | null } {
  const summary: Record<string, unknown> = {};

  if (typeof args.portal === "string") summary.portal = args.portal;
  if (typeof args.keyword === "string") {
    summary.keyword = args.keyword.slice(0, 100);
  }
  if (typeof args.id === "string") summary.id = args.id.slice(0, 80);
  if (typeof args.resource_id === "string") {
    summary.resource_id = args.resource_id.slice(0, 80);
  }
  if (typeof args.query === "string") summary.query = args.query.slice(0, 100);
  if (typeof args.limit === "number") summary.limit = args.limit;
  if (typeof args.offset === "number") summary.offset = args.offset;
  if (args.filters && typeof args.filters === "object") {
    summary.filters = args.filters;
  }

  const keyword =
    typeof args.keyword === "string" ? args.keyword.slice(0, 100) : null;

  return { json: JSON.stringify(summary), keyword };
}

export async function insertRequestLog(
  db: D1Database,
  env: Env,
  input: RequestLogInput
): Promise<void> {
  const salt = env.LOG_HASH_SALT ?? env.ADMIN_TOKEN ?? "ckan-mcp-worker";
  const ipHash = await hashIp(input.ip, salt);

  await db
    .prepare(
      `INSERT INTO request_logs (
        ip_hash, country, user_agent, tool, portal, keyword, args_json,
        status, is_error, duration_ms, cache_hit, rate_limited
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      ipHash,
      input.country,
      input.userAgent?.slice(0, 256) ?? null,
      input.tool,
      input.portal,
      input.keyword,
      input.argsJson,
      input.status,
      input.isError ? 1 : 0,
      input.durationMs,
      input.cacheHit ? 1 : 0,
      input.rateLimited ? 1 : 0
    )
    .run();
}

export async function deleteOldLogs(
  db: D1Database,
  days = RETENTION_DAYS
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM request_logs WHERE ts < datetime('now', '-' || ? || ' days')`
    )
    .bind(days)
    .run();
  return result.meta.changes ?? 0;
}

export type StatsPeriod = "24h" | "7d" | "30d";

function periodToSql(period: StatsPeriod): string {
  switch (period) {
    case "24h":
      return "-1 day";
    case "7d":
      return "-7 days";
    case "30d":
      return "-30 days";
  }
}

export async function getStats(db: D1Database, period: StatsPeriod) {
  const offset = periodToSql(period);
  const since = `datetime('now', '${offset}')`;

  const summary = await db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN rate_limited = 1 THEN 1 ELSE 0 END) AS rate_limited,
        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) AS cache_hits,
        ROUND(AVG(duration_ms)) AS avg_duration_ms
      FROM request_logs WHERE ts >= ${since}`
    )
    .first<{
      total: number;
      errors: number;
      rate_limited: number;
      cache_hits: number;
      avg_duration_ms: number | null;
    }>();

  const byTool = await db
    .prepare(
      `SELECT tool, COUNT(*) AS count
       FROM request_logs WHERE ts >= ${since}
       GROUP BY tool ORDER BY count DESC`
    )
    .all<{ tool: string; count: number }>();

  const byPortal = await db
    .prepare(
      `SELECT portal, COUNT(*) AS count
       FROM request_logs WHERE ts >= ${since} AND portal IS NOT NULL
       GROUP BY portal ORDER BY count DESC`
    )
    .all<{ portal: string; count: number }>();

  const topKeywords = await db
    .prepare(
      `SELECT keyword, COUNT(*) AS count
       FROM request_logs
       WHERE ts >= ${since} AND keyword IS NOT NULL AND keyword != ''
       GROUP BY keyword ORDER BY count DESC LIMIT 10`
    )
    .all<{ keyword: string; count: number }>();

  return {
    period,
    summary: summary ?? {
      total: 0,
      errors: 0,
      rate_limited: 0,
      cache_hits: 0,
      avg_duration_ms: null,
    },
    byTool: byTool.results,
    byPortal: byPortal.results,
    topKeywords: topKeywords.results,
  };
}

export async function getRecentLogs(db: D1Database, limit = 50) {
  const result = await db
    .prepare(
      `SELECT
        id, ts, ip_hash, country, tool, portal, keyword, args_json,
        status, is_error, duration_ms, cache_hit, rate_limited
       FROM request_logs
       ORDER BY id DESC LIMIT ?`
    )
    .bind(limit)
    .all();

  return result.results;
}
