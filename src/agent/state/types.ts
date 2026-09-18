import type { StorefrontAuthStatus } from "@/agent/agui/types";

export type AgentRouteState = {
	pathname: string;
	pageType:
		| "home"
		| "product"
		| "category"
		| "collection"
		| "search"
		| "cart"
		| "checkout"
		| "account"
		| "other";
};

export type AgentStoreState = {
	locale: string | null;
	channel: string | null;
	currency: string | null;
};

export type AgentProductState = {
	id: string;
	slug: string;
	name?: string;
	selectedVariantId?: string | null;
	selectedSku?: string | null;
	selectedAttributes?: Record<string, string>;
};

export type AgentCartState = {
	isOpen: boolean;
	itemCount?: number;
};

export type AgentCheckoutState = {
	step?: "contact" | "shipping" | "delivery" | "payment" | "review" | "complete" | null;
};

/** Display hint only. Authentication is resolved independently by the BFF. */
export type AgentUserState = { status: StorefrontAuthStatus | "unknown" };
export type AgentUIState = { chatOpen: boolean };

export type FrontendState = {
	version: number;
	route: AgentRouteState;
	store: AgentStoreState;
	product?: AgentProductState | null;
	cart?: AgentCartState | null;
	checkout?: AgentCheckoutState | null;
	user: AgentUserState;
	ui: AgentUIState;
};
