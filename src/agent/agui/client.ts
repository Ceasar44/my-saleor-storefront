import { runHttpRequest, transformHttpEventStream } from "@ag-ui/client";
import { EventSchemas, EventType, type RunAgentInput, type Tool, type UserMessage } from "@ag-ui/core";
import { agentConfig } from "@/agent/config/agent";
import { AgentTransport } from "@/agent/agui/transport";
import type { AgentEvent } from "@/agent/agui/events";
import type { FrontendState } from "@/agent/state/types";
import { toAdapterFrontendState } from "@/agent/state/adapter";
import type { FrontendToolResult } from "@/agent/tools/types";
import { equalStateValue } from "@/agent/state/synchronizer";
import type { AdapterFrontendState } from "@/agent/state/adapter";

export type AgentToolCall = { id: string; name: string; arguments: string; threadId: string; runId: string };
export type CreateAgentClientOptions = {
	threadId: string;
	visitorId: string;
	transport?: AgentTransport;
	onAuthStatus?: (status: "guest" | "authenticated" | "unavailable") => void;
	onIdentityReset?: () => void;
};
export function toAdapterToolResult(call: AgentToolCall, result: FrontendToolResult, version?: number) {
	// Dispatcher accepts browser receipts only as success/error. Other statuses are server-owned.
	const status = result.success ? "success" : "error";
	const error = result.success ? undefined : "execution_failed";
	return {
		call_id: call.id,
		status,
		error,
		resulting_state_version: result.success ? version : undefined,
		data:
			result.success && result.data
				? {
						applied: result.data.applied,
						product_id: result.data.productId,
						variant_id: result.data.variantId,
						item_count: result.data.itemCount,
					}
				: {},
	};
}

export class AgentClient {
	private transport: AgentTransport;
	private listeners = new Set<(event: AgentEvent) => void>();
	private controllers = new Set<AbortController>();
	private state: FrontendState | null = null;
	private tools: Tool[] = [];
	private activeRun: string | null = null;
	private revision = 0;
	private acknowledgedState: AdapterFrontendState | null = null;
	constructor(private options: CreateAgentClientOptions) {
		this.transport =
			options.transport ??
			new AgentTransport({
				visitorId: options.visitorId,
				onAuthStatus: options.onAuthStatus,
				onIdentityReset: options.onIdentityReset,
			});
		try {
			const value = Number(localStorage.getItem(`paper.agent.revision.${options.threadId}`));
			if (Number.isSafeInteger(value) && value >= 0) this.revision = value;
		} catch {
			/* Storage is optional. */
		}
	}
	subscribe(listener: (event: AgentEvent) => void) {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	setFrontendState(state: FrontendState) {
		this.state = structuredClone(state);
	}
	setFrontendTools(tools: Tool[]) {
		this.tools = tools;
	}
	private snapshot() {
		if (!this.state) return undefined;
		const candidate = toAdapterFrontendState({ ...this.state, version: this.revision });
		if (
			this.acknowledgedState &&
			equalStateValue({ ...this.acknowledgedState, version: 0 }, { ...candidate, version: 0 })
		)
			return undefined;
		return { ...candidate, version: ++this.revision };
	}
	private async stream(input: RunAgentInput, emit: boolean) {
		const controller = new AbortController();
		this.controllers.add(controller);
		const timer = setTimeout(() => controller.abort(), agentConfig.requestTimeoutMs);
		try {
			await new Promise<void>((resolve, reject) => {
				let finished = false;
				const observable = transformHttpEventStream(
					runHttpRequest(() => this.transport.run(input, controller.signal)),
				);
				const subscription = observable.subscribe({
					next: (raw) => {
						if (controller.signal.aborted) return;
						try {
							const event = EventSchemas.parse(raw);
							if (event.type === EventType.STATE_SNAPSHOT && typeof event.snapshot?.version === "number") {
								this.revision = Math.max(this.revision, event.snapshot.version);
								const { updated_at: _timestamp, ...snapshot } = event.snapshot;
								this.acknowledgedState = snapshot as AdapterFrontendState;
								try {
									localStorage.setItem(
										`paper.agent.revision.${this.options.threadId}`,
										String(this.revision),
									);
								} catch {
									/* Optional persistence. */
								}
							}
							if (emit) for (const listener of this.listeners) listener(event);
							if (event.type === EventType.RUN_ERROR) reject(new Error("Agent run failed"));
							if (event.type === EventType.RUN_FINISHED) finished = true;
						} catch (error) {
							reject(error);
							controller.abort();
						}
					},
					error: reject,
					complete: () => (finished ? resolve() : reject(new Error("Agent stream ended before completion"))),
				});
				const abort = () => {
					subscription.unsubscribe();
					reject(new DOMException("Cancelled", "AbortError"));
				};
				controller.signal.addEventListener("abort", abort, { once: true });
				if (controller.signal.aborted) abort();
			});
		} finally {
			clearTimeout(timer);
			controller.abort();
			this.controllers.delete(controller);
		}
	}
	async run(message: UserMessage) {
		if (this.activeRun) throw new Error("A run is already active");
		const runId = crypto.randomUUID();
		this.activeRun = runId;
		try {
			await this.stream(
				{
					threadId: this.options.threadId,
					runId,
					messages: [message],
					state: this.snapshot() ?? {},
					tools: this.tools,
					context: [],
					forwardedProps: {},
				},
				true,
			);
		} finally {
			if (this.activeRun === runId) this.activeRun = null;
		}
	}
	async submitToolResult(call: AgentToolCall, result: FrontendToolResult, state?: FrontendState) {
		if (call.threadId !== this.options.threadId || call.runId !== this.activeRun)
			throw new Error("Stale tool call");
		if (state) this.setFrontendState(state);
		const snapshot = result.success ? this.snapshot() : undefined;
		await this.stream(
			{
				threadId: call.threadId,
				runId: call.runId,
				messages: [],
				state: {},
				tools: [],
				context: [],
				forwardedProps: {
					toolResults: [
						{
							threadId: call.threadId,
							runId: call.runId,
							result: toAdapterToolResult(call, result, snapshot?.version),
							state: snapshot,
						},
					],
				},
			},
			false,
		);
	}
	cancelRun() {
		this.activeRun = null;
		for (const controller of this.controllers) controller.abort();
	}
	dispose() {
		this.cancelRun();
		this.listeners.clear();
	}
}
export function createAgentClient(options: CreateAgentClientOptions) {
	return new AgentClient(options);
}
