import { describe, expect, it, vi } from "vitest";
import { FrontendToolRegistry } from "@/agent/tools/registry";
import type { FrontendTool } from "@/agent/tools/types";

function tool(): FrontendTool {
	return {
		name: "test_tool",
		description: "Test tool",
		risk: "confirm",
		parseArguments: (args) => args,
		execute: vi.fn(),
	};
}

describe("frontend tool registry", () => {
	it("registers, looks up and unregisters tools; rejects duplicate names", () => {
		const registry = new FrontendToolRegistry();
		registry.register(tool());
		expect(registry.has("test_tool")).toBe(true);
		expect(registry.get("test_tool")?.name).toBe("test_tool");
		expect(() => registry.register(tool())).toThrow("already registered");
		registry.unregister("test_tool");
		registry.unregister("missing");
		expect(registry.list()).toEqual([]);
	});

	it("keeps its own immutable definition and list", () => {
		const registry = new FrontendToolRegistry();
		const definition = tool();
		registry.register(definition);
		Object.assign(definition, { risk: "auto", execute: vi.fn() });
		registry.list().pop();
		expect(registry.get("test_tool")?.risk).toBe("confirm");
		expect(Object.isFrozen(registry.get("test_tool"))).toBe(true);
		expect(registry.get("test_tool")?.execute).not.toBe(definition.execute);
	});

	it.each(["", "tool space", "__proto__", "A_TOOL", "a".repeat(101)])(
		"rejects invalid tool name %s",
		(name) => {
			expect(() => new FrontendToolRegistry().register({ ...tool(), name })).toThrow("Invalid");
		},
	);

	it("rejects malformed local policy", () => {
		expect(() =>
			new FrontendToolRegistry().register({ ...tool(), risk: "unsafe" } as unknown as FrontendTool),
		).toThrow("Invalid");
	});
});
