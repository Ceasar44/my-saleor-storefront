import { afterEach, describe, expect, it, vi } from "vitest";
import { collectFrontendState } from "@/agent/state/collector";
import { FrontendToolExecutor } from "@/agent/tools/executor";
import { FrontendToolRegistry } from "@/agent/tools/registry";
import { FrontendTargetRegistry } from "@/agent/tools/targets";
import { createHighlightElementTool, createScrollToTool } from "@/agent/tools/ui";

/** DOM contract fixture: effects and lifecycle are tested without a global document. */
function elementFixture(initialClasses: string[] = []) {
	const classes = new Set(initialClasses);
	const element = {
		isConnected: true,
		getClientRects: vi.fn(() => [{}]),
		closest: vi.fn(() => null as unknown),
		ownerDocument: {
			defaultView: { getComputedStyle: vi.fn(() => ({ visibility: "visible", display: "block" })) },
		},
		classList: {
			contains: (name: string) => classes.has(name),
			add: (...names: string[]) => {
				for (const name of names) classes.add(name);
			},
			remove: (...names: string[]) => {
				for (const name of names) classes.delete(name);
			},
		},
		scrollIntoView: vi.fn(),
	};
	return { element, node: element as unknown as HTMLElement, classes };
}

function setup(pathname = "/en/us/products/coat", timeout = 2000) {
	const targets = new FrontendTargetRegistry();
	const registry = new FrontendToolRegistry();
	registry.register(createScrollToTool(targets));
	registry.register(createHighlightElementTool(targets, 1000));
	return {
		targets,
		executor: new FrontendToolExecutor(registry, timeout),
		context: { state: collectFrontendState({ pathname, chatOpen: false }, 1), router: { push: vi.fn() } },
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("semantic target registration", () => {
	it("registers explicit elements and protects replacements from stale cleanup", () => {
		const targets = new FrontendTargetRegistry();
		const first = elementFixture();
		const second = elementFixture();
		const removeFirst = targets.register("product", first.node);
		const old = targets.resolve("product")!;
		const removeSecond = targets.register("product", second.node);
		expect(old.signal.aborted).toBe(true);
		removeFirst();
		expect(targets.resolve("product")?.element).toBe(second.node);
		removeSecond();
		removeSecond();
		expect(targets.resolve("product")).toBeNull();
	});

	it.each(["disconnected", "no-layout", "hidden-ancestor", "hidden-style", "display-none", "document-gone"])(
		"does not expose a %s target",
		(mode) => {
			const targets = new FrontendTargetRegistry();
			const { node, element } = elementFixture();
			if (mode === "disconnected") element.isConnected = false;
			if (mode === "no-layout") element.getClientRects.mockReturnValue([]);
			if (mode === "hidden-ancestor") element.closest.mockReturnValue({});
			if (mode === "hidden-style")
				element.ownerDocument.defaultView.getComputedStyle.mockReturnValue({
					visibility: "hidden",
					display: "block",
				});
			if (mode === "display-none")
				element.ownerDocument.defaultView.getComputedStyle.mockReturnValue({
					visibility: "visible",
					display: "none",
				});
			if (mode === "document-gone")
				element.ownerDocument.defaultView.getComputedStyle.mockImplementation(() => {
					throw new Error("Detached document");
				});
			targets.register("product", node);
			expect(targets.resolve("product")).toBeNull();
		},
	);

	it("clears all registrations and aborts their lifetimes", () => {
		const targets = new FrontendTargetRegistry();
		targets.register("product", elementFixture().node);
		targets.register("variants", elementFixture().node);
		const bindings = [targets.resolve("product")!, targets.resolve("variants")!];
		targets.clear();
		expect(bindings.every((binding) => binding.signal.aborted)).toBe(true);
		expect(targets.resolve("product")).toBeNull();
		expect(targets.resolve("variants")).toBeNull();
	});
});

describe("scroll tool", () => {
	it("scrolls only the explicit registered target without animation or focus changes", async () => {
		const { targets, executor, context } = setup();
		const { node, element } = elementFixture();
		targets.register("product", node);
		expect(await executor.execute("scroll_to", { target: "product" }, context)).toEqual({
			success: true,
			data: { applied: true },
		});
		expect(element.scrollIntoView).toHaveBeenCalledWith({
			behavior: "instant",
			block: "center",
			inline: "nearest",
		});
	});

	it.each(["#product", "body", "[data-private]", "product-options", "constructor"])(
		"rejects selector/unknown target %s",
		async (target) => {
			const { executor, context } = setup();
			expect(await executor.execute("scroll_to", { target }, context)).toEqual({
				success: false,
				error: "invalid_arguments",
			});
		},
	);

	it("returns target_not_found for an unregistered target", async () => {
		const { executor, context } = setup();
		expect(await executor.execute("scroll_to", { target: "variants" }, context)).toEqual({
			success: false,
			error: "target_not_found",
		});
	});

	it("rejects a stale product target on a different page", async () => {
		const { targets, executor, context } = setup("/en/us/cart");
		const { node, element } = elementFixture();
		targets.register("product", node);
		expect(await executor.execute("scroll_to", { target: "product" }, context)).toEqual({
			success: false,
			error: "target_not_found",
		});
		expect(element.scrollIntoView).not.toHaveBeenCalled();
	});

	it("allows cart drawer targets only while the drawer is open", async () => {
		const { targets, executor, context } = setup();
		targets.register("cart", elementFixture().node);
		expect(await executor.execute("scroll_to", { target: "cart" }, context)).toEqual({
			success: false,
			error: "target_not_found",
		});
		context.state.cart = { isOpen: true };
		expect(await executor.execute("scroll_to", { target: "cart" }, context)).toEqual({
			success: true,
			data: { applied: true },
		});
	});

	it("supports checkout targets only on the checkout surface", async () => {
		const { targets, executor, context } = setup("/checkout");
		targets.register("checkout", elementFixture().node);
		expect(await executor.execute("scroll_to", { target: "checkout" }, context)).toEqual({
			success: true,
			data: { applied: true },
		});
	});
});

describe("highlight tool lifecycle", () => {
	it("temporarily adds token classes and preserves existing classes", async () => {
		vi.useFakeTimers();
		const { targets, executor, context } = setup();
		const { node, classes } = elementFixture(["ring-2", "product-card"]);
		targets.register("product", node);
		const pending = executor.execute("highlight_element", { target: "product" }, context);
		await vi.advanceTimersByTimeAsync(0);
		expect(classes.has("ring-ring")).toBe(true);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toEqual({ success: true, data: { applied: true } });
		expect([...classes]).toEqual(["ring-2", "product-card"]);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps overlapping highlights until the last request ends", async () => {
		vi.useFakeTimers();
		const { targets, executor, context } = setup();
		const { node, classes } = elementFixture();
		targets.register("product", node);
		const first = executor.execute("highlight_element", { target: "product" }, context);
		await vi.advanceTimersByTimeAsync(500);
		const second = executor.execute("highlight_element", { target: "product" }, context);
		await vi.advanceTimersByTimeAsync(500);
		expect((await first).success).toBe(true);
		expect(classes.has("ring-ring")).toBe(true);
		await vi.advanceTimersByTimeAsync(500);
		expect((await second).success).toBe(true);
		expect(classes.size).toBe(0);
	});

	it.each(["cancel", "timeout", "unregister", "clear", "replace"])(
		"cleans active effects on %s",
		async (mode) => {
			vi.useFakeTimers();
			const { targets, executor, context } = setup(undefined, mode === "timeout" ? 500 : 2000);
			const { node, classes } = elementFixture();
			const unregister = targets.register("product", node);
			const controller = new AbortController();
			const pending = executor.execute(
				"highlight_element",
				{ target: "product" },
				{ ...context, signal: controller.signal },
			);
			await vi.advanceTimersByTimeAsync(0);
			if (mode === "cancel") controller.abort();
			if (mode === "unregister") unregister();
			if (mode === "clear") targets.clear();
			if (mode === "replace") targets.register("product", elementFixture().node);
			if (mode === "timeout") await vi.advanceTimersByTimeAsync(500);
			expect(await pending).toEqual({
				success: false,
				error: mode === "cancel" ? "cancelled" : mode === "timeout" ? "timeout" : "target_not_found",
			});
			expect(classes.size).toBe(0);
			expect(vi.getTimerCount()).toBe(0);
		},
	);

	it("handles elements detached without registration cleanup", async () => {
		vi.useFakeTimers();
		const { targets, executor, context } = setup();
		const { node, element, classes } = elementFixture();
		targets.register("product", node);
		const pending = executor.execute("highlight_element", { target: "product" }, context);
		await vi.advanceTimersByTimeAsync(0);
		element.isConnected = false;
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toEqual({ success: false, error: "target_not_found" });
		expect(classes.size).toBe(0);
	});

	it("does not allow the Agent to control duration or selectors", async () => {
		const { executor, context } = setup();
		expect(
			await executor.execute("highlight_element", { target: "product", durationMs: 999999 }, context),
		).toEqual({ success: false, error: "invalid_arguments" });
	});
});
