"use client";
import { useTranslations } from "next-intl";
import { useAgent } from "@/agent/hooks/useAgent";
import { AIMessageList } from "@/agent/components/AIMessageList";
import { AIInput } from "@/agent/components/AIInput";
import { AIToolStatus } from "@/agent/components/AIToolStatus";
export function AIChat() {
	const { messages, toolStatus, error, notification } = useAgent();
	const t = useTranslations("agent");
	return (
		<>
			<AIMessageList messages={messages} />
			<AIToolStatus status={toolStatus} />
			{notification && (
				<p role="status" className="px-4 py-2 text-sm">
					{notification}
				</p>
			)}
			{error && (
				<p role="alert" className="px-4 py-2 text-sm text-destructive">
					{t(error === "toolFailed" ? "toolFailed" : "unavailable")}
				</p>
			)}
			<AIInput />
		</>
	);
}
