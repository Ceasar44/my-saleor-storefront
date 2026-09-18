import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/auth/get-header-user", () => ({ getHeaderAuthState: resolve }));

import { resolveAgentSessionUser } from "@/agent/identity/session-user";

describe("agent server identity", () => {
	beforeEach(() => {
		resolve.mockReset();
	});

	it.each(["guest", "unavailable"])("preserves %s without inventing a user", async (status) => {
		resolve.mockResolvedValue({ status });
		expect(await resolveAgentSessionUser()).toEqual({ status });
	});

	it("projects only the server-resolved user ID", async () => {
		resolve.mockResolvedValue({
			status: "authenticated",
			user: { id: "User:123", email: "private@example.com", firstName: "Private", metadata: [] },
		});
		expect(await resolveAgentSessionUser()).toEqual({ status: "authenticated", user: { id: "User:123" } });
	});

	it("does not turn unexpected resolver failures into guest identity", async () => {
		resolve.mockRejectedValue(new Error("Session failure"));
		await expect(resolveAgentSessionUser()).rejects.toThrow("Session failure");
	});
});
