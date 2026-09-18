import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeAgentSession } from "@/agent/identity/session-client";
import { AgentIdentityResetError, AgentTransport } from "@/agent/agui/transport";

afterEach(() => vi.unstubAllGlobals());
const valid = {
	visitorId: "visitor_550e8400-e29b-41d4-a716-446655440000",
	resetThread: false,
	authStatus: "guest",
};
describe("browser BFF session boundary", () => {
	it("merges concurrent initialization but does not cache later authentication", async () => {
		const fetcher = vi.fn(async () => Response.json(valid));
		vi.stubGlobal("fetch", fetcher);
		await Promise.all([initializeAgentSession(), initializeAgentSession()]);
		expect(fetcher).toHaveBeenCalledOnce();
		await initializeAgentSession();
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/agent/session",
			expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }),
		);
	});
	it("rejects invalid initialization and allows subsequent retry", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(Response.json({ ...valid, visitorId: "bad" }))
				.mockResolvedValueOnce(Response.json(valid)),
		);
		await expect(initializeAgentSession()).rejects.toThrow("Invalid Agent session");
		expect(await initializeAgentSession()).toEqual(valid);
	});
	it("reports identity reset once without retrying the original tool receipt", async () => {
		const reset = vi.fn();
		const fetcher = vi.fn(async () => Response.json({ error: "agent_identity_reset" }, { status: 409 }));
		const transport = new AgentTransport({
			visitorId: valid.visitorId,
			fetch: fetcher,
			onIdentityReset: reset,
		});
		await expect(
			transport.run({
				threadId: "t",
				runId: "r",
				messages: [],
				state: {},
				tools: [],
				context: [],
				forwardedProps: { toolResults: [] },
			}),
		).rejects.toBeInstanceOf(AgentIdentityResetError);
		expect(fetcher).toHaveBeenCalledOnce();
		expect(reset).toHaveBeenCalledOnce();
	});
});
