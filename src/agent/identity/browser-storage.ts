/** Browser hints only: these IDs must never authorize access on the server. */
export function createBrowserIdStorage(key: string, prefix: "visitor" | "thread") {
	const pattern = new RegExp(
		`^${prefix}_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
		"i",
	);
	let memory: string | null = null;
	let memoryOnly = false;

	function assertBrowser() {
		if (typeof window === "undefined") {
			throw new Error("Agent browser IDs must be initialized after client mount.");
		}
	}

	function read(): string | null {
		// Never return a process-wide fallback to server requests.
		if (typeof window === "undefined") return null;
		if (memoryOnly) return memory;
		try {
			const value = window.localStorage.getItem(key);
			memory = value && pattern.test(value) ? value : null;
		} catch {
			memoryOnly = true;
		}
		return memory;
	}

	function write(value: string | null): void {
		assertBrowser();
		if (value !== null && !pattern.test(value)) {
			throw new Error(`Invalid agent ${prefix} ID.`);
		}
		memory = value;
		if (memoryOnly) return;
		try {
			if (value === null) window.localStorage.removeItem(key);
			else window.localStorage.setItem(key, value);
		} catch {
			// Once storage fails, stay in memory so stale persisted IDs cannot reappear.
			// Persistence across reloads is unavailable in this mode.
			memoryOnly = true;
		}
	}

	return { read, write };
}
