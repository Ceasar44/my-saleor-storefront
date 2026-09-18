import type { FrontendTool } from "@/agent/tools/types";
import type { AgentActionBindings } from "@/agent/tools/bindings";
import { emptyArgs } from "@/agent/tools/arguments";
export function createOpenCheckoutTool(actions: AgentActionBindings): FrontendTool {
	return {
		name: "open_checkout",
		description: "Open checkout without paying or placing an order.",
		risk: "auto",
		parseArguments: emptyArgs,
		async execute(_args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			return actions.get("openCheckout")?.(context.signal) ?? { success: false, error: "target_not_found" };
		},
	};
}
