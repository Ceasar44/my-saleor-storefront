"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import type { AgentChatMessage } from "@/agent/components/AIProvider";
import { AIMessage } from "@/agent/components/AIMessage";
export function AIMessageList({ messages }: { messages: AgentChatMessage[] }) {
	const container = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const t = useTranslations("agent");
	useEffect(() => {
		if (follow.current && container.current) container.current.scrollTop = container.current.scrollHeight;
	}, [messages]);
	return (
		<div
			ref={container}
			role="log"
			aria-label={t("messages")}
			aria-live="polite"
			className="min-h-40 flex-1 space-y-4 overflow-y-auto p-4"
			onScroll={() => {
				const node = container.current;
				if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
			}}
		>
			{messages.length ? (
				messages.map((message) => <AIMessage key={message.id} message={message} />)
			) : (
				<p className="text-sm text-muted-foreground">{t("welcome")}</p>
			)}
		</div>
	);
}
