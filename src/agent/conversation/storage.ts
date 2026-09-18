import { createBrowserIdStorage } from "@/agent/identity/browser-storage";

export const AGENT_THREAD_KEY = "paper.agent.thread.v1";
const storage = createBrowserIdStorage(AGENT_THREAD_KEY, "thread");

export function loadThreadId(): string | null {
	return storage.read();
}

export function saveThreadId(threadId: string): void {
	storage.write(threadId);
}

export function clearThreadId(): void {
	storage.write(null);
}
