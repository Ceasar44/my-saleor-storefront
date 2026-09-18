"use client";
import { useEffect } from "react";
import { useOptionalAgentState } from "@/agent/hooks/useAgentState";
import type { AgentProductState } from "@/agent/state/types";
import { AgentTargetBridge } from "@/agent/state/target-bridge";

export function AgentProductStateBridge({
	product,
	currency,
}: {
	product: Pick<AgentProductState, "id" | "slug" | "name">;
	currency?: string;
}) {
	const state = useOptionalAgentState();
	const set = state?.setProductState;
	const clear = state?.clearProductState;
	const setCurrency = state?.setCurrency;
	useEffect(() => {
		if (currency) setCurrency?.(currency);
	}, [setCurrency, currency]);
	const { id, slug, name } = product;
	useEffect(() => {
		set?.({ id, slug, name });
		return () => clear?.(id);
	}, [set, clear, id, slug, name]);
	return <AgentTargetBridge target="product" />;
}

export function AgentVariantStateBridge({
	productId,
	variantId,
	sku,
	attributes,
}: {
	productId: string;
	variantId?: string | null;
	sku?: string | null;
	attributes?: Record<string, string>;
}) {
	const set = useOptionalAgentState()?.setVariantState;
	const serialized = JSON.stringify(attributes ?? {});
	useEffect(() => {
		set?.(productId, {
			selectedVariantId: variantId ?? null,
			selectedSku: sku ?? null,
			selectedAttributes: JSON.parse(serialized) as Record<string, string>,
		});
		return () => set?.(productId, { selectedVariantId: null, selectedSku: null, selectedAttributes: {} });
	}, [set, productId, variantId, sku, serialized]);
	return null;
}
