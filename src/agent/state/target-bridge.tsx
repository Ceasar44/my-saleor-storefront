"use client";
import { useEffect, useRef } from "react";
import { useOptionalAgent } from "@/agent/components/AIProvider";
import { useOptionalAgentState } from "@/agent/hooks/useAgentState";
import type { FrontendTarget } from "@/agent/tools/targets";
export function AgentTargetBridge({
	target,
	active = true,
	whenCartClosed = false,
}: {
	target: FrontendTarget;
	active?: boolean;
	whenCartClosed?: boolean;
}) {
	const targets = useOptionalAgent()?.targets;
	const cartOpen = useOptionalAgentState()?.state.cart?.isOpen;
	const enabled = active && (!whenCartClosed || !cartOpen);
	const marker = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		const parent = marker.current?.parentElement;
		if (enabled && parent && targets) return targets.register(target, parent);
	}, [targets, target, enabled]);
	return <span hidden ref={marker} />;
}
