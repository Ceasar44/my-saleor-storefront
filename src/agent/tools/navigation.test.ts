import { describe, expect, it, vi } from "vitest";
import { collectFrontendState } from "@/agent/state/collector";
import { FrontendToolExecutor } from "@/agent/tools/executor";
import { createNavigateTool } from "@/agent/tools/navigation";
import { FrontendToolRegistry } from "@/agent/tools/registry";

function setup(pathname = "/pl/pl/products/coat") {
	const registry = new FrontendToolRegistry();
	registry.register(createNavigateTool());
	const push = vi.fn();
	return {
		executor: new FrontendToolExecutor(registry),
		push,
		context: {
			state: collectFrontendState({ pathname, locale: "pl", channel: "pl", chatOpen: false }, 1),
			router: { push },
		},
	};
}

describe("safe storefront navigation tool", () => {
	it.each([
		"/pl/pl",
		"/pl/pl/",
		"/pl/pl/products",
		"/pl/pl/products/płaszcz",
		"/pl/pl/categories/winter",
		"/pl/pl/cart",
		"/pl/pl/account/orders",
	])("requests safe same-market route %s", async (pathname) => {
		const { executor, context, push } = setup();
		expect(await executor.execute("navigate", { pathname }, context)).toEqual({
			success: true,
			data: { applied: true },
		});
		expect(push).toHaveBeenCalledWith(pathname.replace(/\/$/, ""));
	});

	it.each([
		"javascript:alert(1)",
		"data:text/html,x",
		"https://evil.test",
		"//evil.test",
		"/pl/pl/%2e%2e",
		"/pl/pl/../cart",
		"/pl/pl/cart?token=secret",
		"/pl/pl/cart#x",
		"/pl/pl\\evil",
		"/pl/pl//cart",
		"/pl/pl/cart\n",
	])("rejects unsafe pathname %s before navigation", async (pathname) => {
		const { executor, context, push } = setup();
		expect(await executor.execute("navigate", { pathname }, context)).toEqual({
			success: false,
			error: "invalid_arguments",
		});
		expect(push).not.toHaveBeenCalled();
	});

	it.each([
		"/en/us/products/coat",
		"/pl/us/cart",
		"/checkout",
		"/api/auth/logout",
		"/pl/pl/login",
		"/pl/pl/unknown",
		"/pl/pl/products/coat/extra",
	])("denies routes outside the current browse scope: %s", async (pathname) => {
		const { executor, context, push } = setup();
		expect(await executor.execute("navigate", { pathname }, context)).toEqual({
			success: false,
			error: "denied",
		});
		expect(push).not.toHaveBeenCalled();
	});

	it("does not soft-navigate across the checkout/storefront boundary", async () => {
		const { executor, context, push } = setup("/checkout");
		expect(await executor.execute("navigate", { pathname: "/pl/pl/cart" }, context)).toEqual({
			success: false,
			error: "denied",
		});
		expect(push).not.toHaveBeenCalled();
	});

	it("rejects extra arguments rather than honoring caller policy flags", async () => {
		const { executor, context, push } = setup();
		expect(await executor.execute("navigate", { pathname: "/pl/pl/cart", confirmed: true }, context)).toEqual(
			{ success: false, error: "invalid_arguments" },
		);
		expect(push).not.toHaveBeenCalled();
	});
});
