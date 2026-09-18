"use client";
import { useOptionalAgentState } from "@/agent/state/provider";
export { useOptionalAgentState } from "@/agent/state/provider";
export function useAgentState() {
	const value = useOptionalAgentState();
	if (!value) throw new Error("useAgentState must be used within AgentStateProvider");
	return value;
}
