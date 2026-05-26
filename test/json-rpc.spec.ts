import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("MCP JSON-RPC", () => {
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

	it("GET /sse returns event-stream with endpoint event", async () => {
		const response = await SELF.fetch("https://example.com/sse");
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("Set-Cookie")).toMatch(/mcp-session-id=/);

		const reader = response.body?.getReader();
		expect(reader).toBeDefined();
		const { value } = await reader!.read();
		const text = new TextDecoder().decode(value);
		expect(text).toContain("event: endpoint");
		expect(text).toContain("data: /message");
		reader!.releaseLock();
	});

	it("POST /message without session returns 400", async () => {
		const response = await SELF.fetch("https://example.com/message", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "ping",
			}),
		});
		expect(response.status).toBe(400);
	});
});
