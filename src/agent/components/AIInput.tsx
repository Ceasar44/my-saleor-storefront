"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAgent } from "@/agent/hooks/useAgent";
import { Button } from "@/ui/components/ui/button";
export function AIInput() {
	const [draft, setDraft] = useState("");
	const agent = useAgent();
	const t = useTranslations("agent");
	const running = agent.status === "running";
	const ready = agent.status !== "initializing" && agent.client !== null;
	const submit = () => {
		if (!draft.trim() || running || !ready) return;
		const text = draft;
		setDraft("");
		void agent.sendMessage(text);
	};
	return (
		<form
			className="space-y-2 border-t p-4"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<textarea
				aria-label={t("input")}
				placeholder={t("placeholder")}
				value={draft}
				maxLength={32000}
				rows={2}
				disabled={!ready}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
						event.preventDefault();
						submit();
					}
				}}
				className="w-full resize-none rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<div className="flex justify-end">
				{running ? (
					<Button type="button" variant="outline-solid" onClick={agent.cancelRun}>
						{t("stop")}
					</Button>
				) : (
					<Button type="submit" disabled={!ready || !draft.trim()}>
						{t("send")}
					</Button>
				)}
			</div>
		</form>
	);
}
