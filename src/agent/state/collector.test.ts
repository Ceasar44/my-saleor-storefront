import { describe, expect, it } from "vitest";
import {
	collectFrontendState,
	inferPageType,
	normalizeFrontendState,
	type FrontendStateInput,
} from "@/agent/state/collector";

const input: FrontendStateInput = {
	pathname: "/en/us/products/coat",
	currency: "USD",
	product: {
		id: "Product:1",
		slug: "coat",
		selectedVariantId: "Variant:1",
		selectedAttributes: { size: "L", color: "black" },
	},
	cart: { isOpen: true, itemCount: 2 },
	chatOpen: true,
};

describe("frontend semantic collection", () => {
	it.each([
		["/", "home"],
		["/en/us/", "home"],
		["/en/us/products/coat", "product"],
		["/pl/pl/categories/kurtki", "category"],
		["/ja/japan/collections/winter", "collection"],
		["/en/us/search?query=private", "search"],
		["/en/us/cart", "cart"],
		["/checkout?checkout=secret", "checkout"],
		["/checkout/complete", "checkout"],
		["/en/us/account/orders/42", "account"],
		["/en/us/products", "other"],
		["/en/us/pages/cart", "other"],
		["/en/us/products/cart", "product"],
		["/en/us/cartoon", "other"],
		["/en/us/products/coat/extra", "other"],
		["/order/find", "other"],
		["/order/private-key", "other"],
		["/api/agent", "other"],
	])("classifies %s as %s", (path, pageType) => {
		expect(inferPageType(path)).toBe(pageType);
	});

	it("builds deterministic detached state and infers the browse prefix", () => {
		const state = collectFrontendState(input, 1);
		expect(state).toEqual(collectFrontendState(input, 1));
		expect(state.store).toEqual({ locale: "en", channel: "us", currency: "USD" });
		expect(state.user.status).toBe("unknown");
		state.product!.selectedAttributes!.color = "red";
		expect(input.product!.selectedAttributes!.color).toBe("black");
	});

	it("preserves the four auth hints without adding identities", () => {
		for (const status of ["guest", "authenticated", "unavailable", "unknown"] as const) {
			expect(collectFrontendState({ ...input, user: { status } }, 0).user).toEqual({ status });
		}
	});

	it("filters extra commerce and credential fields at every object boundary", () => {
		const state = collectFrontendState(
			{
				...input,
				pathname: "/en/us/products/coat?token=query-secret#fragment-secret",
				product: { ...input.product!, accessToken: "product-secret" },
				cart: { isOpen: true, itemCount: 2, checkoutId: "checkout-secret", lines: [] },
				user: { status: "authenticated", id: "user-secret", email: "private@example.com" },
				cookie: "cookie-secret",
			} as FrontendStateInput,
			1,
		);
		const serialized = JSON.stringify(state);
		expect(serialized).not.toMatch(/secret|email|cookie|accessToken|checkoutId|lines/);
		expect(state.route.pathname).toBe("/en/us/products/coat");
		expect(state.user).toEqual({ status: "authenticated" });
	});

	it.each(["/order/bearer-secret", "/order/%62earer-secret?email=private", "/order/bearer-secret/extra"])(
		"redacts order access path %s",
		(pathname) => {
			expect(collectFrontendState({ ...input, pathname }, 1).route.pathname).toBe("/order/[key]");
		},
	);

	it("redacts account order numbers", () => {
		expect(collectFrontendState({ ...input, pathname: "/en/us/account/orders/12345" }, 1).route).toEqual({
			pathname: "/en/us/account/orders/[number]",
			pageType: "account",
		});
	});

	it.each([
		"https://evil.test/x",
		"//evil.test/x",
		"/en/us/%ZZ",
		"/en/us/%2Forder",
		"/en/us/%252Forder",
		"/en/us/../account",
		"/en/us/%00",
		"/en/us/\\private",
		"/" + "a".repeat(1024),
	])("fails closed on ambiguous path %s", (pathname) => {
		expect(collectFrontendState({ ...input, pathname }, 1).route.pathname).toBe("/");
	});

	it("decodes translated slugs and associates their primary catalog identity", () => {
		const state = collectFrontendState(
			{
				...input,
				pathname: "/pl/pl/products/p%C5%82aszcz",
				catalogIdentity: { kind: "products", primarySlug: "coat", localeSlugs: { pl: "płaszcz" } },
			},
			1,
		);
		expect(state.route.pathname).toBe("/pl/pl/products/płaszcz");
		expect(state.product?.slug).toBe("coat");
		expect(normalizeFrontendState(state)).toEqual(state);
	});

	it("drops stale product and checkout data after navigation", () => {
		expect(collectFrontendState({ ...input, pathname: "/en/us/products/boots" }, 1).product).toBeNull();
		const state = collectFrontendState(
			{ ...input, pathname: "/en/us/cart", checkout: { step: "payment" } },
			1,
		);
		expect(state.product).toBeNull();
		expect(state.checkout).toBeNull();
		expect(collectFrontendState({ ...input, product: undefined }, 1).product).toBeNull();
	});

	it("requires catalog identity to match both the product and current route", () => {
		expect(
			collectFrontendState(
				{
					...input,
					pathname: "/pl/pl/products/buty",
					catalogIdentity: { kind: "products", primarySlug: "boots", localeSlugs: { pl: "buty" } },
				},
				1,
			).product,
		).toBeNull();
	});

	it("keeps checkout locale/channel explicit and unknown cart count absent", () => {
		const state = collectFrontendState(
			{
				pathname: "/checkout",
				locale: "pl",
				channel: "pl",
				currency: "PLN",
				checkout: { step: "shipping" },
				chatOpen: false,
			},
			2,
		);
		expect(state.store).toEqual({ locale: "pl", channel: "pl", currency: "PLN" });
		expect(state.cart).toEqual({ isOpen: false });
		expect(state.checkout).toEqual({ step: "shipping" });
		expect(collectFrontendState({ pathname: "/checkout", chatOpen: false }, 0).store.channel).toBeNull();
	});

	it.each([-1, 1.5, NaN, Infinity, 100_001])("omits invalid cart counts: %s", (itemCount) => {
		expect(collectFrontendState({ ...input, cart: { isOpen: false, itemCount } }, 1).cart).toEqual({
			isOpen: false,
		});
	});

	it("bounds values and ignores invalid enums", () => {
		const state = collectFrontendState(
			{
				...input,
				currency: "usd",
				channel: "x".repeat(201),
				user: { status: "admin" },
				product: {
					...input.product!,
					name: "x".repeat(201),
					selectedVariantId: "",
					selectedAttributes: { color: "x".repeat(201) },
				},
			} as unknown as FrontendStateInput,
			1,
		);
		expect(state.store.currency).toBeNull();
		expect(state.store.channel).toBeNull();
		expect(state.user.status).toBe("unknown");
		expect(state.product?.selectedVariantId).toBeNull();
		expect(state.product?.name).toBeUndefined();
		expect(state.product?.selectedAttributes).toEqual({});
	});

	it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		"rejects invalid state revision: %s",
		(version) => {
			expect(() => collectFrontendState(input, version)).toThrow("version");
		},
	);
});
