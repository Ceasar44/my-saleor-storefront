export const FRONTEND_TARGETS = ["product", "variants", "cart", "checkout"] as const;
export type FrontendTarget = (typeof FRONTEND_TARGETS)[number];

export type FrontendTargetBinding = Readonly<{
	element: HTMLElement;
	signal: AbortSignal;
}>;

export function isFrontendTarget(value: unknown): value is FrontendTarget {
	return typeof value === "string" && FRONTEND_TARGETS.some((target) => target === value);
}

/** Fixed visibility checks only. Agent arguments never reach a DOM selector. */
export function isTargetAvailable(binding: FrontendTargetBinding): boolean {
	try {
		const { element, signal } = binding;
		if (signal.aborted || !element.isConnected || !element.getClientRects().length) return false;
		if (element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
		const view = element.ownerDocument.defaultView;
		if (!view) return false;
		const style = view.getComputedStyle(element);
		return style.visibility !== "hidden" && style.visibility !== "collapse" && style.display !== "none";
	} catch {
		// A document/bridge can disappear while an operation is pending.
		return false;
	}
}

/** One instance per mounted Agent runtime; bridges own their registration cleanup. */
export class FrontendTargetRegistry {
	private readonly bindings = new Map<
		FrontendTarget,
		{ binding: FrontendTargetBinding; controller: AbortController }
	>();

	register(target: FrontendTarget, element: HTMLElement): () => void {
		if (!isFrontendTarget(target)) throw new Error("Unknown frontend target.");
		this.bindings.get(target)?.controller.abort();
		const controller = new AbortController();
		const entry = { binding: Object.freeze({ element, signal: controller.signal }), controller };
		this.bindings.set(target, entry);
		return () => {
			controller.abort();
			// Cleanup from a departing bridge must not remove its replacement.
			if (this.bindings.get(target) === entry) this.bindings.delete(target);
		};
	}

	resolve(target: FrontendTarget): FrontendTargetBinding | null {
		const binding = this.bindings.get(target)?.binding;
		return binding && isTargetAvailable(binding) ? binding : null;
	}

	clear(): void {
		for (const { controller } of this.bindings.values()) controller.abort();
		this.bindings.clear();
	}
}
