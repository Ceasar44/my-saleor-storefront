import "server-only";
import { RunAgentInputSchema, type RunAgentInput } from "@ag-ui/core";
import { resolveAgentSessionUser, type AgentSessionUser } from "@/agent/identity/session-user";
import { agentConfig } from "@/agent/config/agent";
import { resolveVerifiedVisitor } from "@/agent/identity/visitor-cookie";

export function isSameOriginAgentRequest(request: Request) {
	return (
		request.headers.get("origin") === new URL(request.url).origin &&
		request.headers.get("sec-fetch-site") !== "cross-site"
	);
}

export type TrustedAgentIdentity = {
	visitor_id: string;
	status: "anonymous" | "authenticated" | "unavailable";
	saleor_user_id?: string;
};

export function buildTrustedIdentity(visitorId: string, session: AgentSessionUser): TrustedAgentIdentity {
	return session.status === "authenticated"
		? { visitor_id: visitorId, status: "authenticated", saleor_user_id: session.user.id }
		: { visitor_id: visitorId, status: session.status === "guest" ? "anonymous" : "unavailable" };
}

/** Supplied by the deployment's verified BFF boundary, never by request JSON. */
export type PrepareAdapterRequest = (
	input: RunAgentInput,
	identity: TrustedAgentIdentity,
	request: Request,
) => Promise<{ url: string; headers: HeadersInit; body: string }>;

class RequestError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}

export async function readAgentRequest(request: Request) {
	if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
		throw new RequestError(415, "invalid_content_type");
	const reader = request.body?.getReader();
	if (!reader) throw new RequestError(400, "invalid_request");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 1_048_576) {
				await reader.cancel();
				throw new RequestError(413, "request_too_large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Record<string, unknown>;
	} catch {
		throw new RequestError(400, "invalid_request");
	}
	if (!raw || Array.isArray(raw) || typeof raw !== "object") throw new RequestError(400, "invalid_request");
	if (typeof raw.visitorId !== "string" || !/^visitor_[0-9a-f-]{36}$/i.test(raw.visitorId))
		throw new RequestError(400, "invalid_visitor");
	// Select protocol fields. Never forward top-level browser identity claims or headers.
	const parsed = RunAgentInputSchema.safeParse({
		threadId: raw.threadId,
		runId: raw.runId,
		messages: raw.messages,
		state: raw.state,
		tools: raw.tools,
		context: [],
		forwardedProps: raw.forwardedProps ?? {},
	});
	if (!parsed.success) throw new RequestError(400, "invalid_agent_input");
	const input = parsed.data;
	if (
		!input.threadId ||
		input.threadId.length > 255 ||
		!input.runId ||
		input.runId.length > 255 ||
		input.messages.length > 1000 ||
		input.messages.some(
			(m) =>
				m.role !== "user" || typeof m.content !== "string" || !m.content.trim() || m.content.length > 32000,
		)
	)
		throw new RequestError(400, "invalid_agent_input");
	const forwarded = input.forwardedProps as Record<string, unknown>;
	if (
		!forwarded ||
		Array.isArray(forwarded) ||
		typeof forwarded !== "object" ||
		Object.keys(forwarded).some((k) => k !== "toolResults")
	)
		throw new RequestError(400, "invalid_agent_input");
	if (
		forwarded.toolResults !== undefined &&
		(!Array.isArray(forwarded.toolResults) ||
			forwarded.toolResults.length > 20 ||
			input.messages.length > 0 ||
			(input.state && Object.keys(input.state).length > 0))
	)
		throw new RequestError(400, "invalid_agent_input");
	return { input, visitorId: raw.visitorId };
}

export function createAgentPost(dependencies: {
	prepare: PrepareAdapterRequest;
	resolveSession?: typeof resolveAgentSessionUser;
	resolveVisitor?: typeof resolveVerifiedVisitor;
	fetch?: typeof fetch;
	enabled?: () => boolean;
	timeoutMs?: number;
}) {
	return async function POST(request: Request): Promise<Response> {
		const error = (status: number, code: string) =>
			Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
		if (!(dependencies.enabled?.() ?? agentConfig.enabled)) return error(404, "agent_disabled");
		if (!isSameOriginAgentRequest(request)) return error(403, "invalid_origin");
		const controller = new AbortController();
		const abort = () => controller.abort();
		request.signal.addEventListener("abort", abort, { once: true });
		if (request.signal.aborted) abort();
		const timer = setTimeout(abort, dependencies.timeoutMs ?? agentConfig.requestTimeoutMs);
		const cleanup = () => {
			clearTimeout(timer);
			request.signal.removeEventListener("abort", abort);
		};
		try {
			const { input, visitorId } = await readAgentRequest(request);
			const session = await (dependencies.resolveSession ?? resolveAgentSessionUser)();
			const visitor = await (dependencies.resolveVisitor ?? resolveVerifiedVisitor)(session);
			if (visitor.resetThread || visitor.visitorId !== visitorId) {
				cleanup();
				return error(409, "agent_identity_reset");
			}
			const upstreamRequest = await dependencies.prepare(
				input,
				buildTrustedIdentity(visitor.visitorId, session),
				request,
			);
			const url = new URL(upstreamRequest.url);
			if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
				throw new Error("Invalid adapter URL");
			const headers = new Headers(upstreamRequest.headers);
			headers.set("Content-Type", "application/json");
			headers.set("Accept", "text/event-stream");
			const upstream = await (dependencies.fetch ?? fetch)(url, {
				method: "POST",
				headers,
				body: upstreamRequest.body,
				signal: controller.signal,
				cache: "no-store",
				redirect: "error",
			});
			if (
				!upstream.ok ||
				!upstream.body ||
				!upstream.headers.get("content-type")?.startsWith("text/event-stream")
			) {
				await upstream.body?.cancel();
				cleanup();
				return error(upstream.status === 401 || upstream.status === 403 ? 503 : 502, "agent_unavailable");
			}
			const reader = upstream.body.getReader();
			const body = new ReadableStream<Uint8Array>({
				async pull(output) {
					try {
						const next = await reader.read();
						if (next.done) {
							cleanup();
							output.close();
						} else output.enqueue(next.value);
					} catch {
						cleanup();
						output.error(new Error("Agent stream interrupted"));
					}
				},
				async cancel() {
					abort();
					cleanup();
					await reader.cancel();
				},
			});
			return new Response(body, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-store, no-transform",
					"X-Accel-Buffering": "no",
					"X-Agent-Auth-Status": session.status,
				},
			});
		} catch (cause) {
			cleanup();
			if (cause instanceof RequestError) return error(cause.status, cause.code);
			if (controller.signal.aborted) return error(504, "agent_timeout");
			return error(503, "agent_unavailable");
		}
	};
}
