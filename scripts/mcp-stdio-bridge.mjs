#!/usr/bin/env node
/**
 * MCP (stdio) ↔ ckan-mcp-worker (HTTP) ブリッジ
 *
 * Cursor / Claude Desktop など標準 MCP クライアントから
 * デプロイ済み Worker の /tools / /tools/call を利用するためのローカルプロセスです。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE = (process.env.CKAN_MCP_BASE_URL ?? "http://localhost:8787").replace(
  /\/$/,
  ""
);

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

const server = new Server(
  { name: "ckan-open-data-bridge", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const data = await fetchJson(`${BASE}/tools`);
  return { tools: data.tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const data = await fetchJson(`${BASE}/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: request.params.name,
      arguments: request.params.arguments ?? {},
    }),
  });

  return {
    content: data.content,
    ...(data.isError ? { isError: true } : {}),
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
