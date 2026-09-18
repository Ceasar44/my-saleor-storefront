import "server-only";

export type AgentServerConfig = {
	adapterUrl: string;
	issuer: string;
	audience: string;
	keyId: string;
	signingKey: Buffer;
	visitorKey: Buffer;
	scope: { tenant_id: string; store_id: string };
	secureCookies: boolean;
};

export function getAgentServerConfig(
	env: Readonly<Record<string, string | undefined>> = process.env,
): AgentServerConfig {
	const required = (name: string) => {
		const value = env[name];
		if (!value || value.length > 2048 || /[\r\n]/.test(value)) throw new Error(`Invalid ${name}`);
		return value;
	};
	const identifier = (name: string) => {
		const value = required(name);
		if (!/^[A-Za-z0-9][A-Za-z0-9_.:/+=-]{0,254}$/.test(value)) throw new Error(`Invalid ${name}`);
		return value;
	};
	const secret = (name: string) => {
		const value = required(name);
		const bytes = Buffer.from(value, "base64");
		if (bytes.length < 32 || bytes.length > 128 || bytes.toString("base64") !== value)
			throw new Error(`Invalid ${name}`);
		return bytes;
	};
	const url = new URL(required("AGENT_ADAPTER_URL"));
	const secureCookies = env.NODE_ENV === "production";
	const localHttp =
		!secureCookies && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(!localHttp && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!["/api/agent", "/agui"].includes(url.pathname)
	)
		throw new Error("Invalid AGENT_ADAPTER_URL");
	const keyId = required("AGENT_BFF_KEY_ID");
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) throw new Error("Invalid AGENT_BFF_KEY_ID");
	const signingKey = secret("AGENT_BFF_SIGNING_SECRET");
	const visitorKey = secret("AGENT_VISITOR_COOKIE_SECRET");
	if (signingKey.equals(visitorKey)) throw new Error("Agent signing and visitor keys must differ");
	return {
		adapterUrl: url.href,
		issuer: identifier("AGENT_BFF_ISSUER"),
		audience: identifier("AGENT_BFF_AUDIENCE"),
		keyId,
		signingKey,
		visitorKey,
		secureCookies,
		scope: { tenant_id: identifier("AGENT_TENANT_ID"), store_id: identifier("AGENT_STORE_ID") },
	};
}
