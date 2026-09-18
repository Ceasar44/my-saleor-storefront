import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import { AgentClient } from "@/agent/agui/client";
import { AgentTransport } from "@/agent/agui/transport";
const encode = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
describe("official AG-UI client transport", () => {
	it("delivers incremental events and preserves the run IDs", async () => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		let runId = "";
		const fetcher = vi.fn(async (_url, init) => {
			const input = JSON.parse(String(init?.body)) as { runId: string };
			runId = input.runId;
			return new Response(
				new ReadableStream<Uint8Array>({
					start(c) {
						controller = c;
						c.enqueue(encode({ type: EventType.RUN_STARTED, threadId: "t", runId }));
					},
				}),
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		});
		const client = new AgentClient({
			threadId: "t",
			visitorId: "v",
			transport: new AgentTransport({ visitorId: "v", fetch: fetcher }),
		});
		const listener = vi.fn();
		client.subscribe(listener);
		const running = client.run({ id: "m", role: "user", content: "Hi" });
		await vi.waitFor(() => expect(listener).toHaveBeenCalled());
		controller.enqueue(
			encode({ type: EventType.TEXT_MESSAGE_START, messageId: "answer", role: "assistant" }),
		);
		controller.enqueue(encode({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "answer", delta: "Hello" }));
		await vi.waitFor(() =>
			expect(listener).toHaveBeenCalledWith(expect.objectContaining({ delta: "Hello" })),
		);
		controller.enqueue(encode({ type: EventType.TEXT_MESSAGE_END, messageId: "answer" }));
		controller.enqueue(encode({ type: EventType.RUN_FINISHED, threadId: "t", runId }));
		controller.close();
		await running;
		expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
			visitorId: "v",
			messages: [{ id: "m" }],
		});
		client.dispose();
	});
	it("rejects an interrupted stream instead of treating EOF as success", async () => {
		const client = new AgentClient({
			threadId: "t",
			visitorId: "v",
			transport: new AgentTransport({
				visitorId: "v",
				fetch: async () => new Response("", { headers: { "Content-Type": "text/event-stream" } }),
			}),
		});
		await expect(client.run({ id: "m", role: "user", content: "Hi" })).rejects.toThrow("completion");
		client.dispose();
	});
	it("cancels a pending request", async () => {
		const fetcher: typeof fetch = async (_url, init) =>
			new Promise((_resolve, reject) =>
				init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
			);
		const client = new AgentClient({
			threadId: "t",
			visitorId: "v",
			transport: new AgentTransport({ visitorId: "v", fetch: fetcher }),
		});
		const result = client.run({ id: "m", role: "user", content: "Hi" });
		client.cancelRun();
		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	});
	it("rejects foreign origins in transport configuration", async () => {
		const transport = new AgentTransport({ visitorId: "v", endpoint: "https://external/api" });
		await expect(
			transport.run({
				threadId: "t",
				runId: "r",
				messages: [],
				state: {},
				context: [],
				tools: [],
				forwardedProps: {},
			}),
		).rejects.toThrow("same-origin");
	});
});
