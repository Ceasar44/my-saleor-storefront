import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { getAgentServerConfig, type AgentServerConfig } from "@/agent/config/server";
import type { PrepareAdapterRequest } from "@/agent/agui/server";
import type { TrustedAgentIdentity } from "@/agent/agui/server";

export function buildSignedClaims(
	identity: TrustedAgentIdentity,
	config: AgentServerConfig,
	now = Math.floor(Date.now() / 1000),
	jti: string = randomUUID(),
) {
	if (
		!/^visitor_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity.visitor_id) ||
		!["anonymous", "authenticated", "unavailable"].includes(identity.status) ||
		(identity.status === "authenticated" &&
			(!identity.saleor_user_id || !/^[A-Za-z0-9][A-Za-z0-9_.:/+=-]{0,254}$/.test(identity.saleor_user_id)))
	) {
		throw new Error("Invalid verified Agent identity");
	}
	return {
		iss: config.issuer,
		aud: config.audience,
		iat: now,
		exp: now + 60,
		jti,
		scope: config.scope,
		identity: {
			visitor_id: identity.visitor_id,
			status: identity.status,
			...(identity.status === "authenticated" ? { saleor_user_id: identity.saleor_user_id } : {}),
		},
	};
}

export function signAdapterRequest(
	body: string,
	claims: ReturnType<typeof buildSignedClaims>,
	config: AgentServerConfig,
) {
	const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
	const digest = createHash("sha256").update(body, "utf8").digest("hex");
	const input = ["v1", config.keyId, "POST", new URL(config.adapterUrl).pathname, digest, payload].join("\n");
	const signature = createHmac("sha256", config.signingKey).update(input, "utf8").digest("base64url");
	return `v1.${config.keyId}.${payload}.${signature}`;
}

/** Protocol v1 is specified in docs/nextjs-adapter-auth-plan.md; Adapter must implement its verifier. */
export const prepareAdapterRequest: PrepareAdapterRequest = async (input, identity) => {
	const config = getAgentServerConfig();
	const body = JSON.stringify(input);
	return {
		url: config.adapterUrl,
		body,
		headers: {
			"X-Storefront-Authorization": signAdapterRequest(body, buildSignedClaims(identity, config), config),
		},
	};
};
