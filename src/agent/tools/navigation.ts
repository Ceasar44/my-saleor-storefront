import { buildStorefrontPath, parseStorefrontPathname } from "@/lib/storefront-path";
import type { FrontendTool } from "@/agent/tools/types";
import type { AgentActionBindings } from "@/agent/tools/bindings";
import { emptyArgs } from "@/agent/tools/arguments";

export function createGoBackTool(actions: AgentActionBindings): FrontendTool {
	return {
		name: "go_back",
		description: "Return to the previous page visited in this storefront.",
		risk: "auto",
		parseArguments: emptyArgs,
		async execute(_args, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			return actions.get("goBack")?.()
				? { success: true, data: { applied: true } }
				: { success: false, error: "target_not_found" };
		},
	};
}

export type NavigateArgs = { pathname: string };

function parseNavigateArgs(args: unknown): NavigateArgs {
	if (!args || typeof args !== "object" || Array.isArray(args))
		throw new Error("Invalid navigation arguments.");
	const value = args as Record<string, unknown>;
	const path = value.pathname;
	if (
		Object.keys(value).length !== 1 ||
		typeof path !== "string" ||
		!path.startsWith("/") ||
		path.length > 1024 ||
		/[%?#\\\s\u0000-\u001f\u007f]/.test(path) ||
		path.includes("//") ||
		path.split("/").some((part) => part === "." || part === "..")
	) {
		throw new Error("Invalid navigation pathname.");
	}
	return { pathname: path };
}

/** Only browse routes; checkout/auth boundaries have dedicated handoff tools. */
const BROWSE_SUFFIX =
	/^(?:\/products|\/(?:products|categories|collections|pages)\/[^/]+|\/search|\/cart|\/account(?:\/(?:settings|addresses|orders(?:\/[^/]+)?))?)?$/;

export function createNavigateTool(): FrontendTool<NavigateArgs> {
	return {
		name: "navigate",
		description: "Open a page in the current storefront language and channel.",
		risk: "auto",
		parseArguments: parseNavigateArgs,
		async execute({ pathname }, context) {
			const target = parseStorefrontPathname(pathname.replace(/\/$/, ""));
			const current = parseStorefrontPathname(context.state.route.pathname);
			const { locale, channel } = context.state.store;
			if (
				!target ||
				!current ||
				!locale ||
				!channel ||
				current.locale !== locale ||
				current.channel !== channel ||
				target.locale !== locale ||
				target.channel !== channel ||
				!BROWSE_SUFFIX.test(target.suffix)
			) {
				return { success: false, error: "denied" };
			}
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			context.router.push(buildStorefrontPath(locale, channel, target.suffix));
			// Receipt means navigation requested; route/state observation confirms arrival.
			return { success: true, data: { applied: true } };
		},
	};
}
