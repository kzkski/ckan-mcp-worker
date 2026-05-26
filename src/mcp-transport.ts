import type { Context } from "hono";
import type { Env } from "./env";
import {
  handleJsonRpc,
  handleJsonRpcBatch,
  isInitializeRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./json-rpc";

function sseDataLine(payload: JsonRpcResponse): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function wantsEventStream(accept: string | undefined): boolean {
  return accept?.includes("text/event-stream") ?? false;
}

async function parseJsonRpcBody(
  c: Context<{ Bindings: Env }>
): Promise<JsonRpcRequest | JsonRpcRequest[] | Response> {
  try {
    const body: unknown = await c.req.json();
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return c.json({ error: "Empty batch" }, 400);
      }
      return body as JsonRpcRequest[];
    }
    return body as JsonRpcRequest;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
}

export async function handleMcpPost(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success: withinLimit } = await c.env.RATE_LIMITER.limit({ key: ip });
  if (!withinLimit) {
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const parsed = await parseJsonRpcBody(c);
  if (parsed instanceof Response) {
    return parsed;
  }

  const accept = c.req.header("Accept");
  const useSse = wantsEventStream(accept);

  if (Array.isArray(parsed)) {
    const responses = await handleJsonRpcBatch(c, parsed);
    if (useSse) {
      const body = responses.map((r) => sseDataLine(r)).join("");
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }
    return c.json(responses);
  }

  const response = await handleJsonRpc(c, parsed);
  const headers = new Headers();

  if (isInitializeRequest(parsed) && response !== null) {
    headers.set("Mcp-Session-Id", crypto.randomUUID());
  }

  if (response === null) {
    return new Response(null, { status: 204, headers });
  }

  if (useSse) {
    headers.set("Content-Type", "text/event-stream");
    headers.set("Cache-Control", "no-cache");
    return new Response(sseDataLine(response), { headers });
  }

  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(response), { headers });
}
