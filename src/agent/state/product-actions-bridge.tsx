"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOptionalAgent } from "@/agent/components/AIProvider";
import { useOptionalAgentState } from "@/agent/hooks/useAgentState";
import { buildStorefrontPath } from "@/lib/storefront-path";
import { resolveAgentVariant } from "@/app/actions";
import { waitForFrontendState } from "@/agent/state/wait-for-state";

export function AgentProductActionsBridge({
	productId,
	slug,
	channel,
	locale,
	variants,
}: {
	productId: string;
	slug: string;
	channel: string;
	locale: string;
	variants: Array<{ id: string; sku?: string | null; attributes: Record<string, string> }>;
}) {
	const actions = useOptionalAgent()?.actions;
	const targets = useOptionalAgent()?.targets;
	const getState = useOptionalAgentState()?.getCurrentState;
	const marker = useRef<HTMLSpanElement>(null);
	const router = useRouter();
	useEffect(() => {
		if (!actions || !getState) return;
		const unregister = actions.register("selectVariant", async (args, signal) => {
			if (args.productId && args.productId !== productId) return { success: false, error: "denied" };
			let variant: { id: string } | null | undefined;
			if (args.attributes) {
				const matches = variants.filter((v) =>
					Object.entries(args.attributes!).every(([key, value]) => v.attributes[key] === value),
				);
				if (matches.length === 1) variant = matches[0];
			} else
				variant = await resolveAgentVariant(productId, channel, locale, {
					variantId: args.variantId,
					sku: args.sku,
				});
			if (signal?.aborted) return { success: false, error: "cancelled" };
			if (!variant) return { success: false, error: "invalid_arguments" };
			const id = variant.id;
			const params = new URLSearchParams({ variant: id });
			router.push(
				`${buildStorefrontPath(locale, channel, `/products/${encodeURIComponent(slug)}`)}?${params}`,
				{ scroll: false },
			);
			const applied = await waitForFrontendState(
				getState,
				(next) => next.product?.id === productId && next.product.selectedVariantId === id,
				signal,
			);
			return applied
				? { success: true, data: { applied: true, productId, variantId: id } }
				: { success: false, error: signal?.aborted ? "cancelled" : "timeout" };
		});
		const parent = marker.current?.parentElement;
		const untarget = parent ? targets?.register("variants", parent) : undefined;
		return () => {
			unregister();
			untarget?.();
		};
	}, [actions, targets, getState, productId, slug, channel, locale, variants, router]);
	return <span hidden ref={marker} />;
}
