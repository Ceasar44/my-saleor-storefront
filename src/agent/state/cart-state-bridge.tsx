"use client";
import { useEffect, useRef } from "react";
import { useOptionalAgent } from "@/agent/components/AIProvider";
import { useOptionalAgentState } from "@/agent/hooks/useAgentState";
import { buildCheckoutPath } from "@paper/session-bridge";

export function AgentCartStateBridge({
	itemCount,
	checkoutId,
	locale,
}: {
	itemCount: number | undefined;
	checkoutId: string | null;
	locale: string;
}) {
	const agent = useOptionalAgent();
	const setCart = useOptionalAgentState()?.setCartState;
	const actions = agent?.actions;
	const navigation = useRef<(() => void) | null>(null);
	useEffect(() => {
		setCart?.({ itemCount });
	}, [setCart, itemCount]);
	useEffect(() => {
		if (!actions) return;
		const remove = actions.register("openCheckout", async (signal) => {
			if (signal?.aborted) return { success: false, error: "cancelled" };
			if (!checkoutId || itemCount === undefined || itemCount < 1)
				return { success: false, error: "target_not_found" };
			const href = buildCheckoutPath({ checkoutId, step: "contact", browseLocale: locale });
			navigation.current = () => window.location.assign(href);
			return { success: true, data: { applied: true } };
		});
		const finish = actions.register("finishNavigation", () => {
			const navigate = navigation.current;
			navigation.current = null;
			navigate?.();
		});
		return () => {
			remove();
			finish();
			navigation.current = null;
		};
	}, [actions, checkoutId, itemCount, locale]);
	return null;
}
