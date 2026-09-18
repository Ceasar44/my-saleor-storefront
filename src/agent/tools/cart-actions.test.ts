import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	mutate: vi.fn(),
	find: vi.fn(),
	create: vi.fn(),
	cookie: vi.fn(),
	save: vi.fn(),
	refresh: vi.fn(),
	emit: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));
vi.mock("@/lib/auth/bff-server", () => ({ signOutSession: vi.fn() }));
vi.mock("@/lib/graphql", () => ({
	executePublicGraphQL: mocks.query,
	executeAuthenticatedGraphQL: mocks.mutate,
}));
vi.mock("@/lib/checkout", () => ({
	find: mocks.find,
	findOrCreate: mocks.create,
	getIdFromCookies: mocks.cookie,
	saveIdToCookie: mocks.save,
	clearCheckoutCookie: vi.fn(),
}));
vi.mock("@/lib/analytics/emit.server", () => ({ emitCommerceEvent: mocks.emit }));
import { addCartLine, mutateAgentCart } from "@/app/actions";

beforeEach(() => {
	vi.resetAllMocks();
	mocks.cookie.mockResolvedValue("own-cart");
	mocks.create.mockResolvedValue({ id: "own-cart" });
	mocks.query.mockResolvedValue({
		ok: true,
		data: {
			productVariant: {
				id: "v",
				product: { id: "p" },
				pricing: { price: { gross: { amount: 10, currency: "USD" } } },
			},
		},
	});
});
describe("Agent shared cart server actions", () => {
	it("passes the requested quantity and reports the actual returned cart total", async () => {
		mocks.mutate.mockResolvedValue({
			ok: true,
			data: { checkoutLinesAdd: { errors: [], checkout: { lines: [{ quantity: 3 }, { quantity: 2 }] } } },
		});
		expect(
			await addCartLine({ channel: "us", localeSlug: "en", variantId: "v", productId: "p", quantity: 3 }),
		).toEqual({ success: true, data: { applied: true, productId: "p", variantId: "v", itemCount: 5 } });
		expect(mocks.mutate).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ variables: { id: "own-cart", productVariantId: "v", quantity: 3 } }),
		);
		expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ value: 30 }));
	});
	it("does not mutate a variant belonging to another product", async () => {
		expect(
			await addCartLine({ channel: "us", localeSlug: "en", variantId: "v", productId: "other", quantity: 1 }),
		).toEqual({ success: false, error: "invalid_arguments" });
		expect(mocks.mutate).not.toHaveBeenCalled();
	});
	it("does not report success or analytics for Saleor business errors", async () => {
		mocks.mutate.mockResolvedValue({
			ok: true,
			data: { checkoutLinesAdd: { errors: [{ code: "INSUFFICIENT_STOCK" }], checkout: { lines: [] } } },
		});
		expect(await addCartLine({ channel: "us", localeSlug: "en", variantId: "v", quantity: 3 })).toEqual({
			success: false,
			error: "execution_failed",
		});
		expect(mocks.emit).not.toHaveBeenCalled();
	});
	it("rejects cart lines outside the current cookie's checkout", async () => {
		mocks.find.mockResolvedValue({ lines: [{ id: "own-line" }] });
		expect(await mutateAgentCart("us", "foreign-line", null)).toEqual({
			success: false,
			error: "invalid_arguments",
		});
		expect(mocks.mutate).not.toHaveBeenCalled();
	});
	it("updates the cookie-owned cart and preserves a rejected quantity result", async () => {
		mocks.find.mockResolvedValue({ lines: [{ id: "own-line" }] });
		mocks.mutate.mockResolvedValue({
			ok: true,
			data: {
				checkoutLinesUpdate: {
					errors: [{ code: "INSUFFICIENT_STOCK" }],
					checkout: { lines: [{ quantity: 1 }] },
				},
			},
		});
		expect(await mutateAgentCart("us", "own-line", 10)).toEqual({
			success: false,
			error: "execution_failed",
		});
		expect(mocks.mutate).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				variables: { checkoutId: "own-cart", lines: [{ lineId: "own-line", quantity: 10 }] },
			}),
		);
	});
});
