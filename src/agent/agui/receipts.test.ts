import { describe, expect, it, vi } from "vitest";
import { EventType, RunAgentInputSchema, type RunAgentInput } from "@ag-ui/core";
import { AgentClient, type AgentToolCall } from "@/agent/agui/client";
import { AgentTransport } from "@/agent/agui/transport";
import { collectFrontendState } from "@/agent/state/collector";

const encode = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);

describe("adapter receipt contract", () => {
	it("sends changed state only with success and acknowledges the server revision", async () => {
		let upstream!: ReadableStreamDefaultController<Uint8Array>;
		const bodies: RunAgentInput[] = [];
		const fetcher: typeof fetch = async (_url, init) => {
			const input = RunAgentInputSchema.parse(JSON.parse(String(init?.body)));
			bodies.push(input);
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encode({ type: EventType.RUN_STARTED, threadId: "t", runId: input.runId }));
						if (input.messages.length) {
							upstream = controller;
							controller.enqueue(encode({ type: EventType.STATE_SNAPSHOT, snapshot: input.state }));
						} else {
							const state = input.forwardedProps.toolResults[0].state;
							if (state) controller.enqueue(encode({ type: EventType.STATE_SNAPSHOT, snapshot: state }));
							controller.enqueue(encode({ type: EventType.RUN_FINISHED, threadId: "t", runId: input.runId }));
							controller.close();
						}
					},
				}),
				{ headers: { "Content-Type": "text/event-stream" } },
			);
		};
		const client = new AgentClient({
			threadId: "t",
			visitorId: "v",
			transport: new AgentTransport({ visitorId: "v", fetch: fetcher }),
		});
		const events = vi.fn();
		client.subscribe(events);
		const state = collectFrontendState({ pathname: "/en/us", chatOpen: true }, 1);
		client.setFrontendState(state);
		const run = client.run({ id: "m", role: "user", content: "cart" });
		await vi.waitFor(() =>
			expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: EventType.STATE_SNAPSHOT })),
		);
		const call: AgentToolCall = {
			threadId: "t",
			runId: bodies[0].runId,
			id: "c",
			name: "open_cart",
			arguments: "{}",
		};
		await client.submitToolResult(call, { success: true }, state);
		expect(bodies[1].forwardedProps.toolResults[0]).not.toHaveProperty("state");
		const changed = { ...state, cart: { ...state.cart, isOpen: true } };
		await client.submitToolResult({ ...call, id: "c2" }, { success: true }, changed);
		const receipt = bodies[2].forwardedProps.toolResults[0];
		expect(receipt.state.cart.is_open).toBe(true);
		expect(receipt.result).toMatchObject({
			call_id: "c2",
			status: "success",
			resulting_state_version: receipt.state.version,
		});
		await client.submitToolResult({ ...call, id: "c3" }, { success: false, error: "denied" }, state);
		const failed = bodies[3].forwardedProps.toolResults[0];
		expect(failed).not.toHaveProperty("state");
		expect(failed.result).toMatchObject({ status: "error", error: "execution_failed" });
		expect(failed.result).not.toHaveProperty("resulting_state_version");
		upstream.enqueue(encode({ type: EventType.RUN_FINISHED, threadId: "t", runId: call.runId }));
		upstream.close();
		await run;
		await expect(client.submitToolResult(call, { success: true })).rejects.toThrow("Stale");
		client.dispose();
	});
});
