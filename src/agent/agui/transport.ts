import type { RunAgentInput } from "@ag-ui/core";
import { agentConfig } from "@/agent/config/agent";

export class AgentIdentityResetError extends Error {
	constructor() {
		super("Agent identity must be reinitialized");
		this.name = "AgentIdentityResetError";
	}
}

export class AgentTransport {
	constructor(
		private readonly options: {
			endpoint?: string;
			visitorId: string;
			fetch?: typeof fetch;
			onAuthStatus?: (status: "guest" | "authenticated" | "unavailable") => void;
			onIdentityReset?: () => void;
		},
	) {}
	async run(input: RunAgentInput, signal?: AbortSignal): Promise<Response> {
		const endpoint = this.options.endpoint ?? agentConfig.endpoint;
		if (!endpoint.startsWith("/") || endpoint.startsWith("//") || endpoint.includes("\\"))
			throw new Error("Agent endpoint must be same-origin");
		const response = await (this.options.fetch ?? fetch)(endpoint, {
			method: "POST",
			credentials: "same-origin",
			redirect: "error",
			signal,
			headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
			body: JSON.stringify({ ...input, visitorId: this.options.visitorId }),
		});
		if (response.status === 409 && response.headers.get("content-type")?.startsWith("application/json")) {
			const body = (await response.json()) as { error?: unknown };
			if (body?.error === "agent_identity_reset") {
				this.options.onIdentityReset?.();
				throw new AgentIdentityResetError();
			}
			throw new Error("Agent service is unavailable");
		}
		if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
			await response.body?.cancel();
			throw new Error("Agent service is unavailable");
		}
		const status = response.headers.get("x-agent-auth-status");
		if (status === "guest" || status === "authenticated" || status === "unavailable")
			this.options.onAuthStatus?.(status);
		return response;
	}
}
