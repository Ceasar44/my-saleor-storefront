import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.resolve("vitest"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const root = fileURLToPath(new URL("./", import.meta.url));
const waiting = new Map();
const server = await createServer({
	root,
	resolve: {
		alias: {
			"next/navigation": `${root}navigation.ts`,
			"@": fileURLToPath(new URL("../../src", import.meta.url)),
		},
	},
	esbuild: { jsx: "automatic" },
	define: {
		"process.env": "{}",
		"process.env.NEXT_PUBLIC_AI_ASSISTANT_ENABLED": '"true"',
		"process.env.NEXT_PUBLIC_STOREFRONT_LOCALES": '"en"',
		"process.env.NEXT_PUBLIC_DEFAULT_CHANNEL": '"us"',
	},
	server: {
		host: "127.0.0.1",
		port: 3021,
		strictPort: true,
		fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] },
	},
	plugins: [
		{
			name: "simulated-agent-stream",
			configureServer(vite) {
				// Simulated initialization only; production signed Cookies are tested separately.
				vite.middlewares.use("/api/agent/session", (request, response) => {
					const previous = request.headers.cookie?.match(
						/(?:^|;\s*)agent-fixture=(visitor_[0-9a-f-]{36})(?:;|$)/,
					)?.[1];
					const visitorId = previous ?? `visitor_${randomUUID()}`;
					response.writeHead(200, {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
						"Set-Cookie": `agent-fixture=${visitorId}; HttpOnly; SameSite=Lax; Path=/`,
					});
					response.end(JSON.stringify({ visitorId, resetThread: !previous, authStatus: "guest" }));
				});
				vite.middlewares.use("/api/agent", (request, response) => {
					let body = "";
					request.on("data", (chunk) => {
						body += chunk;
					});
					request.on("end", () => {
						const input = JSON.parse(body);
						response.writeHead(200, { "Content-Type": "text/event-stream", "X-Agent-Auth-Status": "guest" });
						const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
						const finish = () => {
							send({ type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId });
							response.end();
						};
						send({ type: "RUN_STARTED", threadId: input.threadId, runId: input.runId });
						if (!input.messages.length) {
							const receipt = input.forwardedProps.toolResults[0];
							if (receipt.state) send({ type: "STATE_SNAPSHOT", snapshot: receipt.state });
							finish();
							waiting.get(input.runId)?.();
							waiting.delete(input.runId);
							return;
						}
						send({ type: "STATE_SNAPSHOT", snapshot: input.state });
						if (input.messages[0].content === "open cart") {
							waiting.set(input.runId, finish);
							send({ type: "TOOL_CALL_START", toolCallId: "cart", toolCallName: "open_cart" });
							send({ type: "TOOL_CALL_ARGS", toolCallId: "cart", delta: "{}" });
							send({ type: "TOOL_CALL_END", toolCallId: "cart" });
							response.on("close", () => waiting.delete(input.runId));
							return;
						}
						send({ type: "TEXT_MESSAGE_START", messageId: input.runId, role: "assistant" });
						send({ type: "TEXT_MESSAGE_CONTENT", messageId: input.runId, delta: "Hello" });
						const timer = setTimeout(() => {
							send({ type: "TEXT_MESSAGE_CONTENT", messageId: input.runId, delta: " from the assistant" });
							send({ type: "TEXT_MESSAGE_END", messageId: input.runId });
							finish();
						}, 700);
						response.on("close", () => clearTimeout(timer));
					});
				});
			},
		},
	],
});
await server.listen();
