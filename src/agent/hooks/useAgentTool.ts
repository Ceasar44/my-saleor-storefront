"use client";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Tool } from "@ag-ui/core";
import { useAgent } from "@/agent/hooks/useAgent";
import { useAgentState } from "@/agent/hooks/useAgentState";
import { FrontendToolRegistry } from "@/agent/tools/registry";
import { FrontendToolExecutor } from "@/agent/tools/executor";
import { createNavigateTool, createGoBackTool } from "@/agent/tools/navigation";
import { createScrollToTool, createHighlightElementTool, createShowNotificationTool } from "@/agent/tools/ui";
import {
	createOpenProductTool,
	createSelectVariantTool,
	createSetProductFiltersTool,
} from "@/agent/tools/product";
import {
	createOpenCartTool,
	createAddToCartTool,
	createUpdateCartQuantityTool,
	createRemoveFromCartTool,
} from "@/agent/tools/cart";
import { createOpenCheckoutTool } from "@/agent/tools/checkout";
import type { FrontendToolResult } from "@/agent/tools/types";

const string = { type: "string", minLength: 1, maxLength: 255 };
const schemas: Record<string, Record<string, unknown>> = {
	navigate: { pathname: { ...string, maxLength: 1024 } },
	open_product: { product_id: string },
	select_variant: { product_id: string, variant_id: string },
	open_cart: {},
	open_checkout: {},
	scroll_to: { target: { enum: ["product", "variants", "cart", "checkout"], type: "string" } },
	highlight_element: { target: { enum: ["product", "variants", "cart", "checkout"], type: "string" } },
	add_to_cart: {
		product_id: string,
		variant_id: string,
		quantity: { type: "integer", minimum: 1, maximum: 100 },
	},
	change_quantity: { line_id: string, quantity: { type: "integer", minimum: 1, maximum: 100 } },
	remove_from_cart: { line_id: string },
};

export function useAgentTool() {
	const agent = useAgent();
	const state = useAgentState();
	const router = useRouter();
	const latest = useRef({ agent, state, router });
	useEffect(() => {
		latest.current = { agent, state, router };
	}, [agent, state, router]);
	const registry = useMemo(() => {
		const result = new FrontendToolRegistry();
		result.register(createNavigateTool());
		result.register(createGoBackTool(agent.actions));
		result.register(createScrollToTool(agent.targets));
		result.register(createHighlightElementTool(agent.targets));
		result.register(createShowNotificationTool(agent.actions));
		result.register(createSetProductFiltersTool(agent.actions));
		result.register(createOpenProductTool(agent.actions));
		result.register(createSelectVariantTool(agent.actions));
		result.register(createOpenCartTool(agent.actions));
		result.register(createAddToCartTool(agent.actions));
		result.register(createUpdateCartQuantityTool(agent.actions));
		result.register(createRemoveFromCartTool(agent.actions));
		result.register(createOpenCheckoutTool(agent.actions));
		return result;
	}, [agent.actions, agent.targets]);
	const executor = useMemo(() => new FrontendToolExecutor(registry), [registry]);
	const calls = useRef(new Map<string, Promise<void>>());
	const callRun = useRef("");
	const { threadId, setToolCallHandler } = agent;
	useEffect(() => {
		calls.current.clear();
		return setToolCallHandler((call, signal) => {
			if (callRun.current !== call.runId) {
				calls.current.clear();
				callRun.current = call.runId;
			}
			const key = `${call.threadId}:${call.runId}:${call.id}`;
			const existing = calls.current.get(key);
			if (existing) return existing;
			const execute = async () => {
				const { agent: current, state: currentState, router: currentRouter } = latest.current;
				if (!current.client || current.threadId !== call.threadId || signal.aborted) return;
				current.setToolStatus({ call, phase: "running" });
				let result: FrontendToolResult;
				try {
					if (call.arguments.length > 65536) throw new Error("Tool arguments too large");
					const args: unknown = JSON.parse(call.arguments || "{}");
					result = await executor.execute(
						call.name,
						args,
						{ state: currentState.getCurrentState(), router: currentRouter, signal },
						{
							requestConfirmation: async (parsed, confirmationSignal) => {
								const summary = await current.actions.get("describeCartAction")?.(
									call.name,
									parsed as { variantId?: string; lineId?: string },
								);
								if (!summary || confirmationSignal.aborted) return false;
								currentState.setChatOpen(true);
								return current.requestConfirmation(call, confirmationSignal, summary);
							},
						},
					);
				} catch {
					result = { success: false, error: "invalid_arguments" };
				}
				if (signal.aborted) return;
				// React effects publish the mutation/route state before the receipt is collected.
				await new Promise((resolve) => setTimeout(resolve, 0));
				await current.client.submitToolResult(call, result, currentState.getCurrentState());
				if (call.name === "open_checkout" && result.success && !signal.aborted)
					current.actions.get("finishNavigation")?.();
				if (!signal.aborted) current.setToolStatus({ call, phase: result.success ? "success" : "error" });
			};
			// Serialize tools so state revisions and user confirmations cannot race.
			const previous = [...calls.current.values()].at(-1) ?? Promise.resolve();
			const promise = previous.catch(() => {}).then(execute);
			calls.current.set(key, promise);
			return promise;
		});
	}, [threadId, setToolCallHandler, executor]);
	useEffect(() => {
		const tools: Tool[] = registry
			.list()
			.filter((tool) => schemas[tool.name])
			.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: {
					type: "object",
					additionalProperties: false,
					properties: schemas[tool.name],
					required: Object.keys(schemas[tool.name]),
				},
			}));
		agent.client?.setFrontendTools(tools);
	}, [agent.client, registry]);
	return { registry, executeFrontendTool: executor.execute.bind(executor) };
}

export function AgentRuntimeBridge() {
	useAgentTool();
	return null;
}
