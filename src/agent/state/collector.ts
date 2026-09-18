import { LOCALE_DEFINITIONS } from "@/config/locale";
import { parseStorefrontPathname } from "@/lib/storefront-path";
import type { CatalogIdentity } from "@/lib/catalog/catalog-identity";
import type {
	AgentCartState,
	AgentCheckoutState,
	AgentProductState,
	AgentRouteState,
	AgentUserState,
	FrontendState,
} from "@/agent/state/types";

export type FrontendStateInput = {
	pathname: string;
	locale?: string | null;
	channel?: string | null;
	currency?: string | null;
	catalogIdentity?: CatalogIdentity | null;
	product?: AgentProductState | null;
	cart?: AgentCartState | null;
	checkout?: AgentCheckoutState | null;
	user?: AgentUserState;
	chatOpen: boolean;
};

const CHECKOUT_STEPS = new Set(["contact", "shipping", "delivery", "payment", "review", "complete"]);
const AUTH_STATUSES = new Set(["guest", "authenticated", "unavailable", "unknown"]);

function text(value: unknown, limit: number): string | null {
	return typeof value === "string" && value.trim() && [...value].length <= limit ? value : null;
}

/** Drop query/hash entirely, decode catalog slugs, and reject ambiguous local paths. */
function safePathname(value: string): string {
	try {
		const raw = value.split(/[?#]/, 1)[0];
		const segments = raw.split("/").map((segment) => decodeURIComponent(segment));
		if (
			segments.some(
				(segment) => /[/\\%?#\u0000-\u001f\u007f]/.test(segment) || segment === "." || segment === "..",
			)
		) {
			return "/";
		}
		const path = segments.join("/");
		if (!path.startsWith("/") || path.includes("//") || path.length > 1024) return "/";
		// Guest order URLs carry a bearer-like access key, even without a query.
		if (/^\/order\/(?!find(?:\/|$))[^/]+/.test(path)) return "/order/[key]";
		return path.replace(/\/$/, "") || "/";
	} catch {
		return "/";
	}
}

function describeRoute(pathname: string) {
	let path = safePathname(pathname);
	const parsed = parseStorefrontPathname(path);
	const browse = parsed && Object.hasOwn(LOCALE_DEFINITIONS, parsed.locale) ? parsed : null;
	const suffix = browse?.suffix ?? path;
	let pageType: AgentRouteState["pageType"] = "other";
	if (/^\/checkout(?:\/complete)?$/.test(path)) pageType = "checkout";
	else if (path === "/" || (browse && !suffix)) pageType = "home";
	else if (browse) {
		if (/^\/products\/[^/]+$/.test(suffix)) pageType = "product";
		else if (/^\/categories\/[^/]+$/.test(suffix)) pageType = "category";
		else if (/^\/collections\/[^/]+$/.test(suffix)) pageType = "collection";
		else if (suffix === "/search") pageType = "search";
		else if (suffix === "/cart") pageType = "cart";
		else if (/^\/account(?:\/|$)/.test(suffix)) {
			pageType = "account";
			path = path.replace(/\/account\/orders\/[^/]+.*$/, "/account/orders/[number]");
		}
	}
	return { route: { pathname: path, pageType }, browse };
}

export function inferPageType(pathname: string): AgentRouteState["pageType"] {
	return describeRoute(pathname).route.pageType;
}

function collectProduct(input: FrontendStateInput, routeSlug: string): AgentProductState | null {
	const product = input.product;
	if (!product || !text(product.id, 255) || !text(product.slug, 255)) return null;
	const identity = input.catalogIdentity;
	const identitySlugs =
		identity?.kind === "products" ? [identity.primarySlug, ...Object.values(identity.localeSlugs ?? {})] : [];
	const matchingIdentity = identitySlugs.includes(product.slug) && identitySlugs.includes(routeSlug);
	// A departing PDP bridge must not describe the next product while it mounts.
	if (product.slug !== routeSlug && !matchingIdentity) return null;
	return projectProduct(product, matchingIdentity ? identity?.primarySlug : product.slug);
}

function projectProduct(
	product: AgentProductState | null | undefined,
	slug = product?.slug,
): AgentProductState | null {
	if (!product || !text(product.id, 255) || !text(slug, 255)) return null;
	const attributes = Object.entries(product.selectedAttributes ?? {})
		.filter(([key, value]) => text(key, 200) && text(value, 200))
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.slice(0, 32);
	return {
		id: product.id,
		slug: slug!,
		...(text(product.name, 200) ? { name: product.name } : {}),
		selectedVariantId: text(product.selectedVariantId, 255),
		selectedSku: text(product.selectedSku, 255),
		selectedAttributes: Object.fromEntries(attributes),
	};
}

/** Pure allowlisted projection. No object spreads from commerce/session objects. */
export function collectFrontendState(input: FrontendStateInput, version: number): FrontendState {
	if (!Number.isSafeInteger(version) || version < 0) throw new Error("Invalid frontend state version.");
	const { route, browse } = describeRoute(input.pathname);
	const step = input.checkout?.step;
	const count = input.cart?.itemCount;
	return {
		version,
		route,
		store: {
			locale: text(input.locale === undefined ? browse?.locale : input.locale, 35),
			channel: text(input.channel === undefined ? browse?.channel : input.channel, 200),
			currency:
				typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency) ? input.currency : null,
		},
		product:
			route.pageType === "product" ? collectProduct(input, browse!.suffix.slice("/products/".length)) : null,
		cart: {
			isOpen: input.cart?.isOpen === true,
			...(Number.isSafeInteger(count) && count! >= 0 && count! <= 100_000 ? { itemCount: count } : {}),
		},
		checkout: route.pageType === "checkout" ? { step: step && CHECKOUT_STEPS.has(step) ? step : null } : null,
		user: { status: input.user && AUTH_STATUSES.has(input.user.status) ? input.user.status : "unknown" },
		ui: { chatOpen: input.chatOpen === true },
	};
}

/** Copy and re-project at transport/diff boundaries so extra properties cannot leak. */
export function normalizeFrontendState(state: FrontendState, version = state.version): FrontendState {
	const clean = collectFrontendState(
		{
			pathname: state.route.pathname,
			locale: state.store.locale,
			channel: state.store.channel,
			currency: state.store.currency,
			product: state.product,
			cart: state.cart,
			checkout: state.checkout,
			user: state.user,
			chatOpen: state.ui.chatOpen,
		},
		version,
	);
	// A collected product may use a primary slug on a translated route. No catalog
	// context is available here; preserve that already-associated product identity.
	clean.product = clean.route.pageType === "product" ? projectProduct(state.product) : null;
	return clean;
}
