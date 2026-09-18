import "server-only";

import { getHeaderAuthState } from "@/lib/auth/get-header-user";

export type AgentSessionUser =
	| { status: "guest" }
	| { status: "authenticated"; user: { id: string } }
	| { status: "unavailable" };

/** Reuse the BFF resolver's retry/auth classification; expose only the required ID. */
export async function resolveAgentSessionUser(): Promise<AgentSessionUser> {
	const identity = await getHeaderAuthState();
	if (identity.status === "authenticated") {
		return { status: "authenticated", user: { id: identity.user.id } };
	}
	return { status: identity.status };
}
