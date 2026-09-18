// Storefront extensions only; protocol types will come from the official AG-UI SDK.
export type AgentRunId = string;
export type AgentThreadId = string;
export type AgentVisitorId = string;

export type StorefrontAuthStatus = "guest" | "authenticated" | "unavailable";

/** An untrusted browser hint, never proof of identity or conversation ownership. */
export type StorefrontIdentityHint = {
	visitorId: AgentVisitorId;
};

export type AgentRunContext = {
	threadId: AgentThreadId;
	runId: AgentRunId;
	visitorId: AgentVisitorId;
};
