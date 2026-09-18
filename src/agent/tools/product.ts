import type { FrontendTool } from "@/agent/tools/types";
import type { AgentActionBindings } from "@/agent/tools/bindings";
import { objectArgs, idArg } from "@/agent/tools/arguments";

export function createOpenProductTool(
	actions: AgentActionBindings,
): FrontendTool<{ productId?: string; slug?: string }> {
	return {
		name: "open_product",
		description: "Open a product in the current market.",
		risk: "auto",
		parseArguments(args) {
			const value = objectArgs(args, ["product_id", "slug"]);
			if (!!value.product_id === !!value.slug) throw new Error("Choose product ID or slug");
			return value.product_id ? { productId: idArg(value.product_id) } : { slug: idArg(value.slug) };
		},
		async execute(args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			return (
				actions.get("openProduct")?.(args, context.signal) ?? { success: false, error: "target_not_found" }
			);
		},
	};
}

export function createSelectVariantTool(actions: AgentActionBindings): FrontendTool<{
	productId?: string;
	variantId?: string;
	sku?: string;
	attributes?: Record<string, string>;
}> {
	return {
		name: "select_variant",
		description: "Select an existing variant on this product page.",
		risk: "auto",
		parseArguments(args) {
			const value = objectArgs(args, ["product_id", "variant_id", "variantId", "sku", "attributes"]);
			const variantId = value.variant_id ?? value.variantId;
			if ([variantId, value.sku, value.attributes].filter((v) => v !== undefined).length !== 1)
				throw new Error("Choose one variant selector");
			const attributes =
				value.attributes === undefined
					? undefined
					: objectArgs(value.attributes, Object.keys(value.attributes as object));
			if (
				attributes &&
				(!Object.keys(attributes).length ||
					Object.keys(attributes).length > 32 ||
					Object.values(attributes).some((v) => typeof v !== "string" || !v || v.length > 200))
			)
				throw new Error("Invalid attributes");
			return {
				productId: value.product_id === undefined ? undefined : idArg(value.product_id),
				variantId: variantId === undefined ? undefined : idArg(variantId),
				sku: value.sku === undefined ? undefined : idArg(value.sku),
				attributes: attributes as Record<string, string> | undefined,
			};
		},
		async execute(args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			if (!context.state.product || (args.productId && args.productId !== context.state.product.id))
				return { success: false, error: "denied" };
			return (
				actions.get("selectVariant")?.(args, context.signal) ?? { success: false, error: "target_not_found" }
			);
		},
	};
}

export function createSetProductFiltersTool(
	actions: AgentActionBindings,
): FrontendTool<Record<string, unknown>> {
	return {
		name: "set_product_filters",
		description: "Apply filters to the current product listing.",
		risk: "auto",
		parseArguments(args) {
			const value = objectArgs(args, ["categories", "colors", "sizes", "price", "sort"]);
			for (const key of ["categories", "colors", "sizes"]) {
				const entry = value[key];
				if (
					entry !== undefined &&
					(!Array.isArray(entry) ||
						entry.length > 32 ||
						entry.some((v) => typeof v !== "string" || !v || v.length > 200))
				)
					throw new Error("Invalid filters");
			}
			for (const key of ["price", "sort"])
				if (value[key] !== undefined && value[key] !== null) idArg(value[key]);
			return value;
		},
		async execute(args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			return (
				actions.get("setProductFilters")?.(args, context.signal) ?? {
					success: false,
					error: "target_not_found",
				}
			);
		},
	};
}
