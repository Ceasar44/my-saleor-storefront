import { createBrowserIdStorage } from "@/agent/identity/browser-storage";

export const VISITOR_ID_KEY = "paper.agent.visitor.v1";
const storage = createBrowserIdStorage(VISITOR_ID_KEY, "visitor");

export function createVisitorId(): string {
	return `visitor_${crypto.randomUUID()}`;
}

export function getVisitorId(): string | null {
	return storage.read();
}

export function setVisitorId(visitorId: string): void {
	storage.write(visitorId);
}

export function getOrCreateVisitorId(): string {
	const existing = getVisitorId();
	if (existing) return existing;
	const visitorId = createVisitorId();
	setVisitorId(visitorId);
	return visitorId;
}

export function clearVisitorId(): void {
	storage.write(null);
}
