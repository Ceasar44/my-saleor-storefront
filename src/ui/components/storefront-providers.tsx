"use client";

import { type ReactNode } from "react";
import { CatalogIdentityProvider } from "@/lib/catalog/catalog-identity-bridge";
import { CartProvider } from "@/ui/components/cart/cart-context";
import { isAgentEnabled } from "@/agent/config/agent";
import { AIProvider } from "@/agent/components/AIProvider";
import { AgentStateProvider } from "@/agent/state/provider";
import { AgentRuntimeBridge } from "@/agent/hooks/useAgentTool";
import { StorefrontActionsBridge } from "@/agent/state/storefront-actions-bridge";
import { AIButton } from "@/agent/components/AIButton";
import { AIPanel } from "@/agent/components/AIPanel";

function AgentIntegration({ children }: { children: ReactNode }) {
	return (
		<AIProvider>
			<AgentStateProvider>
				<AgentRuntimeBridge />
				<StorefrontActionsBridge />
				{children}
				<AIButton />
				<AIPanel />
			</AgentStateProvider>
		</AIProvider>
	);
}

export function StorefrontProviders({ children }: { children: ReactNode }) {
	return (
		<CartProvider>
			<CatalogIdentityProvider>
				{isAgentEnabled() ? <AgentIntegration>{children}</AgentIntegration> : children}
			</CatalogIdentityProvider>
		</CartProvider>
	);
}
