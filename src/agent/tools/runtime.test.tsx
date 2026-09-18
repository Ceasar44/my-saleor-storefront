// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { AgentContext, type AgentContextValue } from "@/agent/components/AIProvider";
import { AgentStateContext, type AgentStateContextValue } from "@/agent/state/provider";
import { AgentRuntimeBridge } from "@/agent/hooks/useAgentTool";
import type { AgentToolCall } from "@/agent/agui/client";
import { AgentActionBindings } from "@/agent/tools/bindings";
import { FrontendTargetRegistry } from "@/agent/tools/targets";
import { collectFrontendState } from "@/agent/state/collector";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);
function harness() {
	let handle!: (call: AgentToolCall, signal: AbortSignal) => Promise<void>;
	const actions = new AgentActionBindings();
	const open = vi.fn();
	actions.register("openCart", open);
	const submit = vi.fn(async () => {});
	const declare = vi.fn();
	const agent = {
		threadId: "t",
		actions,
		targets: new FrontendTargetRegistry(),
		client: { submitToolResult: submit, setFrontendTools: declare },
		setToolCallHandler: (next: typeof handle) => {
			handle = next;
			return () => {};
		},
		setToolStatus: vi.fn(),
		requestConfirmation: vi.fn(async () => true),
	} as unknown as AgentContextValue;
	const state = collectFrontendState({ pathname: "/en/us", chatOpen: true }, 1);
	const context = {
		state,
		getCurrentState: () => state,
		setChatOpen: vi.fn(),
	} as unknown as AgentStateContextValue;
	render(
		<AgentContext.Provider value={agent}>
			<AgentStateContext.Provider value={context}>
				<AgentRuntimeBridge />
			</AgentStateContext.Provider>
		</AgentContext.Provider>,
	);
	return {
		handle: (call: AgentToolCall, signal = new AbortController().signal) => handle(call, signal),
		actions,
		open,
		submit,
		declare,
	};
}
const call = (overrides = {}): AgentToolCall => ({
	threadId: "t",
	runId: "r",
	id: "c",
	name: "open_cart",
	arguments: "{}",
	...overrides,
});
describe("AG-UI tool runtime", () => {
	it("deduplicates calls including their receipts", async () => {
		const test = harness();
		await Promise.all([test.handle(call()), test.handle(call())]);
		expect(test.open).toHaveBeenCalledOnce();
		expect(test.submit).toHaveBeenCalledOnce();
		expect(test.submit).toHaveBeenCalledWith(
			expect.objectContaining({ id: "c", runId: "r" }),
			{ success: true, data: { applied: true } },
			expect.objectContaining({ version: 1 }),
		);
	});
	it("does not execute stale-thread or cancelled calls", async () => {
		const test = harness();
		const controller = new AbortController();
		controller.abort();
		await test.handle(call(), controller.signal);
		await test.handle(call({ id: "other", threadId: "other" }));
		expect(test.open).not.toHaveBeenCalled();
		expect(test.submit).not.toHaveBeenCalled();
	});
	it("returns a failure for unknown tools and broken arguments", async () => {
		const test = harness();
		await test.handle(call({ name: "not_real" }));
		await test.handle(call({ id: "bad", arguments: "{" }));
		expect(test.submit.mock.calls).toHaveLength(2);
		expect(test.open).not.toHaveBeenCalled();
		expect(test.submit).toHaveBeenLastCalledWith(
			expect.anything(),
			{ success: false, error: "invalid_arguments" },
			expect.anything(),
		);
	});
	it("does not advertise unsupported backend tools", async () => {
		const test = harness();
		await waitFor(() => expect(test.declare).toHaveBeenCalled());
		const names = test.declare.mock.calls[0][0].map((tool: { name: string }) => tool.name);
		expect(names).toContain("select_variant");
		expect(names).not.toContain("go_back");
		expect(names).not.toContain("show_notification");
		expect(names).not.toContain("set_product_filters");
	});
});
