import { describe, expect, it } from "vitest";
import { toAdapterFrontendState, toAdapterFrontendStateDelta } from "@/agent/state/adapter";
import { collectFrontendState } from "@/agent/state/collector";

function sample(version = 1) {
	return collectFrontendState(
		{
			pathname: "/en/us/products/coat",
			currency: "USD",
			product: {
				id: "P1",
				slug: "coat",
				name: "Coat",
				selectedVariantId: "V1",
				selectedSku: "SKU1",
				selectedAttributes: { color: "black", size: "L", material: "wool" },
			},
			cart: { isOpen: true, itemCount: 2 },
			user: { status: "authenticated" },
			chatOpen: true,
		},
		version,
	);
}

describe("adapter frontend state contract", () => {
	it("projects only the fields accepted by the current strict adapter model", () => {
		expect(toAdapterFrontendState(sample())).toEqual({
			version: 1,
			route: { pathname: "/en/us/products/coat", page_type: "product" },
			store: { locale: "en", channel: "us", currency: "USD" },
			product: { id: "P1", variant_id: "V1", color: "black", size: "L" },
			cart: { is_open: true, item_count: 2 },
			checkout: { step: null },
			user: { is_logged_in: true },
			ui: { cart_open: true, chat_open: true },
		});
	});

	it.each(["unknown", "unavailable"] as const)("preserves %s as an indeterminate display hint", (status) => {
		const state = sample();
		state.user.status = status;
		expect(toAdapterFrontendState(state).user.is_logged_in).toBeNull();
		state.user.status = "guest";
		expect(toAdapterFrontendState(state).user.is_logged_in).toBe(false);
	});

	it.each(["/en/us/collections/winter", "/en/us/account"])(
		"maps unsupported adapter page types to other: %s",
		(pathname) => {
			const state = collectFrontendState({ pathname, chatOpen: false }, 1);
			expect(toAdapterFrontendState(state).route.page_type).toBe("other");
		},
	);

	it("does not forward extra fields even when normalization is bypassed by callers", () => {
		const state = sample();
		Object.assign(state, { updated_at: "fake", cookie: "secret" });
		Object.assign(state.store, { pathname: "/order/secret", accessToken: "secret" });
		Object.assign(state.product!, { accessToken: "secret" });
		Object.assign(state.cart!, { checkoutId: "secret" });
		Object.assign(state.user, { saleorUserId: "secret" });
		const wire = toAdapterFrontendState(state);
		expect(JSON.stringify(wire)).not.toMatch(
			/secret|updated_at|checkoutId|saleorUserId|accessToken|SKU1|material/,
		);
		expect(wire.route.pathname).toBe("/en/us/products/coat");
	});

	it("clears all product leaves under the adapter's object-merge delta semantics", () => {
		const before = sample();
		const current = collectFrontendState({ pathname: "/en/us/cart", chatOpen: false }, 2);
		const delta = toAdapterFrontendStateDelta(before, current);
		expect(delta).toMatchObject({
			base_version: 1,
			version: 2,
			changes: { product: { id: null, variant_id: null, color: null, size: null } },
		});
		const wireBefore = toAdapterFrontendState(before);
		const merged = Object.fromEntries(
			Object.entries(wireBefore).map(([key, value]) => {
				const change = delta.changes[key as keyof typeof delta.changes];
				return [key, change ? { ...(value as object), ...change } : value];
			}),
		);
		merged.version = delta.version;
		expect(merged).toEqual(toAdapterFrontendState(current));
	});

	it("clears deselected variant and removed attributes without clearing product identity", () => {
		const before = sample();
		const current = sample(2);
		current.product!.selectedVariantId = null;
		current.product!.selectedAttributes = {};
		expect(toAdapterFrontendStateDelta(before, current).changes.product).toEqual({
			id: "P1",
			variant_id: null,
			color: null,
			size: null,
		});
	});

	it("keeps revision-only wire deltas when local-only fields change", () => {
		const before = sample();
		const current = sample(2);
		current.product!.selectedSku = "different";
		expect(toAdapterFrontendStateDelta(before, current)).toEqual({
			base_version: 1,
			version: 2,
			changes: {},
		});
		expect(() => toAdapterFrontendStateDelta(before, sample(4))).toThrow("revision");
	});
});
