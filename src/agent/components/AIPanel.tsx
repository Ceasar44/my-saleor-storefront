"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAgentState } from "@/agent/hooks/useAgentState";
import { useAgentThread } from "@/agent/hooks/useAgentThread";
import { AIChat } from "@/agent/components/AIChat";
import { Button } from "@/ui/components/ui/button";
export function AIPanel() {
	const { state, setChatOpen } = useAgentState();
	const { startNewConversation } = useAgentThread();
	const t = useTranslations("agent");
	return (
		<Dialog.Root open={state.ui.chatOpen} onOpenChange={setChatOpen} modal={false}>
			<Dialog.Portal>
				<Dialog.Content
					id="agent-panel"
					aria-describedby="agent-description"
					onInteractOutside={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						document.getElementById("agent-launcher")?.focus();
					}}
					className="fixed inset-x-3 bottom-24 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl outline-none sm:left-auto sm:right-6 sm:w-96"
				>
					<header className="flex items-center gap-2 border-b p-4">
						<div className="min-w-0 flex-1">
							<Dialog.Title className="font-semibold">{t("title")}</Dialog.Title>
							<Dialog.Description id="agent-description" className="text-xs text-muted-foreground">
								{t("description")}
							</Dialog.Description>
						</div>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t("newConversation")}
							onClick={startNewConversation}
						>
							<Plus className="h-4 w-4" />
						</Button>
						<Dialog.Close asChild>
							<Button variant="ghost" size="icon" aria-label={t("close")}>
								<X className="h-4 w-4" />
							</Button>
						</Dialog.Close>
					</header>
					<AIChat />
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
