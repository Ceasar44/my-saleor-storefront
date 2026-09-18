import type { FrontendState } from "@/agent/state/types";

export type FrontendToolRisk = "read" | "auto" | "confirm" | "forbidden";

/** Structural subset of Next's router; no dependency on private Next.js imports. */
export type FrontendToolContext = {
	state: FrontendState;
	router: { push(href: string): void };
	signal?: AbortSignal;
};

/** Small action receipt only; never a full DOM, cart, session or GraphQL object. */
export type FrontendToolReceipt = {
	applied?: boolean;
	productId?: string;
	variantId?: string;
	itemCount?: number;
};

export type FrontendToolError =
	| "unknown_tool"
	| "denied"
	| "confirmation_required"
	| "invalid_arguments"
	| "execution_failed"
	| "invalid_result"
	| "timeout"
	| "cancelled"
	| "target_not_found";

export type FrontendToolResult =
	| { success: true; data?: FrontendToolReceipt }
	| { success: false; error: FrontendToolError };

export interface FrontendTool<TArgs = unknown> {
	readonly name: string;
	readonly description: string;
	readonly risk: FrontendToolRisk;
	/** Throw on invalid arguments; return an independent, allowlisted value. */
	parseArguments(args: unknown): TArgs;
	/** Check signal before side effects and after awaits; timeout cannot undo an action. */
	execute(args: TArgs, context: FrontendToolContext): Promise<FrontendToolResult>;
}
