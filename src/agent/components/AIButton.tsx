"use client";
import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAgentState } from "@/agent/hooks/useAgentState";
import { Button } from "@/ui/components/ui/button";
export function AIButton() {
	const { state, setChatOpen } = useAgentState();
	const t = useTranslations("agent");
	return (
		<Button
			id="agent-launcher"
			className="fixed bottom-6 right-6 z-40 rounded-full shadow-lg"
			aria-label={t("title")}
			aria-expanded={state.ui.chatOpen}
			aria-controls="agent-panel"
			onClick={() => setChatOpen(!state.ui.chatOpen)}
		>
			<MessageCircle className="mr-2 h-5 w-5" />
			{t("title")}
		</Button>
	);
}
