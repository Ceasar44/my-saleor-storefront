"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { signOutSession } from "@/lib/auth/bff-server";
import { clearAgentVisitorCookie } from "@/agent/identity/visitor-cookie";
import { executeAuthenticatedGraphQL } from "@/lib/graphql";
import { CheckoutDeleteLinesDocument, CheckoutLinesUpdateDocument } from "@/gql/graphql";
import * as Checkout from "@/lib/checkout";
import {
	AgentProductRouteDocument,
	CheckoutAddLineDocument,
	ProductVariantForPdpDocument,
} from "@/gql/graphql";
import { executePublicGraphQL } from "@/lib/graphql";
import { graphqlLanguageCodeVariables } from "@/lib/graphql-locale";
import { buildStorefrontPath } from "@/lib/storefront-path";
import { pickTranslatedSlug } from "@/lib/saleor-translations";
import { emitCommerceEvent } from "@/lib/analytics/emit.server";
import type { FrontendToolResult } from "@/agent/tools/types";

export async function resolveAgentProductRoute(productId: string, channel: string, localeSlug: string) {
	const result = await executePublicGraphQL(AgentProductRouteDocument, {
		variables: { id: productId, channel, ...graphqlLanguageCodeVariables(localeSlug) },
		cache: "no-cache",
	});
	if (!result.ok || !result.data.product) return null;
	return buildStorefrontPath(
		localeSlug,
		channel,
		`/products/${encodeURIComponent(pickTranslatedSlug(result.data.product))}`,
	);
}

export async function resolveAgentVariant(
	productId: string,
	channel: string,
	localeSlug: string,
	selector: { variantId?: string; sku?: string },
) {
	if (!!selector.variantId === !!selector.sku) return null;
	const result = await executePublicGraphQL(ProductVariantForPdpDocument, {
		variables: {
			id: selector.variantId,
			sku: selector.sku,
			channel,
			...graphqlLanguageCodeVariables(localeSlug),
		},
		cache: "no-cache",
	});
	const variant = result.ok ? result.data.productVariant : null;
	return variant?.product.id === productId ? { id: variant.id } : null;
}

/** User-facing confirmation labels come from this cart/catalog, not model text. */
export async function describeAgentCartAction(
	channel: string,
	localeSlug: string,
	name: string,
	args: { variantId?: string; lineId?: string },
) {
	if (name === "add_to_cart" && args.variantId) {
		const result = await executePublicGraphQL(ProductVariantForPdpDocument, {
			variables: { id: args.variantId, channel, ...graphqlLanguageCodeVariables(localeSlug) },
			cache: "no-cache",
		});
		const variant = result.ok ? result.data.productVariant : null;
		return variant ? [variant.product.name, variant.name].filter(Boolean).join(" · ") : null;
	}
	if (["change_quantity", "remove_from_cart"].includes(name) && args.lineId) {
		const id = await Checkout.getIdFromCookies(channel);
		const checkout = id ? await Checkout.find(id, localeSlug) : null;
		const line = checkout?.lines.find((item) => item.id === args.lineId);
		return line ? [line.variant.product.name, line.variant.name].filter(Boolean).join(" · ") : null;
	}
	return null;
}

export async function addCartLine({
	channel,
	localeSlug,
	variantId,
	quantity,
	productId,
}: {
	channel: string;
	localeSlug: string;
	variantId: string;
	quantity: number;
	productId?: string;
}): Promise<FrontendToolResult> {
	if (!variantId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100)
		return { success: false, error: "invalid_arguments" };
	try {
		const variantResult = await executePublicGraphQL(ProductVariantForPdpDocument, {
			variables: { id: variantId, channel, ...graphqlLanguageCodeVariables(localeSlug) },
			cache: "no-cache",
		});
		const variant = variantResult.ok ? variantResult.data.productVariant : null;
		if (!variant || (productId && variant.product.id !== productId))
			return { success: false, error: "invalid_arguments" };
		const checkout = await Checkout.findOrCreate({
			checkoutId: await Checkout.getIdFromCookies(channel),
			channel,
			localeSlug,
		});
		if (!checkout) return { success: false, error: "execution_failed" };
		await Checkout.saveIdToCookie(channel, checkout.id);
		const result = await executeAuthenticatedGraphQL(CheckoutAddLineDocument, {
			variables: { id: checkout.id, productVariantId: variantId, quantity },
			cache: "no-cache",
		});
		const payload = result.ok ? result.data.checkoutLinesAdd : null;
		if (!payload?.checkout || payload.errors.length) return { success: false, error: "execution_failed" };
		const price = variant.pricing?.price?.gross;
		emitCommerceEvent({
			name: "product_added_to_cart",
			channel,
			value: (price?.amount ?? 0) * quantity,
			currency: price?.currency ?? "",
		});
		refresh();
		return {
			success: true,
			data: {
				applied: true,
				variantId,
				productId: variant.product.id,
				itemCount: payload.checkout.lines.reduce((sum, line) => sum + line.quantity, 0),
			},
		};
	} catch {
		return { success: false, error: "execution_failed" };
	}
}

/** Agent callers never choose a checkout ID: resolve this browser's cart cookie. */
export async function mutateAgentCart(
	channel: string,
	lineId: string,
	quantity: number | null,
): Promise<FrontendToolResult> {
	const id = await Checkout.getIdFromCookies(channel);
	const cart = id ? await Checkout.find(id) : null;
	if (!id || !cart?.lines.some((line) => line.id === lineId))
		return { success: false, error: "invalid_arguments" };
	if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100))
		return { success: false, error: "invalid_arguments" };
	return quantity === null ? deleteCartLine(id, lineId) : updateCartLineQuantity(id, lineId, quantity);
}

// Private state (session/cart cookies) lives in dynamic holes that read cookies at
// request time — it is never in the shared cache, so there is nothing global to
// invalidate. `refresh()` re-renders the acting user's route in the action response;
// `revalidatePath` here would purge shared static shells for every visitor (a
// sitewide regeneration bill per cart click). Cross-tab sync is client-side via
// `bumpChromeVersion()` — see src/lib/chrome-sync.ts and the `paper-vercel-cost` rule.

/**
 * SDK `signOut` only clears cookies for the current NEXT_PUBLIC_SALEOR_API_URL.
 * Cookies minted against a previously configured Saleor instance keep matching
 * `hasAuthSession()`'s marker scan, wedging the header in "unavailable" — sweep
 * every Saleor auth cookie regardless of API URL.
 */
async function clearAllSaleorAuthCookies() {
	const cookieStore = await cookies();
	for (const cookie of cookieStore.getAll()) {
		if (cookie.name.includes("saleor_auth")) {
			cookieStore.delete(cookie.name);
		}
	}
}

/** Callers hard-navigate afterwards (see `useLogout`), which picks up the cleared cookies. */
export async function logout() {
	const cookieStore = await cookies();

	for (const cookie of cookieStore.getAll()) {
		if (!cookie.name.startsWith("checkoutId-") || !cookie.value) {
			continue;
		}
		await Checkout.detachCustomer(cookie.value);
	}

	await signOutSession();
	await clearAllSaleorAuthCookies();
	await clearAgentVisitorCookie();
}

export async function saveCheckoutId(channel: string, checkoutId: string) {
	await Checkout.saveIdToCookie(channel, checkoutId);
}

/**
 * Clear the checkout cookie after a successful order.
 * Call after checkoutComplete succeeds — typically after navigating to order confirmation.
 * Never revalidates `/checkout` (that remounts the flow and resets the step mid-payment).
 */
export async function clearCheckout(channel: string) {
	"use server";
	await Checkout.clearCheckoutCookie(channel);
	refresh();
}

export async function deleteCartLine(checkoutId: string, lineId: string) {
	const result = await executeAuthenticatedGraphQL(CheckoutDeleteLinesDocument, {
		variables: {
			checkoutId,
			lineIds: [lineId],
		},
		cache: "no-cache",
	});

	if (result.ok) {
		const checkout = result.data.checkoutLinesDelete?.checkout;
		if (checkout && checkout.lines.length === 0) {
			await Checkout.clearCheckoutCookie(checkout.channel.slug);
		}
	}

	refresh();
	return result.ok &&
		result.data.checkoutLinesDelete?.checkout &&
		!result.data.checkoutLinesDelete.errors.length
		? {
				success: true as const,
				data: {
					applied: true,
					itemCount: result.data.checkoutLinesDelete.checkout.lines.reduce(
						(sum, line) => sum + line.quantity,
						0,
					),
				},
			}
		: { success: false as const, error: "execution_failed" as const };
}

export async function updateCartLineQuantity(checkoutId: string, lineId: string, quantity: number) {
	if (quantity < 1) {
		return deleteCartLine(checkoutId, lineId);
	}

	const result = await executeAuthenticatedGraphQL(CheckoutLinesUpdateDocument, {
		variables: {
			checkoutId,
			lines: [{ lineId, quantity }],
		},
		cache: "no-cache",
	});

	refresh();
	return result.ok &&
		result.data.checkoutLinesUpdate?.checkout &&
		!result.data.checkoutLinesUpdate.errors.length
		? {
				success: true as const,
				data: {
					applied: true,
					itemCount: result.data.checkoutLinesUpdate.checkout.lines.reduce(
						(sum, line) => sum + line.quantity,
						0,
					),
				},
			}
		: { success: false as const, error: "execution_failed" as const };
}
