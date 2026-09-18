"use client";
import { useTranslations } from "next-intl";
import { useAgent } from "@/agent/hooks/useAgent";
import type { AgentToolStatus } from "@/agent/components/AIProvider";
import { Button } from "@/ui/components/ui/button";
export function getToolStatusLabel(
	status: AgentToolStatus,
): "confirmAction" | "toolDone" | "toolFailed" | "working" {
	return status.phase === "confirmation"
		? "confirmAction"
		: status.phase === "success"
			? "toolDone"
			: status.phase === "error"
				? "toolFailed"
				: "working";
}
export function AIToolStatus({ status }: { status: AgentToolStatus | null }) {
	const t = useTranslations("agent");
	const { confirmToolCall, rejectToolCall } = useAgent();
	if (!status) return null;
	const labels: Record<string, "addItem" | "removeItem" | "changeQuantity"> = {
		add_to_cart: "addItem",
		remove_from_cart: "removeItem",
		change_quantity: "changeQuantity",
	};
	let quantity: number | undefined;
	try {
		const args = JSON.parse(status.call.arguments) as { quantity?: number };
		if (
			typeof args.quantity === "number" &&
			Number.isInteger(args.quantity) &&
			args.quantity > 0 &&
			args.quantity <= 100
		)
			quantity = args.quantity;
	} catch {
		/* Invalid args never reach confirmation. */
	}
	return (
		<div role="status" className="space-y-2 border-t px-4 py-3 text-sm">
			<p>{t(getToolStatusLabel(status))}</p>
			{status.phase === "confirmation" && (
				<>
					{status.summary && <p className="font-medium">{status.summary}</p>}
					<p>
						{t(labels[status.call.name] ?? "working")}
						{quantity !== undefined ? ` (${quantity})` : ""}
					</p>
					<div className="flex gap-2">
						<Button type="button" size="sm" onClick={() => confirmToolCall(status.call.id)}>
							{t("confirm")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline-solid"
							onClick={() => rejectToolCall(status.call.id)}
						>
							{t("reject")}
						</Button>
					</div>
				</>
			)}
		</div>
	);
}
