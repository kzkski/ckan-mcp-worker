import { Hono } from "hono";
import { cors } from "hono/cors";
import { admin } from "./admin";
import type { Env } from "./env";
import { deleteOldLogs, scheduleRequestLog } from "./logger";
import { PORTALS } from "./portals";
import { handleMcpPost } from "./mcp-transport";
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
      mcp: "POST /mcp",
      rest: "GET /tools, POST /tools/call",
    },
  });
});

app.get("/tools", (c) => {
  return c.json({ tools: TOOLS });
});

app.post("/mcp", (c) => handleMcpPost(c));

app.route("/admin", admin);

app.post("/tools/call", async (c) => {
  const started = Date.now();
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

  const { success: withinLimit } = await c.env.RATE_LIMITER.limit({ key: ip });

  if (!withinLimit) {
    scheduleRequestLog(c, {
      tool: "rate_limited",
      portal: null,
      keyword: null,
      argsJson: "{}",
      status: 429,
      isError: true,
      durationMs: Date.now() - started,
      cacheHit: false,
      rateLimited: true,
    });
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  let body: { name?: string; arguments?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    scheduleRequestLog(c, {
      tool: "invalid_body",
      portal: null,
      keyword: null,
      argsJson: "{}",
      status: 400,
      isError: true,
      durationMs: Date.now() - started,
      cacheHit: false,
      rateLimited: false,
    });
    return c.json(
      {
        content: [{ type: "text", text: "Invalid JSON body" }],
        isError: true,
      },
      400
    );
  }

  const outcome = await handleToolCall(c, body);
  scheduleRequestLog(c, {
    tool: outcome.tool,
    portal: outcome.portal,
    keyword: outcome.keyword,
    argsJson: outcome.argsJson,
    status: outcome.status,
    isError: outcome.isError,
    durationMs: Date.now() - started,
    cacheHit: outcome.cacheHit,
    rateLimited: false,
  });

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
