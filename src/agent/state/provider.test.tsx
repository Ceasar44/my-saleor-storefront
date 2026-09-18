// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { AgentContext, type AgentContextValue } from "@/agent/components/AIProvider";
import { AgentStateProvider } from "@/agent/state/provider";
import { useAgentState } from "@/agent/hooks/useAgentState";
import { CartProvider } from "@/ui/components/cart/cart-context";
import { CatalogIdentityProvider } from "@/lib/catalog/catalog-identity-bridge";
const route = vi.hoisted(() => ({ pathname: "/en/us/products/shirt" }));
vi.mock("next/navigation", () => ({
	usePathname: () => route.pathname,
	useParams: () => ({ locale: "en", channel: "us" }),
}));
afterEach(cleanup);
function Probe({ open }: { open: boolean }) {
	const { state, setChatOpen } = useAgentState();
	useEffect(() => setChatOpen(open), [open, setChatOpen]);
	return <output>{JSON.stringify(state)}</output>;
}
describe("frontend state runtime", () => {
	it("deduplicates identical inputs and increments only semantic changes", async () => {
		const send = vi.fn();
		const agent = {
			threadId: "t",
			authStatus: "unknown",
			setFrontendState: send,
		} as unknown as AgentContextValue;
		const tree = (open: boolean) => (
			<CartProvider>
				<CatalogIdentityProvider>
					<AgentContext.Provider value={agent}>
						<AgentStateProvider>
							<Probe open={open} />
						</AgentStateProvider>
					</AgentContext.Provider>
				</CatalogIdentityProvider>
			</CartProvider>
		);
		const view = render(tree(false));
		await waitFor(() => expect(send).toHaveBeenCalledOnce());
		expect(send.mock.calls[0][0].cart).not.toHaveProperty("itemCount");
		view.rerender(tree(false));
		expect(send).toHaveBeenCalledOnce();
		view.rerender(tree(true));
		await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
		expect(send.mock.calls[1][0].version).toBe(2);
		expect(send.mock.calls[1][0].ui.chatOpen).toBe(true);
	});
});
