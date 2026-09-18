// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EventType } from "@ag-ui/core";
import type { AgentEvent } from "@/agent/agui/events";
const runtime = vi.hoisted(() => ({
	listener: null as ((event: AgentEvent) => void) | null,
	resolve: null as (() => void) | null,
	dispose: vi.fn(),
	cancel: vi.fn(),
	run: vi.fn(),
	initialize: vi.fn(),
	reset: null as (() => void) | null,
}));
vi.mock("@/agent/identity/session-client", () => ({ initializeAgentSession: runtime.initialize }));
vi.mock("next/navigation", () => ({
	usePathname: () => "/en/us/products/shirt",
	useParams: () => ({ locale: "en", channel: "us" }),
}));
vi.mock("@/agent/agui/client", () => ({
	createAgentClient: (options: { onIdentityReset: () => void }) => {
		runtime.reset = options.onIdentityReset;
		return {
			subscribe: (listener: (event: AgentEvent) => void) => {
				runtime.listener = listener;
				return () => {
					runtime.listener = null;
				};
			},
			setFrontendState: vi.fn(),
			setFrontendTools: vi.fn(),
			dispose: runtime.dispose,
			cancelRun: () => {
				runtime.cancel();
				runtime.resolve?.();
			},
			run: (message: unknown) => {
				runtime.run(message);
				return new Promise<void>((resolve) => {
					runtime.resolve = resolve;
					runtime.listener?.({ type: EventType.RUN_STARTED, threadId: "thread", runId: "run" });
				});
			},
		};
	},
}));
import messages from "@/../messages/en.json";
import { AIProvider } from "@/agent/components/AIProvider";
import { AgentStateProvider } from "@/agent/state/provider";
import { CartProvider } from "@/ui/components/cart/cart-context";
import { CatalogIdentityProvider } from "@/lib/catalog/catalog-identity-bridge";
import { AIButton } from "@/agent/components/AIButton";
import { AIPanel } from "@/agent/components/AIPanel";
import { AIMessage } from "@/agent/components/AIMessage";

function renderChat() {
	return render(
		<NextIntlClientProvider locale="en" messages={messages}>
			<CartProvider>
				<CatalogIdentityProvider>
					<AIProvider>
						<AgentStateProvider>
							<AIButton />
							<AIPanel />
						</AgentStateProvider>
					</AIProvider>
				</CatalogIdentityProvider>
			</CartProvider>
		</NextIntlClientProvider>,
	);
}
afterEach(cleanup);
beforeEach(() => {
	runtime.initialize.mockReset().mockResolvedValue({
		visitorId: "visitor_550e8400-e29b-41d4-a716-446655440000",
		resetThread: false,
		authStatus: "guest",
	});
	runtime.run.mockClear();
	runtime.cancel.mockClear();
	runtime.dispose.mockClear();
});
describe("chat integration", () => {
	it("waits for server initialization and recovers without replaying a message", async () => {
		let ready!: (value: object) => void;
		runtime.initialize.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					ready = resolve;
				}),
		);
		renderChat();
		fireEvent.click(screen.getByRole("button", { name: "Shopping assistant" }));
		expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
		ready({
			visitorId: "visitor_550e8400-e29b-41d4-a716-446655440000",
			resetThread: false,
			authStatus: "guest",
		});
		await waitFor(() => expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false));
		const oldThread = localStorage.getItem("paper.agent.thread.v1");
		runtime.initialize.mockResolvedValueOnce({
			visitorId: "visitor_650e8400-e29b-41d4-a716-446655440000",
			resetThread: false,
			authStatus: "authenticated",
		});
		runtime.reset?.();
		await waitFor(() => expect(localStorage.getItem("paper.agent.visitor.v1")).toContain("650e8400"));
		expect(localStorage.getItem("paper.agent.thread.v1")).not.toBe(oldThread);
		expect(runtime.run).not.toHaveBeenCalled();
	});
	it("shows unavailable initialization and retries through new conversation", async () => {
		runtime.initialize.mockRejectedValueOnce(new Error("offline"));
		renderChat();
		fireEvent.click(screen.getByRole("button", { name: "Shopping assistant" }));
		await screen.findByRole("alert");
		expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
		await waitFor(() => expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false));
	});
	it("opens, sends, renders streamed text, cancels and closes", async () => {
		renderChat();
		fireEvent.click(screen.getByRole("button", { name: "Shopping assistant" }));
		const input = screen.getByRole("textbox");
		await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
		fireEvent.change(input, { target: { value: "Hello" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());
		runtime.listener?.({ type: EventType.TEXT_MESSAGE_START, messageId: "a1", role: "assistant" });
		runtime.listener?.({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "a1", delta: "A useful answer" });
		await screen.findByText("A useful answer");
		fireEvent.click(screen.getByRole("button", { name: "Stop" }));
		expect(runtime.cancel).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
	it("does not submit blank text, Shift+Enter or composing Enter", async () => {
		renderChat();
		fireEvent.click(screen.getByRole("button", { name: "Shopping assistant" }));
		const input = screen.getByRole("textbox");
		await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
		fireEvent.keyDown(input, { key: "Enter" });
		fireEvent.change(input, { target: { value: "正在输入" } });
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		fireEvent.keyDown(input, { key: "Enter", isComposing: true });
		expect(runtime.run).not.toHaveBeenCalled();
	});
	it("new conversation keeps visitor and unmount disposes the client", async () => {
		const view = renderChat();
		fireEvent.click(screen.getByRole("button", { name: "Shopping assistant" }));
		await waitFor(() => expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(false));
		const before = Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
		fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
		await waitFor(() => expect(runtime.dispose).toHaveBeenCalled());
		const visitorKey = Object.keys(before).find((k) => k.includes("visitor"))!;
		expect(localStorage.getItem(visitorKey)).toBe(before[visitorKey]);
		view.unmount();
		expect(runtime.dispose).toHaveBeenCalled();
	});
	it("does not render model HTML or dangerous links", () => {
		const view = render(
			<AIMessage
				message={{
					id: "a",
					role: "assistant",
					content: "<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
				}}
			/>,
		);
		expect(view.container.querySelector("script")).toBeNull();
		expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
	});
});
