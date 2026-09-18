"use client";
import { useAgent } from "@/agent/hooks/useAgent";
export function useAgentThread() {
	const { threadId, startNewConversation } = useAgent();
	return { threadId, startNewConversation };
}
