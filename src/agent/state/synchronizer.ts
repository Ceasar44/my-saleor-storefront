import { normalizeFrontendState } from "@/agent/state/collector";
import type { FrontendState } from "@/agent/state/types";

export const STATE_SECTIONS = ["route", "store", "product", "cart", "checkout", "user", "ui"] as const;
export type StateSection = (typeof STATE_SECTIONS)[number];

/** Local section replacement instructions, not an AG-UI event or adapter wire format. */
export type StateSyncPayload =
	| { type: "snapshot"; state: FrontendState }
	| { type: "delta"; patch: Partial<Omit<FrontendState, "version">>; version: number };

/** Structural comparison ignores property insertion order and absent optional leaves. */
export function equalStateValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left).filter((key) => left[key] !== undefined);
	const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined);
	return (
		keys.length === otherKeys.length &&
		keys.every((key) => Object.hasOwn(right, key) && equalStateValue(left[key], right[key]))
	);
}

export function buildStateDelta(previous: FrontendState | null, current: FrontendState): StateSyncPayload {
	const next = normalizeFrontendState(current);
	if (next.version < 1) throw new Error("State snapshots must have a positive version.");
	if (!previous) return { type: "snapshot", state: next };
	if (next.version !== previous.version + 1) throw new Error("State deltas must advance by one revision.");
	const before = normalizeFrontendState(previous);
	const patch: Partial<Omit<FrontendState, "version">> = {};
	for (const key of STATE_SECTIONS) {
		if (!equalStateValue(before[key], next[key])) Object.assign(patch, { [key]: next[key] });
	}
	return { type: "delta", patch, version: next.version };
}

/**
 * Tracks locally emitted state, not remote delivery acknowledgement. The eventual
 * runtime must serialize delivery and reset from the server revision on failure/reconnect.
 */
export class FrontendStateSynchronizer {
	private previous: FrontendState | null = null;
	private revision = 0;

	constructor(baseVersion = 0) {
		this.reset(baseVersion);
	}

	update(state: FrontendState): StateSyncPayload | null {
		const current = normalizeFrontendState(state, this.revision);
		if (this.previous && STATE_SECTIONS.every((key) => equalStateValue(this.previous![key], current[key])))
			return null;
		if (this.revision === Number.MAX_SAFE_INTEGER) throw new Error("Frontend state version exhausted.");
		current.version = this.revision + 1;
		const payload = buildStateDelta(this.previous, current);
		// Keep private copies: callers may mutate both their input and returned payloads.
		this.previous = current;
		this.revision = current.version;
		return payload;
	}

	reset(baseVersion = 0): void {
		if (!Number.isSafeInteger(baseVersion) || baseVersion < 0)
			throw new Error("Invalid frontend state base version.");
		this.previous = null;
		this.revision = baseVersion;
	}
}
