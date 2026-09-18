import { afterEach, describe, expect, it, vi } from "vitest";
import { RunAgentInputSchema } from "@ag-ui/core";
vi.mock("server-only", () => ({}));
import { getAgentServerConfig } from "@/agent/config/server";
import { buildSignedClaims, prepareAdapterRequest, signAdapterRequest } from "@/agent/agui/adapter-auth";
import vector from "@/agent/agui/fixtures/bff-signature-v1.json";

const environment = {
	NODE_ENV: "test",
	AGENT_ADAPTER_URL: "https://adapter.test/api/agent",
	AGENT_BFF_ISSUER: "paper-storefront",
	AGENT_BFF_AUDIENCE: "agent-adapter",
	AGENT_BFF_KEY_ID: "key-1",
	AGENT_TENANT_ID: "tenant-1",
	AGENT_STORE_ID: "store-1",
	AGENT_BFF_SIGNING_SECRET: vector.keyBase64,
	AGENT_VISITOR_COOKIE_SECRET: Buffer.alloc(32, 42).toString("base64"),
};
const identity = {
	visitor_id: vector.claims.identity.visitor_id,
	status: "authenticated" as const,
	saleor_user_id: "VXNlcjox",
};
afterEach(() => vi.unstubAllEnvs());
describe("BFF request signing", () => {
	it("matches the independent Python v1 test vector exactly", () => {
		const config = getAgentServerConfig(environment);
		const claims = buildSignedClaims(identity, config, vector.claims.iat, vector.claims.jti);
		expect(claims).toEqual(vector.claims);
		expect(signAdapterRequest(vector.body, claims, config)).toBe(vector.authorization);
		for (const body of [vector.body + "\n", vector.body.replace("world", "changed")])
			expect(signAdapterRequest(body, claims, config)).not.toBe(vector.authorization);
		expect(
			signAdapterRequest(vector.body, claims, { ...config, adapterUrl: "https://adapter.test/agui" }),
		).not.toBe(vector.authorization);
	});
	it("signs the actual forwarded bytes without forwarding browser headers or Saleor credentials", async () => {
		for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
		const input = RunAgentInputSchema.parse({
			threadId: "t",
			runId: "r",
			messages: [],
			state: {},
			tools: [],
			context: [],
			forwardedProps: { toolResults: [] },
		});
		const prepared = await prepareAdapterRequest(
			input,
			identity,
			new Request("https://shop.test/api/agent", {
				headers: { Authorization: "browser-token", "X-Storefront-Authorization": "spoof" },
			}),
		);
		expect(prepared.body).toBe(JSON.stringify(input));
		const headers = new Headers(prepared.headers);
		expect(headers.get("authorization")).toBeNull();
		const signed = headers.get("x-storefront-authorization")!;
		const claims = JSON.parse(Buffer.from(signed.split(".")[2], "base64url").toString()) as ReturnType<
			typeof buildSignedClaims
		>;
		expect(signAdapterRequest(prepared.body, claims, getAgentServerConfig(environment))).toBe(signed);
		expect(claims.exp - claims.iat).toBe(60);
		const second = await prepareAdapterRequest(input, identity, new Request("https://shop.test/api/agent"));
		expect(new Headers(second.headers).get("x-storefront-authorization")).not.toBe(signed);
	});
	it.each(["anonymous", "unavailable"] as const)("does not sign a Saleor user for %s", (status) => {
		expect(
			buildSignedClaims({ ...identity, status }, getAgentServerConfig(environment)).identity,
		).not.toHaveProperty("saleor_user_id");
	});
});
