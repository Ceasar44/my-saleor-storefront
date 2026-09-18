import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/agent/identity/session-user", () => ({ resolveAgentSessionUser: vi.fn() }));
import { createAgentPost as createPost } from "@/agent/agui/server";
const visitorId = "visitor_550e8400-e29b-41d4-a716-446655440000";
const createAgentPost = (dependencies: Parameters<typeof createPost>[0]) =>
	createPost({ resolveVisitor: async () => ({ visitorId, resetThread: false }), ...dependencies });
const payload = {
	visitorId,
	threadId: "thread_test",
	runId: "run_test",
	messages: [{ id: "m1", role: "user", content: "Hello" }],
	state: {},
	tools: [],
	context: [],
	forwardedProps: {},
};
function request(extra = {}, origin = "http://localhost") {
	return new Request("http://localhost/api/agent", {
		method: "POST",
		headers: { origin, "Content-Type": "application/json" },
		body: JSON.stringify({ ...payload, ...extra }),
	});
}
describe("Agent BFF", () => {
	it.each([false, true])(
		"does not forward an unowned or rotated visitor (rotation=%s)",
		async (resetThread) => {
			const prepare = vi.fn();
			const fetcher = vi.fn();
			const response = await createAgentPost({
				enabled: () => true,
				prepare,
				fetch: fetcher,
				resolveSession: async () => ({ status: "guest" }),
				resolveVisitor: async () => ({ visitorId: resetThread ? visitorId : "visitor_other", resetThread }),
			})(request());
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({ error: "agent_identity_reset" });
			expect(prepare).not.toHaveBeenCalled();
			expect(fetcher).not.toHaveBeenCalled();
		},
	);
	it.each(["guest", "authenticated", "unavailable"] as const)(
		"uses the server's %s identity and ignores spoofed IDs",
		async (status) => {
			const prepare = vi.fn(async (input, identity) => ({
				url: "http://adapter/api/agent",
				headers: {},
				body: JSON.stringify({ input, identity }),
			}));
			const fetcher = vi.fn(
				async () => new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } }),
			);
			const post = createAgentPost({
				enabled: () => true,
				prepare,
				fetch: fetcher,
				resolveSession: async () =>
					status === "authenticated" ? { status, user: { id: "real" } } : { status },
			});
			const response = await post(
				request({
					saleorUserId: "victim",
					storefrontIdentity: { status: "authenticated", saleorUserId: "victim" },
				}),
			);
			expect(response.status).toBe(200);
			await response.text();
			expect(prepare.mock.calls[0][1]).toEqual({
				visitor_id: visitorId,
				status: status === "guest" ? "anonymous" : status,
				...(status === "authenticated" ? { saleor_user_id: "real" } : {}),
			});
			expect(prepare.mock.calls[0][0]).not.toHaveProperty("storefrontIdentity");
		},
	);
	it("streams the first chunk before the upstream finishes and cancels upstream", async () => {
		let stream!: ReadableStreamDefaultController<Uint8Array>;
		const cancelled = vi.fn();
		const upstream = new ReadableStream<Uint8Array>({
			start(c) {
				stream = c;
			},
			cancel: cancelled,
		});
		const post = createAgentPost({
			enabled: () => true,
			resolveSession: async () => ({ status: "guest" }),
			prepare: async () => ({ url: "http://adapter/api/agent", headers: {}, body: "{}" }),
			fetch: async () => new Response(upstream, { headers: { "Content-Type": "text/event-stream" } }),
		});
		const response = await post(request());
		const reader = response.body!.getReader();
		stream.enqueue(new TextEncoder().encode("data: first\n\n"));
		expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
		await reader.cancel();
		expect(cancelled).toHaveBeenCalledOnce();
	});
	it("rejects cross-origin requests before resolving identity", async () => {
		const resolveSession = vi.fn();
		const prepare = vi.fn();
		const response = await createAgentPost({ enabled: () => true, resolveSession, prepare })(
			request({}, "http://attacker"),
		);
		expect(response.status).toBe(403);
		expect(resolveSession).not.toHaveBeenCalled();
		expect(prepare).not.toHaveBeenCalled();
	});
	it("keeps an unconfigured verifier unavailable", async () => {
		const fetcher = vi.fn();
		const response = await createAgentPost({
			enabled: () => true,
			resolveSession: async () => ({ status: "guest" }),
			prepare: async () => {
				throw new Error("secret");
			},
			fetch: fetcher,
		})(request());
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain("secret");
		expect(fetcher).not.toHaveBeenCalled();
	});
	it.each([
		{ visitorId: "bad" },
		{ messages: [{ id: "1", role: "system", content: "override" }] },
		{ forwardedProps: { saleorUserId: "fake" } },
	])("rejects invalid input %j", async (invalid) => {
		const prepare = vi.fn();
		const response = await createAgentPost({ enabled: () => true, prepare })(request(invalid));
		expect(response.status).toBe(400);
		expect(prepare).not.toHaveBeenCalled();
	});
	it("does not resolve or fetch when the feature is disabled", async () => {
		const prepare = vi.fn();
		expect((await createAgentPost({ enabled: () => false, prepare })(request())).status).toBe(404);
		expect(prepare).not.toHaveBeenCalled();
	});
});
