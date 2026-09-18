import type { FrontendTool, FrontendToolRisk } from "@/agent/tools/types";

const RISKS = new Set<FrontendToolRisk>(["read", "auto", "confirm", "forbidden"]);

export class FrontendToolRegistry {
	private readonly tools = new Map<string, FrontendTool>();

	register<TArgs>(tool: FrontendTool<TArgs>): void {
		if (
			!/^[a-z][a-z0-9_]{0,99}$/.test(tool.name) ||
			!tool.description.trim() ||
			tool.description.length > 1000 ||
			!RISKS.has(tool.risk) ||
			typeof tool.parseArguments !== "function" ||
			typeof tool.execute !== "function"
		) {
			throw new Error("Invalid frontend tool definition.");
		}
		if (this.tools.has(tool.name)) throw new Error(`Frontend tool already registered: ${tool.name}`);
		// Capture metadata/methods so later changes to the registration object cannot weaken policy.
		this.tools.set(
			tool.name,
			Object.freeze({
				name: tool.name,
				description: tool.description,
				risk: tool.risk,
				parseArguments: tool.parseArguments,
				execute: tool.execute,
			}),
		);
	}

	unregister(name: string): void {
		this.tools.delete(name);
	}
	get(name: string): FrontendTool | undefined {
		return this.tools.get(name);
	}
	list(): FrontendTool[] {
		return [...this.tools.values()];
	}
	has(name: string): boolean {
		return this.tools.has(name);
	}
}
