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
});
