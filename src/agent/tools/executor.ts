import { agentConfig } from "@/agent/config/agent";
import { normalizeFrontendState } from "@/agent/state/collector";
import type { FrontendToolRegistry } from "@/agent/tools/registry";
import type {
	FrontendToolContext,
	FrontendToolError,
	FrontendToolReceipt,
	FrontendToolResult,
	FrontendToolRisk,
} from "@/agent/tools/types";

const FORBIDDEN = new Set([
	"submit_payment",
	"place_order",
	"place_order_without_confirmation",
	"complete_checkout",
	"delete_account",
]);
const CONFIRM = new Set(["add_to_cart", "remove_from_cart", "change_quantity", "update_cart_quantity"]);
const ERRORS = new Set<FrontendToolError>([
	"unknown_tool",
	"denied",
	"confirmation_required",
	"invalid_arguments",
	"execution_failed",
	"invalid_result",
	"timeout",
	"cancelled",
	"target_not_found",
]);
const failure = (error: FrontendToolError): FrontendToolResult => ({ success: false, error });

function normalizeResult(value: unknown): FrontendToolResult {
	if (!value || typeof value !== "object") return failure("invalid_result");
	const result = value as Record<string, unknown>;
	if (result.success === false) {
		return failure(
			ERRORS.has(result.error as FrontendToolError)
				? (result.error as FrontendToolError)
				: "execution_failed",
		);
	}
	if (result.success !== true) return failure("invalid_result");
	if (result.data === undefined) return { success: true };
	if (!result.data || typeof result.data !== "object" || Array.isArray(result.data))
		return failure("invalid_result");
	const data = result.data as Record<string, unknown>;
	const receipt: FrontendToolReceipt = {};
	if (data.applied !== undefined) {
		if (typeof data.applied !== "boolean") return failure("invalid_result");
		receipt.applied = data.applied;
	}
	for (const key of ["productId", "variantId"] as const) {
		const id = data[key];
		if (id === undefined) continue;
		if (typeof id !== "string" || !id.trim() || id.length > 255) return failure("invalid_result");
		receipt[key] = id;
	}
	if (data.itemCount !== undefined) {
		if (
			typeof data.itemCount !== "number" ||
			!Number.isSafeInteger(data.itemCount) ||
			data.itemCount < 0 ||
			data.itemCount > 100_000
		)
			return failure("invalid_result");
		receipt.itemCount = data.itemCount;
	}
	return { success: true, data: receipt };
}

export class FrontendToolExecutor {
	constructor(
		private readonly registry: FrontendToolRegistry,
		private readonly timeoutMs = agentConfig.frontendToolTimeoutMs,
	) {
		if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
			throw new Error("Invalid frontend tool timeout.");
	}

	async execute(
		name: string,
		args: unknown,
		context: FrontendToolContext,
		options: {
			risk?: FrontendToolRisk;
			requestConfirmation?: (parsedArgs: unknown, signal: AbortSignal) => Promise<boolean>;
		} = {},
	): Promise<FrontendToolResult> {
		const tool = this.registry.get(name);
		if (!tool) return failure("unknown_tool");
		if (options.risk !== undefined && !["read", "auto", "confirm", "forbidden"].includes(options.risk))
			return failure("denied");
		if (FORBIDDEN.has(name) || tool.risk === "forbidden" || options.risk === "forbidden")
			return failure("denied");
		const needsConfirmation = CONFIRM.has(name) || tool.risk === "confirm" || options.risk === "confirm";
		// The callback is supplied by trusted UI code, never parsed from tool arguments.
		if (needsConfirmation && !options.requestConfirmation) return failure("confirmation_required");
		if (context.signal?.aborted) return failure("cancelled");
		let parsed: unknown;
		let state: FrontendToolContext["state"];
		try {
			parsed = structuredClone(tool.parseArguments(structuredClone(args)));
		} catch {
			return failure("invalid_arguments");
		}
		try {
			state = normalizeFrontendState(context.state);
		} catch {
			return failure("execution_failed");
		}
		const signal = context.signal;
		const router = context.router;
		const controller = new AbortController();
		return new Promise((resolve) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (result: FrontendToolResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", cancel);
				resolve(result);
			};
			const cancel = () => {
				finish(failure("cancelled"));
				controller.abort();
			};
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) {
				cancel();
				return;
			}
			timer = setTimeout(() => {
				finish(failure("timeout"));
				controller.abort();
			}, this.timeoutMs);
			void Promise.resolve()
				.then(async () => {
					if (controller.signal.aborted) return failure("cancelled");
					if (needsConfirmation) {
						try {
							if ((await options.requestConfirmation!(structuredClone(parsed), controller.signal)) !== true)
								return failure("denied");
						} catch {
							return failure("denied");
						}
					}
					if (controller.signal.aborted) return failure("cancelled");
					return tool.execute(parsed, { state, router, signal: controller.signal });
				})
				.then(
					(value) => finish(normalizeResult(value)),
					() => finish(failure("execution_failed")),
				)
				.catch(() => finish(failure("invalid_result")));
		});
	}
}
