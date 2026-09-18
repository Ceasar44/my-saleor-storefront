import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getAgentServerConfig } from "@/agent/config/server";

export const testEnvironment = {
	NODE_ENV: "test",
	AGENT_ADAPTER_URL: "http://127.0.0.1:8000/api/agent",
	AGENT_BFF_ISSUER: "paper-storefront",
	AGENT_BFF_AUDIENCE: "agent-adapter",
	AGENT_BFF_KEY_ID: "key-1",
	AGENT_TENANT_ID: "tenant-1",
	AGENT_STORE_ID: "store-1",
	AGENT_BFF_SIGNING_SECRET: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64"),
	AGENT_VISITOR_COOKIE_SECRET: Buffer.alloc(32, 42).toString("base64"),
};
describe("server-only Agent configuration", () => {
	it("loads the complete configuration and decodes independent keys", () => {
		const config = getAgentServerConfig(testEnvironment);
		expect(config.signingKey.length).toBe(32);
		expect(config.secureCookies).toBe(false);
		expect(config.scope).toEqual({ tenant_id: "tenant-1", store_id: "store-1" });
	});
	it.each([
		{ AGENT_ADAPTER_URL: "https://adapter.test/api/agent?token=secret" },
		{ AGENT_ADAPTER_URL: "https://user:secret@adapter.test/api/agent" },
		{ AGENT_ADAPTER_URL: "http://external.test/api/agent" },
		{ NODE_ENV: "production" },
		{ AGENT_BFF_KEY_ID: "bad.key" },
		{ AGENT_BFF_SIGNING_SECRET: "short" },
		{ AGENT_VISITOR_COOKIE_SECRET: testEnvironment.AGENT_BFF_SIGNING_SECRET },
		{ AGENT_STORE_ID: "store\nspoof" },
	])("rejects invalid deployment configuration %j", (override) => {
		expect(() => getAgentServerConfig({ ...testEnvironment, ...override })).toThrow();
	});
});
