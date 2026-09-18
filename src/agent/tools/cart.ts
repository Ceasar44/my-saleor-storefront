import type { FrontendTool } from "@/agent/tools/types";
import type { AgentActionBindings } from "@/agent/tools/bindings";
import { emptyArgs, idArg, objectArgs, quantityArg } from "@/agent/tools/arguments";

export function createOpenCartTool(actions: AgentActionBindings): FrontendTool {
	return {
		name: "open_cart",
		description: "Open the shopping bag.",
		risk: "auto",
		parseArguments: emptyArgs,
		async execute(_args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			const open = actions.get("openCart");
			if (!open) return { success: false, error: "target_not_found" };
			open();
			return { success: true, data: { applied: true } };
		},
	};
}
export function createAddToCartTool(
	actions: AgentActionBindings,
): FrontendTool<{ productId?: string; variantId: string; quantity: number }> {
	return {
		name: "add_to_cart",
		description: "Add a variant to the bag after your confirmation.",
		risk: "confirm",
		parseArguments(args) {
			const v = objectArgs(args, ["product_id", "variant_id", "variantId", "quantity"]);
			return {
				productId: v.product_id === undefined ? undefined : idArg(v.product_id),
				variantId: idArg(v.variant_id ?? v.variantId),
				quantity: quantityArg(v.quantity ?? 1),
			};
		},
		async execute(args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			return (
				actions.get("addToCart")?.(args, context.signal) ?? { success: false, error: "target_not_found" }
			);
		},
	};
}
export function createUpdateCartQuantityTool(
	actions: AgentActionBindings,
): FrontendTool<{ lineId: string; quantity: number }> {
	return {
		name: "change_quantity",
		description: "Change a bag quantity after your confirmation.",
		risk: "confirm",
		parseArguments(args) {
			const v = objectArgs(args, ["line_id", "quantity"]);
			return { lineId: idArg(v.line_id), quantity: quantityArg(v.quantity) };
		},
		async execute(args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			return (
				actions.get("updateCartQuantity")?.(args, context.signal) ?? {
					success: false,
					error: "target_not_found",
				}
			);
		},
	};
}
export function createRemoveFromCartTool(actions: AgentActionBindings): FrontendTool<{ lineId: string }> {
	return {
		name: "remove_from_cart",
		description: "Remove a bag item after your confirmation.",
		risk: "confirm",
		parseArguments(args) {
			const v = objectArgs(args, ["line_id"]);
			return { lineId: idArg(v.line_id) };
		},
		async execute(args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			return (
				actions.get("removeFromCart")?.(args, context.signal) ?? { success: false, error: "target_not_found" }
			);
		},
	};
}
