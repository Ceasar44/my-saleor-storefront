export type AgentBrowserSession = {
	visitorId: string;
	resetThread: boolean;
	authStatus: "guest" | "authenticated" | "unavailable";
};

let initializing: Promise<AgentBrowserSession> | null = null;

/** Only merges concurrent initialization; never caches authentication across requests. */
export function initializeAgentSession(): Promise<AgentBrowserSession> {
	if (initializing) return initializing;
	initializing = (async () => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 15000);
		try {
			const response = await fetch("/api/agent/session", {
				method: "POST",
				credentials: "same-origin",
				redirect: "error",
				cache: "no-store",
				signal: controller.signal,
				headers: { Accept: "application/json" },
			});
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error("Agent session unavailable");
			}
			const value = (await response.json()) as Partial<AgentBrowserSession>;
			if (
				!value ||
				typeof value.visitorId !== "string" ||
				!/^visitor_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.visitorId) ||
				typeof value.resetThread !== "boolean" ||
				!["guest", "authenticated", "unavailable"].includes(value.authStatus ?? "")
			)
				throw new Error("Invalid Agent session");
			return { visitorId: value.visitorId, resetThread: value.resetThread, authStatus: value.authStatus! };
		} finally {
			clearTimeout(timer);
		}
	})();
	void initializing
		.finally(() => {
			initializing = null;
		})
		.catch(() => {});
	return initializing;
}
