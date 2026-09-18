"use client";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useParams, usePathname } from "next/navigation";
import { useCatalogIdentity } from "@/lib/catalog/catalog-identity-bridge";
import { useCart } from "@/ui/components/cart/cart-context";
import { collectFrontendState } from "@/agent/state/collector";
import { buildStateDelta, equalStateValue } from "@/agent/state/synchronizer";
import type {
	AgentProductState,
	AgentCheckoutState,
	AgentUserState,
	FrontendState,
} from "@/agent/state/types";
import { useAgent } from "@/agent/hooks/useAgent";

export type AgentStateContextValue = {
	state: FrontendState;
	getCurrentState(): FrontendState;
	setProductState(product: AgentProductState): void;
	clearProductState(productId: string): void;
	setVariantState(productId: string, variant: Partial<AgentProductState>): void;
	setCartState(cart: { itemCount?: number }): void;
	setCheckoutState(checkout: AgentCheckoutState | null): void;
	setUserState(user: AgentUserState): void;
	setChatOpen(open: boolean): void;
	setCurrency(currency: string | null): void;
};
export const AgentStateContext = createContext<AgentStateContextValue | null>(null);

export function AgentStateProvider({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const params = useParams<{ locale: string; channel: string }>();
	const identity = useCatalogIdentity();
	const cart = useCart();
	const { threadId, authStatus, setFrontendState } = useAgent();
	const [product, setProduct] = useState<AgentProductState | null>(null);
	const [variant, setVariant] = useState<{ productId: string; value: Partial<AgentProductState> } | null>(
		null,
	);
	const [cartSummary, setCart] = useState<{ channel?: string; itemCount?: number }>({});
	const [checkout, setCheckoutState] = useState<AgentCheckoutState | null>(null);
	const [user, setUserState] = useState<AgentUserState>({ status: "unknown" });
	const [chatOpen, setChatOpen] = useState(false);
	const [currency, setCurrencyValue] = useState<{ channel: string; value: string | null } | null>(null);
	const setCurrency = useCallback(
		(value: string | null) =>
			setCurrencyValue((old) =>
				old?.channel === params.channel && old.value === value ? old : { channel: params.channel, value },
			),
		[params.channel],
	);
	const source = useMemo(
		() =>
			collectFrontendState(
				{
					pathname,
					locale: params.locale,
					channel: params.channel,
					currency: currency?.channel === params.channel ? currency.value : null,
					catalogIdentity: identity,
					product: product
						? { ...product, ...(variant?.productId === product.id ? variant.value : {}) }
						: null,
					cart: {
						itemCount: cartSummary.channel === params.channel ? cartSummary.itemCount : undefined,
						isOpen: cart.isOpen,
					},
					checkout,
					user: authStatus === "unknown" ? user : { status: authStatus },
					chatOpen,
				},
				0,
			),
		[
			pathname,
			params.locale,
			params.channel,
			currency,
			identity,
			product,
			variant,
			cartSummary,
			cart.isOpen,
			checkout,
			user,
			authStatus,
			chatOpen,
		],
	);
	const [snapshot, setSnapshot] = useState(() => ({
		threadId,
		input: source,
		state: { ...source, version: 1 },
	}));
	let state = snapshot.state;
	if (snapshot.threadId !== threadId || !equalStateValue(snapshot.input, source)) {
		const previous = snapshot.threadId === threadId ? snapshot.state : null;
		const next = { ...source, version: previous ? previous.version + 1 : 1 };
		const delta = buildStateDelta(previous, next);
		state =
			delta.type === "snapshot" ? delta.state : { ...snapshot.state, ...delta.patch, version: delta.version };
		setSnapshot({ threadId, input: source, state });
	}
	const current = useRef(source);
	const getCurrentState = useCallback(() => current.current, []);
	useEffect(() => {
		current.current = state;
		setFrontendState(state);
	}, [state, setFrontendState]);
	const setProductState = useCallback(
		(next: AgentProductState) => setProduct((old) => (equalStateValue(old, next) ? old : next)),
		[],
	);
	const clearProductState = useCallback((id: string) => {
		setProduct((old) => (old?.id === id ? null : old));
		setVariant((old) => (old?.productId === id ? null : old));
	}, []);
	const setVariantState = useCallback(
		(id: string, value: Partial<AgentProductState>) =>
			setVariant((old) =>
				old?.productId === id && equalStateValue(old.value, value) ? old : { productId: id, value },
			),
		[],
	);
	const setCartState = useCallback(
		(next: { itemCount?: number }) =>
			setCart((old) =>
				old.channel === params.channel && equalStateValue(old.itemCount, next.itemCount)
					? old
					: { ...next, channel: params.channel },
			),
		[params.channel],
	);
	const value = useMemo(
		() => ({
			state,
			getCurrentState,
			setProductState,
			clearProductState,
			setVariantState,
			setCartState,
			setCheckoutState,
			setUserState,
			setChatOpen,
			setCurrency,
		}),
		[state, getCurrentState, setProductState, clearProductState, setVariantState, setCartState, setCurrency],
	);
	return <AgentStateContext.Provider value={value}>{children}</AgentStateContext.Provider>;
}

export function useOptionalAgentState() {
	return useContext(AgentStateContext);
}
