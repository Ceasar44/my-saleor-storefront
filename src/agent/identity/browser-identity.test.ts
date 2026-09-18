import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function modules() {
	return {
		visitor: await import("@/agent/identity/visitor"),
		thread: await import("@/agent/conversation/thread"),
		storage: await import("@/agent/conversation/storage"),
	};
}

describe("agent browser identity lifecycle", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.stubGlobal("window", { localStorage: globalThis.localStorage });
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("restores independent visitor and thread IDs after a page reload", async () => {
		const first = await modules();
		const visitorId = first.visitor.getOrCreateVisitorId();
		const threadId = first.thread.getOrCreateThreadId();
		vi.resetModules();
		const reloaded = await modules();
		expect(reloaded.visitor.getOrCreateVisitorId()).toBe(visitorId);
		expect(reloaded.thread.getOrCreateThreadId()).toBe(threadId);
		expect(visitorId).toMatch(/^visitor_/);
		expect(threadId).toMatch(/^thread_/);
	});

	it("starts a new conversation without replacing the visitor", async () => {
		const { visitor, thread, storage } = await modules();
		const visitorId = visitor.getOrCreateVisitorId();
		const previous = thread.getOrCreateThreadId();
		const next = thread.startNewThread();
		expect(next).not.toBe(previous);
		expect(storage.loadThreadId()).toBe(next);
		expect(visitor.getVisitorId()).toBe(visitorId);
	});

	it("can explicitly clear both browser hints for a later identity boundary", async () => {
		const { visitor, thread, storage } = await modules();
		const visitorId = visitor.getOrCreateVisitorId();
		const threadId = thread.getOrCreateThreadId();
		visitor.clearVisitorId();
		storage.clearThreadId();
		expect(visitor.getVisitorId()).toBeNull();
		expect(storage.loadThreadId()).toBeNull();
		expect(visitor.getOrCreateVisitorId()).not.toBe(visitorId);
		expect(thread.getOrCreateThreadId()).not.toBe(threadId);
	});

	it("replaces corrupt persisted IDs and rejects invalid writes", async () => {
		const { visitor, thread, storage } = await modules();
		localStorage.setItem(visitor.VISITOR_ID_KEY, "User:123");
		localStorage.setItem(storage.AGENT_THREAD_KEY, " ");
		expect(visitor.getOrCreateVisitorId()).toMatch(/^visitor_/);
		expect(thread.getOrCreateThreadId()).toMatch(/^thread_/);
		expect(() => visitor.setVisitorId("User:123")).toThrow("Invalid agent visitor ID");
		expect(() => storage.saveThreadId("invalid")).toThrow("Invalid agent thread ID");
	});

	it("keeps stable in-memory IDs when localStorage access is blocked", async () => {
		vi.stubGlobal("window", {
			get localStorage() {
				throw new DOMException("Blocked", "SecurityError");
			},
		});
		const { visitor, thread } = await modules();
		const visitorId = visitor.getOrCreateVisitorId();
		const threadId = thread.getOrCreateThreadId();
		expect(visitor.getOrCreateVisitorId()).toBe(visitorId);
		expect(thread.getOrCreateThreadId()).toBe(threadId);
		expect(thread.startNewThread()).not.toBe(threadId);
		expect(visitor.getVisitorId()).toBe(visitorId);
	});

	it("does not resurrect an old conversation after a quota failure", async () => {
		const { thread, storage } = await modules();
		const previous = thread.getOrCreateThreadId();
		vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
			throw new DOMException("Full", "QuotaExceededError");
		});
		const next = thread.startNewThread();
		expect(next).not.toBe(previous);
		expect(thread.getOrCreateThreadId()).toBe(next);
		storage.clearThreadId();
		expect(storage.loadThreadId()).toBeNull();
	});

	it("observes another tab's persisted thread changes", async () => {
		const { thread, storage } = await modules();
		thread.getOrCreateThreadId();
		const otherThread = thread.createThreadId();
		localStorage.setItem(storage.AGENT_THREAD_KEY, otherThread);
		expect(thread.getOrCreateThreadId()).toBe(otherThread);
		localStorage.removeItem(storage.AGENT_THREAD_KEY);
		expect(storage.loadThreadId()).toBeNull();
	});

	it("does not read storage or retain request identity during SSR", async () => {
		vi.stubGlobal("window", undefined);
		const { visitor, thread, storage } = await modules();
		expect(visitor.getVisitorId()).toBeNull();
		expect(storage.loadThreadId()).toBeNull();
		expect(() => visitor.getOrCreateVisitorId()).toThrow("after client mount");
		expect(() => thread.getOrCreateThreadId()).toThrow("after client mount");
	});
});
