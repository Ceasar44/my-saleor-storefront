"use client";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { EventType } from "@ag-ui/core";
import { createAgentClient, type AgentClient, type AgentToolCall } from "@/agent/agui/client";
import type { AgentEvent } from "@/agent/agui/events";
import { getVisitorId, setVisitorId } from "@/agent/identity/visitor";
import { initializeAgentSession } from "@/agent/identity/session-client";
import { getOrCreateThreadId, startNewThread } from "@/agent/conversation/thread";
import type { FrontendState } from "@/agent/state/types";
import { AgentActionBindings } from "@/agent/tools/bindings";
import { FrontendTargetRegistry } from "@/agent/tools/targets";

export type AgentChatMessage = {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	streaming?: boolean;
};
export type AgentToolStatus = {
	call: AgentToolCall;
	phase: "running" | "confirmation" | "success" | "error";
	summary?: string;
};
export type AgentContextValue = {
	client: AgentClient | null;
	threadId: string;
	visitorId: string;
	status: "initializing" | "idle" | "running" | "error";
	authStatus: "unknown" | "guest" | "authenticated" | "unavailable";
	messages: AgentChatMessage[];
	toolStatus: AgentToolStatus | null;
	error: string | null;
	notification: string;
	actions: AgentActionBindings;
	targets: FrontendTargetRegistry;
	sendMessage(text: string): Promise<void>;
	cancelRun(): void;
	startNewConversation(): void;
	setFrontendState(state: FrontendState): void;
	setToolCallHandler(handler: (call: AgentToolCall, signal: AbortSignal) => Promise<void>): () => void;
	setToolStatus(status: AgentToolStatus | null): void;
	requestConfirmation(call: AgentToolCall, signal: AbortSignal, summary?: string): Promise<boolean>;
	confirmToolCall(callId: string): void;
	rejectToolCall(callId: string): void;
};
export const AgentContext = createContext<AgentContextValue | null>(null);
export function useOptionalAgent() {
	return useContext(AgentContext);
}

export function AIProvider({ children }: { children: ReactNode }) {
	const [identity, setIdentity] = useState({ visitorId: "", threadId: "" });
	const [client, setClient] = useState<AgentClient | null>(null);
	const clientRef = useRef<AgentClient | null>(null);
	const [status, setStatus] = useState<AgentContextValue["status"]>("initializing");
	const [authStatus, setAuthStatus] = useState<AgentContextValue["authStatus"]>("unknown");
	const [messages, setMessages] = useState<AgentChatMessage[]>([]);
	const [toolStatus, setToolStatus] = useState<AgentToolStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notification, setNotification] = useState("");
	const [actions] = useState(() => new AgentActionBindings());
	const [targets] = useState(() => new FrontendTargetRegistry());
	const handler = useRef<((call: AgentToolCall, signal: AbortSignal) => Promise<void>) | null>(null);
	const run = useRef<AbortController | null>(null);
	const controllers = useRef(new Set<AbortController>());
	const state = useRef<FrontendState | null>(null);
	const pending = useRef<{ id: string; resolve(value: boolean): void } | null>(null);
	const epoch = useRef(0);
	const initializationEpoch = useRef(0);
	const invalidateInitialization = useCallback(() => {
		initializationEpoch.current++;
	}, []);
	const invalidate = useCallback(() => {
		epoch.current++;
		for (const controller of controllers.current) controller.abort();
		controllers.current.clear();
	}, []);
	const setFrontendState = useCallback((next: FrontendState) => {
		state.current = next;
		clientRef.current?.setFrontendState(next);
	}, []);
	const cancelRun = useCallback(() => {
		invalidate();
		run.current = null;
		clientRef.current?.cancelRun();
		pending.current?.resolve(false);
		pending.current = null;
		setMessages((old) => old.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
		setToolStatus(null);
		setStatus("idle");
	}, [invalidate]);
	const initializeIdentity = useCallback(
		async (forceReset = false) => {
			const generation = ++initializationEpoch.current;
			cancelRun();
			setIdentity({ visitorId: "", threadId: "" });
			setStatus("initializing");
			setError(null);
			if (forceReset) {
				setMessages([]);
				setNotification("");
				setAuthStatus("unknown");
			}
			try {
				const session = await initializeAgentSession();
				if (generation !== initializationEpoch.current) return;
				const reset = forceReset || session.resetThread || getVisitorId() !== session.visitorId;
				setVisitorId(session.visitorId);
				if (reset) {
					setMessages([]);
					setNotification("");
				}
				setAuthStatus(session.authStatus);
				setIdentity({
					visitorId: session.visitorId,
					threadId: reset ? startNewThread() : getOrCreateThreadId(),
				});
			} catch {
				if (generation === initializationEpoch.current) {
					setStatus("error");
					setError("unavailable");
				}
			}
		},
		[cancelRun],
	);
	const handleAgentEvent = useCallback(
		(
			event: AgentEvent,
			calls: Map<string, AgentToolCall>,
			currentIdentity: typeof identity,
			signal: AbortSignal,
		) => {
			if (signal.aborted) return;
			switch (event.type) {
				case EventType.RUN_STARTED:
					setStatus("running");
					break;
				case EventType.TEXT_MESSAGE_START:
					setMessages((old) =>
						old.some((m) => m.id === event.messageId)
							? old
							: [...old, { id: event.messageId, role: "assistant", content: "", streaming: true }],
					);
					break;
				case EventType.TEXT_MESSAGE_CONTENT:
					setMessages((old) =>
						old.map((m) => (m.id === event.messageId ? { ...m, content: m.content + event.delta } : m)),
					);
					break;
				case EventType.TEXT_MESSAGE_END:
					setMessages((old) => old.map((m) => (m.id === event.messageId ? { ...m, streaming: false } : m)));
					break;
				case EventType.TOOL_CALL_START:
					if (!calls.has(event.toolCallId))
						calls.set(event.toolCallId, {
							id: event.toolCallId,
							name: event.toolCallName,
							arguments: "",
							...currentIdentity,
							runId: activeRunId.current,
						});
					break;
				case EventType.TOOL_CALL_ARGS: {
					const call = calls.get(event.toolCallId);
					if (call && call.arguments.length < 65536) call.arguments += event.delta;
					break;
				}
				case EventType.TOOL_CALL_END: {
					const call = calls.get(event.toolCallId);
					if (call && handler.current)
						void handler.current(Object.freeze({ ...call }), signal).catch(() => {
							if (!signal.aborted) {
								setError("toolFailed");
								setToolStatus({ call, phase: "error" });
							}
						});
					break;
				}
				case EventType.RUN_ERROR:
					setError("unavailable");
					setStatus("error");
					break;
				case EventType.RUN_FINISHED:
					setStatus("idle");
					break;
			}
		},
		[],
	);
	const activeRunId = useRef("");
	useEffect(() => {
		void initializeIdentity();
		return invalidateInitialization;
	}, [initializeIdentity, invalidateInitialization]);
	useEffect(() => {
		if (!identity.threadId || !identity.visitorId) {
			setClient(null);
			return;
		}
		const next = createAgentClient({
			...identity,
			onAuthStatus: setAuthStatus,
			onIdentityReset: () => {
				void initializeIdentity(true);
			},
		});
		clientRef.current = next;
		if (state.current) next.setFrontendState(state.current);
		setClient(next);
		setStatus("idle");
		const calls = new Map<string, AgentToolCall>();
		const unsubscribe = next.subscribe((event) => {
			if (event.type === EventType.RUN_STARTED) {
				activeRunId.current = event.runId;
				calls.clear();
			}
			if (run.current) handleAgentEvent(event, calls, identity, run.current.signal);
		});
		return () => {
			invalidate();
			run.current = null;
			pending.current?.resolve(false);
			unsubscribe();
			next.dispose();
			clientRef.current = null;
		};
	}, [identity, handleAgentEvent, invalidate, initializeIdentity]);
	useEffect(() => actions.register("notify", setNotification), [actions]);
	useEffect(
		() => () => {
			actions.clear();
			targets.clear();
		},
		[actions, targets],
	);
	const sendMessage = useCallback(async (text: string) => {
		const value = text.trim();
		const current = clientRef.current;
		if (!current || run.current || !value || value.length > 32000) return;
		for (const previous of controllers.current) previous.abort();
		controllers.current.clear();
		const controller = new AbortController();
		run.current = controller;
		controllers.current.add(controller);
		const generation = ++epoch.current;
		const message = { id: crypto.randomUUID(), role: "user" as const, content: value };
		setMessages((old) => [...old, message]);
		setError(null);
		setStatus("running");
		try {
			await current.run(message);
		} catch {
			if (!controller.signal.aborted && generation === epoch.current) {
				setError("unavailable");
				setStatus("error");
			}
			controller.abort();
		} finally {
			if (generation === epoch.current) {
				run.current = null;
				pending.current?.resolve(false);
				setMessages((old) => old.map((m) => ({ ...m, streaming: false })));
				setStatus((old) => (old === "error" ? old : "idle"));
			}
		}
	}, []);
	const startNewConversation = useCallback(() => {
		if (!clientRef.current) {
			void initializeIdentity(true);
			return;
		}
		cancelRun();
		setMessages([]);
		setError(null);
		setNotification("");
		setIdentity((old) => ({ ...old, threadId: startNewThread() }));
	}, [cancelRun, initializeIdentity]);
	const setToolCallHandler = useCallback((next: NonNullable<typeof handler.current>) => {
		handler.current = next;
		return () => {
			if (handler.current === next) handler.current = null;
		};
	}, []);
	const requestConfirmation = useCallback(
		(call: AgentToolCall, signal: AbortSignal, summary?: string) =>
			new Promise<boolean>((resolve) => {
				pending.current?.resolve(false);
				const finish = (accepted: boolean) => {
					clearTimeout(timer);
					signal.removeEventListener("abort", abort);
					if (pending.current?.id === call.id) pending.current = null;
					resolve(accepted);
				};
				const abort = () => finish(false);
				const timer = setTimeout(abort, 30000);
				pending.current = { id: call.id, resolve: finish };
				signal.addEventListener("abort", abort, { once: true });
				setToolStatus({ call, phase: "confirmation", summary });
				if (signal.aborted) abort();
			}),
		[],
	);
	const confirmToolCall = useCallback((id: string) => {
		if (pending.current?.id === id) pending.current.resolve(true);
	}, []);
	const rejectToolCall = useCallback((id: string) => {
		if (pending.current?.id === id) pending.current.resolve(false);
	}, []);
	const value = useMemo(
		() => ({
			...identity,
			client,
			status,
			authStatus,
			messages,
			toolStatus,
			error,
			notification,
			actions,
			targets,
			sendMessage,
			cancelRun,
			startNewConversation,
			setFrontendState,
			setToolCallHandler,
			setToolStatus,
			requestConfirmation,
			confirmToolCall,
			rejectToolCall,
		}),
		[
			identity,
			client,
			status,
			authStatus,
			messages,
			toolStatus,
			error,
			notification,
			actions,
			targets,
			sendMessage,
			cancelRun,
			startNewConversation,
			setFrontendState,
			setToolCallHandler,
			requestConfirmation,
			confirmToolCall,
			rejectToolCall,
		],
	);
	return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}
