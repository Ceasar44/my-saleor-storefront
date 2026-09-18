import { describe, expect, it, vi } from "vitest";
import { AgentActionBindings } from "@/agent/tools/bindings";
import { FrontendToolRegistry } from "@/agent/tools/registry";
import { FrontendToolExecutor } from "@/agent/tools/executor";
import {
	createAddToCartTool,
	createUpdateCartQuantityTool,
	createRemoveFromCartTool,
} from "@/agent/tools/cart";
import { createOpenCheckoutTool } from "@/agent/tools/checkout";
import { createSelectVariantTool } from "@/agent/tools/product";
import { collectFrontendState } from "@/agent/state/collector";
const context = () => ({
	state: collectFrontendState(
		{ pathname: "/en/us/products/shirt", product: { id: "p1", slug: "shirt" }, chatOpen: true },
		1,
	),
	router: { push: vi.fn() },
});
describe("commerce tools", () => {
	it("times out pending approval and ignores approval that arrives later", async () => {
		const actions = new AgentActionBindings();
		const remove = vi.fn();
		actions.register("removeFromCart", remove);
		const registry = new FrontendToolRegistry();
		registry.register(createRemoveFromCartTool(actions));
		let approve!: (approved: boolean) => void;
		const executor = new FrontendToolExecutor(registry, 10);
		const result = await executor.execute("remove_from_cart", { line_id: "l1" }, context(), {
			requestConfirmation: () =>
				new Promise((resolve) => {
					approve = resolve;
				}),
		});
		expect(result).toEqual({ success: false, error: "timeout" });
		approve(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(remove).not.toHaveBeenCalled();
	});
	it("does not mutate a cart without a real confirmation callback", async () => {
		const actions = new AgentActionBindings();
		const add = vi.fn(async () => ({ success: true as const }));
		actions.register("addToCart", add);
		const registry = new FrontendToolRegistry();
		registry.register(createAddToCartTool(actions));
		const executor = new FrontendToolExecutor(registry);
		expect(await executor.execute("add_to_cart", { variant_id: "v1", quantity: 3 }, context())).toEqual({
			success: false,
			error: "confirmation_required",
		});
		expect(add).not.toHaveBeenCalled();
		expect(
			await executor.execute("add_to_cart", { variant_id: "v1", quantity: 3 }, context(), {
				requestConfirmation: async () => true,
			}),
		).toEqual({ success: true });
		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({ variantId: "v1", quantity: 3 }),
			expect.any(AbortSignal),
		);
	});
	it("denial and cancellation prevent mutations", async () => {
		const actions = new AgentActionBindings();
		const remove = vi.fn();
		actions.register("removeFromCart", remove);
		const registry = new FrontendToolRegistry();
		registry.register(createRemoveFromCartTool(actions));
		const executor = new FrontendToolExecutor(registry);
		expect(
			await executor.execute("remove_from_cart", { line_id: "l1" }, context(), {
				requestConfirmation: async () => false,
			}),
		).toEqual({ success: false, error: "denied" });
		expect(remove).not.toHaveBeenCalled();
	});
	it("validates quantity and binds variants to the current product", async () => {
		const actions = new AgentActionBindings();
		const registry = new FrontendToolRegistry();
		registry.register(createSelectVariantTool(actions));
		registry.register(createUpdateCartQuantityTool(actions));
		const executor = new FrontendToolExecutor(registry);
		expect(
			await executor.execute("select_variant", { product_id: "other", variant_id: "v" }, context()),
		).toEqual({ success: false, error: "denied" });
		expect(
			await executor.execute("change_quantity", { line_id: "l", quantity: -1 }, context(), {
				requestConfirmation: async () => true,
			}),
		).toEqual({ success: false, error: "invalid_arguments" });
	});
	it("preserves business failures and cannot pay through checkout", async () => {
		const actions = new AgentActionBindings();
		actions.register("openCheckout", async () => ({ success: false, error: "target_not_found" }));
		const registry = new FrontendToolRegistry();
		registry.register(createOpenCheckoutTool(actions));
		const executor = new FrontendToolExecutor(registry);
		expect(await executor.execute("open_checkout", {}, context())).toEqual({
			success: false,
			error: "target_not_found",
		});
		expect(await executor.execute("submit_payment", {}, context())).toEqual({
			success: false,
			error: "unknown_tool",
		});
	});
	it("stale page cleanup leaves replacement bindings intact", () => {
		const actions = new AgentActionBindings();
		const old = actions.register("openCart", () => {});
		const next = vi.fn();
		actions.register("openCart", next);
		old();
		actions.get("openCart")?.();
		expect(next).toHaveBeenCalledOnce();
	});
});
