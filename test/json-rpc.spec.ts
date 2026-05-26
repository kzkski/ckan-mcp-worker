import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { beforeAll, describe, it, expect } from "vitest";
import { getRecentLogs } from "../src/logger";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("MCP JSON-RPC", () => {
	beforeAll(async () => {
		await env.LOG_DB.prepare(
			`CREATE TABLE IF NOT EXISTS request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT (datetime('now')),
        ip_hash TEXT,
        country TEXT,
        user_agent TEXT,
        tool TEXT NOT NULL,
        portal TEXT,
        keyword TEXT,
        args_json TEXT NOT NULL,
        status INTEGER NOT NULL,
        is_error INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL,
        cache_hit INTEGER NOT NULL DEFAULT 0,
        rate_limited INTEGER NOT NULL DEFAULT 0
      )`
		).run();
	});
	it("POST /mcp returns initialize result with Mcp-Session-Id", async () => {
		const request = new IncomingRequest("http://example.com/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "test", version: "0" },
				},
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get("Mcp-Session-Id")).toBeTruthy();
		const json = (await response.json()) as {
			jsonrpc: string;
			id: number;
			result: { serverInfo: { name: string } };
		};
		expect(json.result.serverInfo.name).toBe("ckan-mcp-worker");
	});

	it("POST /mcp tools/list returns tools", async () => {
		const response = await SELF.fetch("https://example.com/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
			}),
		});
		expect(response.status).toBe(200);
		const json = (await response.json()) as {
			result: { tools: Array<{ name: string }> };
		};
		expect(json.result.tools.length).toBeGreaterThan(0);
		expect(json.result.tools[0].name).toBe("search_datasets");
	});

	it("POST /mcp tools/call records request log", async () => {
		const request = new IncomingRequest("http://example.com/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "search_datasets",
					arguments: { portal: "not-a-portal", keyword: "test" },
				},
			}),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		const logs = await getRecentLogs(env.LOG_DB, 1);
		expect(logs.length).toBeGreaterThan(0);
		expect(logs[0].tool).toBe("search_datasets");
		expect(logs[0].keyword).toBe("test");
	});
});
