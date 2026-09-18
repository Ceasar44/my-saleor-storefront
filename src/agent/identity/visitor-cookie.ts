import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getAgentServerConfig, type AgentServerConfig } from "@/agent/config/server";
import type { AgentSessionUser } from "@/agent/identity/session-user";

const LIFETIME = 30 * 24 * 60 * 60;
const PRODUCTION_COOKIE = "__Host-paper-agent-visitor";
const DEVELOPMENT_COOKIE = "paper-agent-visitor-dev";
type VisitorClaims = {
	v: 1;
	visitorId: string;
	principal: string | null;
	exp: number;
	tenant_id: string;
	store_id: string;
};
type CookieStore = {
	get(name: string): { value: string } | undefined;
	set(
		name: string,
		value: string,
		options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; maxAge: number },
	): unknown;
};
export type VerifiedVisitor = { visitorId: string; resetThread: boolean };
const cookieName = (config: AgentServerConfig) =>
	config.secureCookies ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE;
const signature = (payload: string, config: AgentServerConfig) =>
	createHmac("sha256", config.visitorKey).update(`paper-agent-visitor-v1\n${payload}`).digest();

export function readVerifiedVisitor(
	value: string | undefined,
	config: AgentServerConfig,
	now = Math.floor(Date.now() / 1000),
): VisitorClaims | null {
	if (!value || value.length > 2048) return null;
	const parts = value.split(".");
	if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
	try {
		const actual = Buffer.from(parts[1], "base64url");
		const expected = signature(parts[0], config);
		if (
			actual.length !== expected.length ||
			actual.toString("base64url") !== parts[1] ||
			!timingSafeEqual(actual, expected)
		)
			return null;
		const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as VisitorClaims;
		if (
			!data ||
			data.v !== 1 ||
			typeof data.visitorId !== "string" ||
			!/^visitor_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.visitorId) ||
			(data.principal !== null &&
				(typeof data.principal !== "string" ||
					!/^[A-Za-z0-9][A-Za-z0-9_.:/+=-]{0,254}$/.test(data.principal))) ||
			!Number.isSafeInteger(data.exp) ||
			data.exp <= now ||
			data.exp > now + LIFETIME + 5 ||
			data.tenant_id !== config.scope.tenant_id ||
			data.store_id !== config.scope.store_id
		)
			return null;
		return data;
	} catch {
		return null;
	}
}

export function issueVisitorCookie(
	store: CookieStore,
	claims: VisitorClaims,
	config: AgentServerConfig,
	now = Math.floor(Date.now() / 1000),
) {
	const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
	store.set(cookieName(config), `${payload}.${signature(payload, config).toString("base64url")}`, {
		httpOnly: true,
		secure: config.secureCookies,
		sameSite: "lax",
		path: "/",
		maxAge: Math.max(0, claims.exp - now),
	});
}

export async function resolveVerifiedVisitor(
	session: AgentSessionUser,
	options: { config?: AgentServerConfig; store?: CookieStore; now?: number } = {},
): Promise<VerifiedVisitor> {
	const config = options.config ?? getAgentServerConfig();
	const store = options.store ?? (await cookies());
	const now = options.now ?? Math.floor(Date.now() / 1000);
	const previous = readVerifiedVisitor(store.get(cookieName(config))?.value, config, now);
	const principal =
		session.status === "authenticated"
			? session.user.id
			: session.status === "unavailable"
				? (previous?.principal ?? null)
				: null;
	const rotate =
		!previous ||
		(session.status !== "unavailable" && previous.principal !== null && previous.principal !== principal);
	const visitorId = previous && !rotate ? previous.visitorId : `visitor_${randomUUID()}`;
	if (rotate || previous?.principal !== principal)
		issueVisitorCookie(
			store,
			{
				v: 1,
				visitorId,
				principal,
				exp: now + LIFETIME,
				...config.scope,
			},
			config,
			now,
		);
	return { visitorId, resetThread: rotate };
}

/** Logout must work even when Agent configuration is absent or disabled. */
export async function clearAgentVisitorCookie() {
	const store = await cookies();
	store.delete(PRODUCTION_COOKIE);
	store.delete(DEVELOPMENT_COOKIE);
}
