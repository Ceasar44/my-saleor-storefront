import type { FrontendToolResult } from "@/agent/tools/types";

export type AgentActions = {
	openProduct(args: { productId?: string; slug?: string }, signal?: AbortSignal): Promise<FrontendToolResult>;
	selectVariant(
		args: { productId?: string; variantId?: string; sku?: string; attributes?: Record<string, string> },
		signal?: AbortSignal,
	): Promise<FrontendToolResult>;
	setProductFilters(args: Record<string, unknown>, signal?: AbortSignal): Promise<FrontendToolResult>;
	openCart(): void;
	addToCart(
		args: { productId?: string; variantId: string; quantity: number },
		signal?: AbortSignal,
	): Promise<FrontendToolResult>;
	updateCartQuantity(
		args: { lineId: string; quantity: number },
		signal?: AbortSignal,
	): Promise<FrontendToolResult>;
	removeFromCart(args: { lineId: string }, signal?: AbortSignal): Promise<FrontendToolResult>;
	openCheckout(signal?: AbortSignal): Promise<FrontendToolResult>;
	goBack(): boolean;
	notify(message: string): void;
	finishNavigation(): void;
	describeCartAction(name: string, args: { variantId?: string; lineId?: string }): Promise<string | null>;
};

/** Page-owned callbacks; stale cleanup cannot unregister a replacement page. */
export class AgentActionBindings {
	private actions: Partial<AgentActions> = {};
	register<K extends keyof AgentActions>(name: K, action: AgentActions[K]) {
		this.actions[name] = action;
		return () => {
			if (this.actions[name] === action) delete this.actions[name];
		};
	}
	get<K extends keyof AgentActions>(name: K): AgentActions[K] | undefined {
		return this.actions[name];
	}
	clear() {
		this.actions = {};
	}
}
