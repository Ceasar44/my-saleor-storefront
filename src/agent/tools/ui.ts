import {
	isFrontendTarget,
	isTargetAvailable,
	type FrontendTarget,
	type FrontendTargetBinding,
	type FrontendTargetRegistry,
} from "@/agent/tools/targets";
import type { FrontendTool, FrontendToolContext, FrontendToolResult } from "@/agent/tools/types";

export type FrontendTargetArgs = { target: FrontendTarget };

function parseTargetArgs(args: unknown): FrontendTargetArgs {
	if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid target arguments.");
	const value = args as Record<string, unknown>;
	if (Object.keys(value).length !== 1 || !isFrontendTarget(value.target))
		throw new Error("Invalid frontend target.");
	return { target: value.target };
}

function resolveTarget(
	targets: FrontendTargetRegistry,
	target: FrontendTarget,
	context: FrontendToolContext,
): FrontendTargetBinding | null {
	const page = context.state.route.pageType;
	if ((target === "product" || target === "variants") && page !== "product") return null;
	if (target === "checkout" && page !== "checkout") return null;
	if (target === "cart" && page !== "cart" && !context.state.cart?.isOpen) return null;
	return targets.resolve(target);
}

export function createScrollToTool(targets: FrontendTargetRegistry): FrontendTool<FrontendTargetArgs> {
	return {
		name: "scroll_to",
		description: "Scroll to a registered visible storefront region.",
		risk: "auto",
		parseArguments: parseTargetArgs,
		async execute({ target }, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			const binding = resolveTarget(targets, target, context);
			if (!binding) return { success: false, error: "target_not_found" };
			// Instant scrolling avoids adding animation, including for reduced-motion users.
			binding.element.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
			return { success: true, data: { applied: true } };
		},
	};
}

// Shared by tool instances but keyed only by actual browser elements. No DOM access
// occurs at import/SSR time; leases are released on completion, abort or bridge cleanup.
const highlights = new WeakMap<HTMLElement, { count: number; added: string[] }>();
const HIGHLIGHT_CLASSES = ["ring-2", "ring-ring", "ring-offset-2", "ring-offset-background"];

function acquireHighlight(element: HTMLElement): () => void {
	let lease = highlights.get(element);
	if (!lease) {
		lease = { count: 0, added: HIGHLIGHT_CLASSES.filter((name) => !element.classList.contains(name)) };
		element.classList.add(...lease.added);
		highlights.set(element, lease);
	}
	lease.count += 1;
	const activeLease = lease;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		activeLease.count -= 1;
		if (activeLease.count === 0) {
			element.classList.remove(...activeLease.added);
			highlights.delete(element);
		}
	};
}

/** Duration is a local UI choice, not a model-controlled tool argument. */
export function createHighlightElementTool(
	targets: FrontendTargetRegistry,
	durationMs = 1500,
): FrontendTool<FrontendTargetArgs> {
	if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 5000)
		throw new Error("Invalid highlight duration.");
	return {
		name: "highlight_element",
		description: "Briefly highlight a registered visible storefront region.",
		risk: "auto",
		parseArguments: parseTargetArgs,
		async execute({ target }, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			const binding = resolveTarget(targets, target, context);
			if (!binding) return { success: false, error: "target_not_found" };
			const release = acquireHighlight(binding.element);
			return new Promise<FrontendToolResult>((resolve) => {
				let done = false;
				let timer: ReturnType<typeof setTimeout> | undefined;
				const finish = (result: FrontendToolResult) => {
					if (done) return;
					done = true;
					clearTimeout(timer);
					context.signal?.removeEventListener("abort", cancel);
					binding.signal.removeEventListener("abort", removed);
					release();
					resolve(result);
				};
				const cancel = () => finish({ success: false, error: "cancelled" });
				const removed = () => finish({ success: false, error: "target_not_found" });
				context.signal?.addEventListener("abort", cancel, { once: true });
				binding.signal.addEventListener("abort", removed, { once: true });
				if (context.signal?.aborted) {
					cancel();
					return;
				}
				if (!isTargetAvailable(binding)) {
					removed();
					return;
				}
				timer = setTimeout(
					() =>
						finish(
							isTargetAvailable(binding)
								? { success: true, data: { applied: true } }
								: { success: false, error: "target_not_found" },
						),
					durationMs,
				);
			});
		},
	};
}
import type { AgentActionBindings } from "@/agent/tools/bindings";
import { objectArgs } from "@/agent/tools/arguments";

export function createShowNotificationTool(actions: AgentActionBindings): FrontendTool<{ message: string }> {
	return {
		name: "show_notification",
		description: "Show a plain text notification.",
		risk: "auto",
		parseArguments(args) {
			const v = objectArgs(args, ["message"]);
			if (typeof v.message !== "string" || !v.message.trim() || v.message.length > 500)
				throw new Error("Invalid notification");
			return { message: v.message };
		},
		async execute({ message }, context) {
			if (context.signal?.aborted) return { success: false, error: "cancelled" };
			const notify = actions.get("notify");
			if (!notify) return { success: false, error: "target_not_found" };
			notify(message);
			return { success: true, data: { applied: true } };
		},
	};
}
