export type AgentFrontendConfig = {
	endpoint: string;
	enabled: boolean;
	requestTimeoutMs: number;
	frontendToolTimeoutMs: number;
};

/** Public configuration only. Adapter addresses and credentials belong on the server. */
export const agentConfig: Readonly<AgentFrontendConfig> = Object.freeze({
	endpoint: "/api/agent",
	enabled: process.env.NEXT_PUBLIC_AI_ASSISTANT_ENABLED === "true",
	requestTimeoutMs: 120_000,
	frontendToolTimeoutMs: 30_000,
});

export function getAgentEndpoint(): string {
	return agentConfig.endpoint;
}

export function isAgentEnabled(): boolean {
	return agentConfig.enabled;
}
