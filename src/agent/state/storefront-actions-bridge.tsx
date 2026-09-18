"use client";
import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useCart } from "@/ui/components/cart/cart-context";
import { useAgent } from "@/agent/hooks/useAgent";
import { useAgentState } from "@/agent/hooks/useAgentState";
import {
	addCartLine,
	mutateAgentCart,
	resolveAgentProductRoute,
	describeAgentCartAction,
} from "@/app/actions";
import { buildStorefrontPath } from "@/lib/storefront-path";
import { waitForFrontendState } from "@/agent/state/wait-for-state";

export function StorefrontActionsBridge() {
	const { actions } = useAgent();
	const { state, setCartState, getCurrentState } = useAgentState();
	const { locale, channel } = state.store;
	const router = useRouter();
	const pathname = usePathname();
	const { openCart, closeCart } = useCart();
	const history = useRef<string[]>([]);
	useEffect(() => {
		history.current = [];
	}, [locale, channel]);
	useEffect(() => {
		if (history.current.at(-1) !== pathname) history.current.push(pathname);
	}, [pathname, locale, channel]);
	useEffect(() => {
		const cleanups = [
			actions.register("openCart", openCart),
			actions.register("goBack", () => {
				if (history.current.length < 2) return false;
				history.current.pop();
				const target = history.current.at(-1);
				if (!target) return false;
				router.push(target);
				return true;
			}),
		];
		if (locale && channel) {
			cleanups.push(
				actions.register("describeCartAction", async (name, args) => {
					const summary = await describeAgentCartAction(channel, locale, name, args);
					if (summary) closeCart();
					return summary;
				}),
			);
			cleanups.push(
				actions.register("openProduct", async (args, signal) => {
					const href = args.productId
						? await resolveAgentProductRoute(args.productId, channel, locale)
						: args.slug
							? buildStorefrontPath(locale, channel, `/products/${encodeURIComponent(args.slug)}`)
							: null;
					if (signal?.aborted) return { success: false, error: "cancelled" };
					if (!href) return { success: false, error: "target_not_found" };
					router.push(href);
					const applied = await waitForFrontendState(
						getCurrentState,
						(next) =>
							next.route.pageType === "product" &&
							(args.productId ? next.product?.id === args.productId : next.product?.slug === args.slug),
						signal,
					);
					return applied
						? { success: true, data: { applied: true, productId: getCurrentState().product?.id } }
						: { success: false, error: signal?.aborted ? "cancelled" : "timeout" };
				}),
			);
			cleanups.push(
				actions.register("addToCart", async (args, signal) => {
					if (signal?.aborted) return { success: false, error: "cancelled" };
					const result = await addCartLine({ ...args, channel, localeSlug: locale });
					if (result.success && result.data?.itemCount !== undefined)
						setCartState({ itemCount: result.data.itemCount });
					return result;
				}),
			);
			cleanups.push(
				actions.register("updateCartQuantity", async ({ lineId, quantity }, signal) => {
					if (signal?.aborted) return { success: false, error: "cancelled" };
					const result = await mutateAgentCart(channel, lineId, quantity);
					if (result.success && result.data?.itemCount !== undefined)
						setCartState({ itemCount: result.data.itemCount });
					return result;
				}),
			);
			cleanups.push(
				actions.register("removeFromCart", async ({ lineId }, signal) => {
					if (signal?.aborted) return { success: false, error: "cancelled" };
					const result = await mutateAgentCart(channel, lineId, null);
					if (result.success && result.data?.itemCount !== undefined)
						setCartState({ itemCount: result.data.itemCount });
					return result;
				}),
			);
		}
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}, [actions, locale, channel, router, openCart, closeCart, getCurrentState, setCartState]);
	return null;
}
