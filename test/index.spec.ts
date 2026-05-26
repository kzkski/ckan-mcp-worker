import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("ckan-mcp-worker", () => {
	it("GET / returns server info (unit style)", async () => {
		const request = new IncomingRequest("http://example.com/");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const json = (await response.json()) as { name: string; portals: string[] };
		expect(json.name).toBe("ckan-mcp-worker");
		expect(json.portals).toContain("sendai");
	});

	it("GET / returns server info (integration style)", async () => {
		const response = await SELF.fetch("https://example.com/");
		expect(response.status).toBe(200);
		const json = (await response.json()) as { name: string };
		expect(json.name).toBe("ckan-mcp-worker");
	});
});
