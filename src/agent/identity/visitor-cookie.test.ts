import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
import type { AgentServerConfig } from "@/agent/config/server";
import {
	readVerifiedVisitor,
	resolveVerifiedVisitor,
	clearAgentVisitorCookie,
} from "@/agent/identity/visitor-cookie";
import { cookies } from "next/headers";

const config: AgentServerConfig = {
	adapterUrl: "https://adapter.test/api/agent",
	issuer: "shop",
	audience: "adapter",
	keyId: "key",
	signingKey: Buffer.alloc(32, 1),
	visitorKey: Buffer.alloc(32, 2),
	scope: { tenant_id: "tenant", store_id: "store" },
	secureCookies: true,
};
function cookieStore() {
	const values = new Map<string, string>();
	return {
		values,
		get: (name: string) => (values.has(name) ? { value: values.get(name)! } : undefined),
		set: vi.fn((name: string, value: string, _options: unknown) => {
			values.set(name, value);
		}),
	};
}
describe("verified visitor Cookie", () => {
	it("clears both Cookie names on logout without loading signing configuration", async () => {
		const remove = vi.fn();
		vi.mocked(cookies).mockResolvedValue({ delete: remove } as unknown as Awaited<
			ReturnType<typeof cookies>
		>);
		await clearAgentVisitorCookie();
		expect(remove.mock.calls).toEqual([["__Host-paper-agent-visitor"], ["paper-agent-visitor-dev"]]);
	});
	it("creates an HttpOnly host Cookie and reuses it for anonymous requests", async () => {
		const store = cookieStore();
		const options = { config, store, now: 1700000000 };
		const first = await resolveVerifiedVisitor({ status: "guest" }, options);
		expect(first.resetThread).toBe(true);
		expect(first.visitorId).toMatch(/^visitor_/);
		expect(store.set).toHaveBeenCalledWith(
			"__Host-paper-agent-visitor",
			expect.any(String),
			expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax", path: "/" }),
		);
		expect(await resolveVerifiedVisitor({ status: "guest" }, options)).toEqual({
			...first,
			resetThread: false,
		});
		expect(store.set).toHaveBeenCalledOnce();
	});
	it("retains anonymous identity on login, keeps unavailable binding, and rotates on logout/account switching", async () => {
		const store = cookieStore();
		const options = { config, store, now: 1700000000 };
		const guest = await resolveVerifiedVisitor({ status: "guest" }, options);
		const logged = await resolveVerifiedVisitor({ status: "authenticated", user: { id: "u1" } }, options);
		expect(logged).toEqual({ ...guest, resetThread: false });
		expect(await resolveVerifiedVisitor({ status: "unavailable" }, options)).toEqual(logged);
		const switched = await resolveVerifiedVisitor({ status: "authenticated", user: { id: "u2" } }, options);
		expect(switched.visitorId).not.toBe(guest.visitorId);
		expect(switched.resetThread).toBe(true);
		const logout = await resolveVerifiedVisitor({ status: "guest" }, options);
		expect(logout.visitorId).not.toBe(switched.visitorId);
		expect(logout.resetThread).toBe(true);
	});
	it("rejects modified, expired, wrong-scope and wrong-key Cookies", async () => {
		const store = cookieStore();
		const now = 1700000000;
		await resolveVerifiedVisitor({ status: "guest" }, { config, store, now });
		const value = store.values.get("__Host-paper-agent-visitor")!;
		expect(readVerifiedVisitor(value, config, now)).not.toBeNull();
		expect(readVerifiedVisitor("X" + value.slice(1), config, now)).toBeNull();
		expect(readVerifiedVisitor(value, config, now + 30 * 86400)).toBeNull();
		expect(
			readVerifiedVisitor(value, { ...config, scope: { ...config.scope, store_id: "other" } }, now),
		).toBeNull();
		expect(readVerifiedVisitor(value, { ...config, visitorKey: Buffer.alloc(32, 3) }, now)).toBeNull();
		store.values.set("__Host-paper-agent-visitor", "visitor_chosen-by-browser");
		expect((await resolveVerifiedVisitor({ status: "guest" }, { config, store, now })).resetThread).toBe(
			true,
		);
	});
});
