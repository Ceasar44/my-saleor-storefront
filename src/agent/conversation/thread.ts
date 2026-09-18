import { loadThreadId, saveThreadId } from "@/agent/conversation/storage";

export function createThreadId(): string {
	return `thread_${crypto.randomUUID()}`;
}

export function getOrCreateThreadId(): string {
	return loadThreadId() ?? startNewThread();
}

/** Starting a conversation deliberately leaves the visitor unchanged. */
export function startNewThread(): string {
	const threadId = createThreadId();
	saveThreadId(threadId);
	return threadId;
}
