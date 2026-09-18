// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AgentStateContext, type AgentStateContextValue } from "@/agent/state/provider";
import { AgentProductStateBridge, AgentVariantStateBridge } from "@/agent/state/product-state-bridge";
import { collectFrontendState } from "@/agent/state/collector";
afterEach(cleanup);
function context(): AgentStateContextValue {
	return {
		state: collectFrontendState({ pathname: "/en/us", chatOpen: false }, 0),
		getCurrentState: vi.fn(),
		setProductState: vi.fn(),
		clearProductState: vi.fn(),
		setVariantState: vi.fn(),
		setCartState: vi.fn(),
		setCheckoutState: vi.fn(),
		setUserState: vi.fn(),
		setChatOpen: vi.fn(),
		setCurrency: vi.fn(),
	};
}
describe("product state bridges", () => {
	it("registers and clears a product without exposing its full object", () => {
		const state = context();
		const view = render(
			<AgentStateContext.Provider value={state}>
				<AgentProductStateBridge product={{ id: "p", slug: "shirt", name: "Shirt" }} />
			</AgentStateContext.Provider>,
		);
		expect(state.setProductState).toHaveBeenCalledWith({ id: "p", slug: "shirt", name: "Shirt" });
		view.unmount();
		expect(state.clearProductState).toHaveBeenCalledWith("p");
	});
	it("updates selection from resolved variant props", () => {
		const state = context();
		const view = render(
			<AgentStateContext.Provider value={state}>
				<AgentVariantStateBridge productId="p" variantId="v1" attributes={{ color: "black" }} />
			</AgentStateContext.Provider>,
		);
		view.rerender(
			<AgentStateContext.Provider value={state}>
				<AgentVariantStateBridge productId="p" variantId="v2" sku="SKU2" attributes={{ color: "blue" }} />
			</AgentStateContext.Provider>,
		);
		expect(state.setVariantState).toHaveBeenLastCalledWith("p", {
			selectedVariantId: "v2",
			selectedSku: "SKU2",
			selectedAttributes: { color: "blue" },
		});
	});
	it("is harmless when the feature is disabled", () => {
		expect(() => render(<AgentProductStateBridge product={{ id: "p", slug: "shirt" }} />)).not.toThrow();
	});
});
