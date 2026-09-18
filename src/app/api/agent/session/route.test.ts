import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/agent/identity/session-user", () => ({ resolveAgentSessionUser: vi.fn() }));
import { createAgentSessionPost } from "@/agent/agui/session-server";

const request = (origin = "https://shop.test") =>
	new Request("https://shop.test/api/agent/session", { method: "POST", headers: { origin } });
describe("Agent session initialization", () => {
	it.each(["guest", "authenticated", "unavailable"] as const)(
		"projects only public session data for %s",
		async (status) => {
			const resolveVisitor = vi.fn(async () => ({ visitorId: "visitor_server", resetThread: true }));
			const response = await createAgentSessionPost({
				enabled: () => true,
				resolveVisitor,
				resolveSession: async () =>
					status === "authenticated" ? { status, user: { id: "private-user" } } : { status },
			})(request());
			expect(await response.json()).toEqual({
				visitorId: "visitor_server",
				resetThread: true,
				authStatus: status,
			});
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(resolveVisitor).toHaveBeenCalledOnce();
		},
	);
	it("rejects cross-site initialization and hides dependency errors", async () => {
		const resolveSession = vi.fn(async () => {
			throw new Error("secret");
		});
		const post = createAgentSessionPost({ enabled: () => true, resolveSession });
		expect((await post(request("https://other.test"))).status).toBe(403);
		expect(resolveSession).not.toHaveBeenCalled();
		const failure = await post(request());
		expect(failure.status).toBe(503);
		expect(await failure.text()).not.toContain("secret");
		expect((await createAgentSessionPost({ enabled: () => false })(request())).status).toBe(404);
	});
});
