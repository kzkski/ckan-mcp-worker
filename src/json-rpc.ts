import type { Context } from "hono";
import type { Env } from "./env";
import { handleToolCall } from "./tools-handler";
import { TOOLS } from "./tools";

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

const SERVER_INFO = {
  name: "ckan-mcp-worker",
  version: "1.0.0",
} as const;

function errorResponse(
  id: JsonRpcId | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function successResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function isInitializeRequest(
  message: JsonRpcRequest
): message is JsonRpcRequest & { method: "initialize" } {
  return message.method === "initialize";
}

/**
 * MCP JSON-RPC 2.0 メッセージを処理する。
 * 通知（id なし）の場合は null を返す。
 */
export async function handleJsonRpc(
  c: Context<{ Bindings: Env }>,
  message: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (message.id === undefined) return null;
    return errorResponse(message.id ?? null, -32600, "Invalid Request");
  }

  const { method, params } = message;
  const id = message.id;
  if (id === undefined) {
    if (
      method === "notifications/initialized" ||
      method === "initialized"
    ) {
      return null;
    }
    return null;
  }

  switch (method) {
    case "initialize": {
      return successResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }

    case "notifications/initialized":
    case "initialized":
      return null;

    case "ping": {
      return successResponse(id, {});
    }

    case "tools/list": {
      return successResponse(id, { tools: TOOLS });
    }

    case "tools/call": {
      const name =
        typeof params?.name === "string" ? params.name : undefined;
      const args =
        params?.arguments &&
        typeof params.arguments === "object" &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};

      const outcome = await handleToolCall(c, { name, arguments: args });
      const result = await outcome.response.json();
      return successResponse(id, result);
    }

    default: {
      return errorResponse(id, -32601, `Method not found: ${method}`);
    }
  }
}

export async function handleJsonRpcBatch(
  c: Context<{ Bindings: Env }>,
  messages: JsonRpcRequest[]
): Promise<JsonRpcResponse[]> {
  const responses: JsonRpcResponse[] = [];
  for (const message of messages) {
    const response = await handleJsonRpc(c, message);
    if (response !== null) {
      responses.push(response);
    }
  }
  return responses;
}
