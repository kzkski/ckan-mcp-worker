import { Hono } from "hono";
import { cors } from "hono/cors";
import { admin } from "./admin";
import type { Env } from "./env";
import { deleteOldLogs, insertRequestLog } from "./logger";
import { PORTALS } from "./portals";
import {
  handleMcpPost,
  handleSseConnect,
  handleSseMessage,
} from "./mcp-transport";
import { handleToolCall } from "./tools-handler";
import { TOOLS } from "./tools";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({
    name: "ckan-mcp-worker",
    version: "1.0.0",
    description: "CKAN MCP Server for Japanese open data portals",
    portals: Object.keys(PORTALS),
    transports: {
      sse: "GET /sse, POST /message",
      streamableHttp: "POST /mcp",
      rest: "GET /tools, POST /tools/call",
    },
  });
});

app.get("/tools", (c) => {
  return c.json({ tools: TOOLS });
});

// 旧 SSE トランスポート（OpenCode 現行版）
app.get("/sse", (c) => handleSseConnect(c));
app.post("/message", (c) => handleSseMessage(c));

// Streamable HTTP トランスポート（新仕様）
app.post("/mcp", (c) => handleMcpPost(c));

app.route("/admin", admin);

app.post("/tools/call", async (c) => {
  const started = Date.now();
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const country = c.req.header("CF-IPCountry") ?? null;
  const userAgent = c.req.header("User-Agent") ?? null;

  const { success: withinLimit } = await c.env.RATE_LIMITER.limit({ key: ip });

  if (!withinLimit) {
    const durationMs = Date.now() - started;
    c.executionCtx.waitUntil(
      insertRequestLog(c.env.LOG_DB, c.env, {
        ip,
        country,
        userAgent,
        tool: "rate_limited",
        portal: null,
        keyword: null,
        argsJson: "{}",
        status: 429,
        isError: true,
        durationMs,
        cacheHit: false,
        rateLimited: true,
      })
    );
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  let body: { name?: string; arguments?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    const durationMs = Date.now() - started;
    c.executionCtx.waitUntil(
      insertRequestLog(c.env.LOG_DB, c.env, {
        ip,
        country,
        userAgent,
        tool: "invalid_body",
        portal: null,
        keyword: null,
        argsJson: "{}",
        status: 400,
        isError: true,
        durationMs,
        cacheHit: false,
        rateLimited: false,
      })
    );
    return c.json(
      {
        content: [{ type: "text", text: "Invalid JSON body" }],
        isError: true,
      },
      400
    );
  }

  const outcome = await handleToolCall(c, body);
  const durationMs = Date.now() - started;

  c.executionCtx.waitUntil(
    insertRequestLog(c.env.LOG_DB, c.env, {
      ip,
      country,
      userAgent,
      tool: outcome.tool,
      portal: outcome.portal,
      keyword: outcome.keyword,
      argsJson: outcome.argsJson,
      status: outcome.status,
      isError: outcome.isError,
      durationMs,
      cacheHit: outcome.cacheHit,
      rateLimited: false,
    })
  );

  return outcome.response;
});

export default {
  fetch: app.fetch,
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(deleteOldLogs(env.LOG_DB));
  },
};
