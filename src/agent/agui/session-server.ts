import "server-only";
import { agentConfig } from "@/agent/config/agent";
import { isSameOriginAgentRequest } from "@/agent/agui/server";
import { resolveAgentSessionUser } from "@/agent/identity/session-user";
import { resolveVerifiedVisitor } from "@/agent/identity/visitor-cookie";

export function createAgentSessionPost(
	dependencies: {
		enabled?: () => boolean;
		resolveSession?: typeof resolveAgentSessionUser;
		resolveVisitor?: typeof resolveVerifiedVisitor;
	} = {},
) {
	return async function POST(request: Request) {
		const json = (body: object, status = 200) =>
			Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
		if (!(dependencies.enabled?.() ?? agentConfig.enabled)) return json({ error: "agent_disabled" }, 404);
		if (!isSameOriginAgentRequest(request)) return json({ error: "invalid_origin" }, 403);
		try {
			const session = await (dependencies.resolveSession ?? resolveAgentSessionUser)();
			const visitor = await (dependencies.resolveVisitor ?? resolveVerifiedVisitor)(session);
			return json({ ...visitor, authStatus: session.status });
		} catch {
			return json({ error: "agent_unavailable" }, 503);
		}
	};
}
