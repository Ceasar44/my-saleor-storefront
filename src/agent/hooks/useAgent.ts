"use client";
import { useOptionalAgent } from "@/agent/components/AIProvider";
export function useAgent() {
	const value = useOptionalAgent();
	if (!value) throw new Error("useAgent must be used within AIProvider");
	return value;
}
