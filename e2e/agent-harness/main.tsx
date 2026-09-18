import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
import { CartProvider, useCart } from "@/ui/components/cart/cart-context";
import { CatalogIdentityProvider } from "@/lib/catalog/catalog-identity-bridge";
import { AIProvider } from "@/agent/components/AIProvider";
import { AgentStateProvider } from "@/agent/state/provider";
import { AIButton } from "@/agent/components/AIButton";
import { AIPanel } from "@/agent/components/AIPanel";
import { AgentRuntimeBridge } from "@/agent/hooks/useAgentTool";
import { useAgent } from "@/agent/hooks/useAgent";
import "@/app/globals.css";
function CartFixture() {
	const { actions } = useAgent();
	const { isOpen, openCart } = useCart();
	useEffect(() => actions.register("openCart", openCart), [actions, openCart]);
	return (
		<main className="p-8">
			<h1>Agent browser contract fixture</h1>
			<p>This fixture tests the real chat and SDK with simulated SSE; it is not Saleor integration.</p>
			<output aria-label="Cart state">{isOpen ? "open" : "closed"}</output>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(
	<NextIntlClientProvider locale="en" messages={messages}>
		<CartProvider>
			<CatalogIdentityProvider>
				<AIProvider>
					<AgentStateProvider>
						<AgentRuntimeBridge />
						<CartFixture />
						<AIButton />
						<AIPanel />
					</AgentStateProvider>
				</AIProvider>
			</CatalogIdentityProvider>
		</CartProvider>
	</NextIntlClientProvider>,
);
