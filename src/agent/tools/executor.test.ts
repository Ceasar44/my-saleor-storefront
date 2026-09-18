import { afterEach, describe, expect, it, vi } from "vitest";
import { collectFrontendState } from "@/agent/state/collector";
import { FrontendToolExecutor } from "@/agent/tools/executor";
import { FrontendToolRegistry } from "@/agent/tools/registry";
import type { FrontendTool, FrontendToolContext, FrontendToolResult } from "@/agent/tools/types";

function setup(overrides: Partial<FrontendTool> = {}) {
	const run = vi.fn<FrontendTool["execute"]>().mockResolvedValue({ success: true, data: { applied: true } });
	const parse = vi.fn((args: unknown) => args);
	const tool: FrontendTool = {
		name: "test_tool",
		description: "Test tool",
		risk: "auto",
		parseArguments: parse,
		execute: run,
		...overrides,
	};
	const registry = new FrontendToolRegistry();
	registry.register(tool);
	const context: FrontendToolContext = {
		state: collectFrontendState({ pathname: "/en/us", chatOpen: false }, 0),
		router: { push: vi.fn() },
	};
	return { tool, run, parse, context, executor: new FrontendToolExecutor(registry, 100) };
}

describe("frontend tool execution", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns structured errors for unknown tools", async () => {
		const { executor, context, run } = setup();
		expect(await executor.execute("missing", {}, context)).toEqual({ success: false, error: "unknown_tool" });
		expect(run).not.toHaveBeenCalled();
	});

	it("allows requested risk to strengthen but never weaken local policy", async () => {
		const { executor, context, run } = setup();
		expect(await executor.execute("test_tool", {}, context, { risk: "confirm" })).toEqual({
			success: false,
			error: "confirmation_required",
		});
		expect(await executor.execute("test_tool", {}, context, { risk: "forbidden" })).toEqual({
			success: false,
			error: "denied",
		});
		expect(run).not.toHaveBeenCalled();
		const guarded = setup({ risk: "confirm" });
		expect(await guarded.executor.execute("test_tool", {}, guarded.context, { risk: "read" })).toEqual({
			success: false,
			error: "confirmation_required",
		});
		expect(guarded.run).not.toHaveBeenCalled();
	});

	it.each(["forbidden", "confirm"] as const)("checks %s risk before parsing or execution", async (risk) => {
		const { executor, context, run, parse } = setup({ risk });
		expect(await executor.execute("test_tool", { confirmed: true }, context)).toEqual({
			success: false,
			error: risk === "forbidden" ? "denied" : "confirmation_required",
		});
		expect(parse).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
	});

	it.each(["submit_payment", "place_order", "complete_checkout", "delete_account"])(
		"cannot weaken forbidden action %s with local risk metadata",
		async (name) => {
			const { executor, context, run } = setup({ name, risk: "read" });
			expect(await executor.execute(name, {}, context)).toEqual({ success: false, error: "denied" });
			expect(run).not.toHaveBeenCalled();
		},
	);

	it.each(["add_to_cart", "remove_from_cart", "change_quantity", "update_cart_quantity"])(
		"requires confirmation for %s even if registered auto",
		async (name) => {
			const { executor, context, run } = setup({ name });
			expect(await executor.execute(name, { confirmed: true }, context)).toEqual({
				success: false,
				error: "confirmation_required",
			});
			expect(run).not.toHaveBeenCalled();
		},
	);

	it("does not execute invalid arguments or expose parser messages", async () => {
		const { executor, context, run } = setup({
			parseArguments: () => {
				throw new Error("token=private");
			},
		});
		expect(await executor.execute("test_tool", {}, context)).toEqual({
			success: false,
			error: "invalid_arguments",
		});
		expect(run).not.toHaveBeenCalled();
	});

	it("isolates asynchronous execution from mutations to input/state", async () => {
		const { executor, context, run } = setup();
		const args = { nested: { value: 1 } };
		const pending = executor.execute("test_tool", args, context);
		args.nested.value = 2;
		context.state.ui.chatOpen = true;
		await pending;
		expect(run.mock.calls[0][0]).toEqual({ nested: { value: 1 } });
		expect(run.mock.calls[0][1].state.ui.chatOpen).toBe(false);
	});

	it("normalizes exceptions and failed result messages", async () => {
		const { executor, context, run } = setup();
		run.mockRejectedValueOnce(new Error("password=private"));
		expect(await executor.execute("test_tool", {}, context)).toEqual({
			success: false,
			error: "execution_failed",
		});
		run.mockResolvedValueOnce({
			success: false,
			error: "private traceback",
		} as unknown as FrontendToolResult);
		expect(await executor.execute("test_tool", {}, context)).toEqual({
			success: false,
			error: "execution_failed",
		});
	});

	it("projects a small receipt without forwarding arbitrary tool data", async () => {
		const { executor, context, run } = setup();
		run.mockResolvedValueOnce({
			success: true,
			data: {
				applied: true,
				itemCount: 2,
				productId: "P1",
				variantId: "V1",
				cookie: "secret",
				cart: { checkoutId: "secret" },
			},
		} as FrontendToolResult);
		expect(await executor.execute("test_tool", {}, context)).toEqual({
			success: true,
			data: { applied: true, itemCount: 2, productId: "P1", variantId: "V1" },
		});
		run.mockResolvedValueOnce({ success: true, data: { itemCount: -1 } });
		expect(await executor.execute("test_tool", {}, context)).toEqual({
			success: false,
			error: "invalid_result",
		});
	});

	it("cancels before execution when already aborted", async () => {
		const { executor, context, run } = setup();
		expect(await executor.execute("test_tool", {}, { ...context, signal: AbortSignal.abort() })).toEqual({
			success: false,
			error: "cancelled",
		});
		expect(run).not.toHaveBeenCalled();
	});

	it("signals active tools on timeout and ignores their late failures", async () => {
		vi.useFakeTimers();
		const { executor, context, run } = setup();
		let reject!: (error: Error) => void;
		run.mockImplementationOnce(
			() =>
				new Promise((_, rejectRun) => {
					reject = rejectRun;
				}),
		);
		const pending = executor.execute("test_tool", {}, context);
		await vi.advanceTimersByTimeAsync(100);
		expect(await pending).toEqual({ success: false, error: "timeout" });
		expect(run.mock.calls[0][1].signal?.aborted).toBe(true);
		reject(new Error("Late failure"));
		await vi.advanceTimersByTimeAsync(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cancels in flight and clears timeout/listener resources", async () => {
		vi.useFakeTimers();
		const { executor, context, run } = setup();
		run.mockImplementationOnce(() => new Promise(() => {}));
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const pending = executor.execute("test_tool", {}, { ...context, signal: controller.signal });
		await Promise.resolve();
		controller.abort();
		expect(await pending).toEqual({ success: false, error: "cancelled" });
		expect(run.mock.calls[0][1].signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});

	it("clears the timeout after successful completion", async () => {
		vi.useFakeTimers();
		const { executor, context } = setup();
		expect(await executor.execute("test_tool", {}, context)).toEqual({
			success: true,
			data: { applied: true },
		});
		expect(vi.getTimerCount()).toBe(0);
	});
});
