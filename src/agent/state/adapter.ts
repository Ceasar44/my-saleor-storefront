import { normalizeFrontendState } from "@/agent/state/collector";
import { equalStateValue, STATE_SECTIONS } from "@/agent/state/synchronizer";
import type { AgentCheckoutState, AgentRouteState, FrontendState } from "@/agent/state/types";

/** Project state extension from adapter frontend/state/models.py, not the AG-UI protocol. */
export type AdapterFrontendState = {
	version: number;
	route: { pathname: string; page_type: Exclude<AgentRouteState["pageType"], "collection" | "account"> };
	store: { locale: string | null; channel: string | null; currency: string | null };
	product: { id: string | null; variant_id: string | null; color: string | null; size: string | null };
	cart: { is_open: boolean; item_count: number };
	checkout: { step: NonNullable<AgentCheckoutState["step"]> | null };
	user: { is_logged_in: boolean | null };
	ui: { cart_open: boolean; chat_open: boolean };
};

export type AdapterFrontendStateDelta = {
	base_version: number;
	version: number;
	changes: Partial<Omit<AdapterFrontendState, "version">>;
};

/** Explicit projection: no slugs, names, SKU, checkout IDs, user IDs, or updated_at. */
export function toAdapterFrontendState(state: FrontendState): AdapterFrontendState {
	const clean = normalizeFrontendState(state);
	const pageType = clean.route.pageType;
	const attributes = clean.product?.selectedAttributes;
	const cartOpen = clean.cart?.isOpen ?? false;
	return {
		version: clean.version,
		route: {
			pathname: clean.route.pathname,
			page_type: pageType === "account" || pageType === "collection" ? "other" : pageType,
		},
		store: { locale: clean.store.locale, channel: clean.store.channel, currency: clean.store.currency },
		product: {
			id: clean.product?.id ?? null,
			variant_id: clean.product?.selectedVariantId ?? null,
			color: attributes?.color ?? null,
			size: attributes?.size ?? null,
		},
		// The current adapter has no "unknown count" value; zero is its default and
		// is excluded from its model context. Never use this hint as commerce truth.
		cart: { is_open: cartOpen, item_count: clean.cart?.itemCount ?? 0 },
		checkout: { step: clean.checkout?.step ?? null },
		user: {
			is_logged_in:
				clean.user.status === "authenticated" ? true : clean.user.status === "guest" ? false : null,
		},
		ui: { cart_open: cartOpen, chat_open: clean.ui.chatOpen },
	};
}

/** Adapter sections merge leaves, so every changed section includes explicit clearing values. */
export function toAdapterFrontendStateDelta(
	previous: FrontendState,
	current: FrontendState,
): AdapterFrontendStateDelta {
	const before = toAdapterFrontendState(previous);
	const next = toAdapterFrontendState(current);
	if (next.version !== before.version + 1) throw new Error("State deltas must advance by one revision.");
	const changes: AdapterFrontendStateDelta["changes"] = {};
	for (const key of STATE_SECTIONS) {
		if (!equalStateValue(before[key], next[key])) Object.assign(changes, { [key]: next[key] });
	}
	return { base_version: before.version, version: next.version, changes };
}
