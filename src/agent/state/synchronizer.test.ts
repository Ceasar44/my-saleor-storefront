import { describe, expect, it } from "vitest";
import { collectFrontendState } from "@/agent/state/collector";
import { buildStateDelta, FrontendStateSynchronizer } from "@/agent/state/synchronizer";

function sample(version = 0) {
	return collectFrontendState(
		{
			pathname: "/en/us/products/coat",
			chatOpen: false,
			product: { id: "P1", slug: "coat", selectedAttributes: { color: "black", size: "L" } },
		},
		version,
	);
}

describe("frontend state synchronization", () => {
	it("emits an initial snapshot, then only changed sections with consecutive revisions", () => {
		const sync = new FrontendStateSynchronizer();
		expect(sync.update(sample())).toEqual({ type: "snapshot", state: sample(1) });
		expect(sync.update(sample(100))).toBeNull();
		const current = sample();
		current.ui.chatOpen = true;
		expect(sync.update(current)).toEqual({ type: "delta", patch: { ui: { chatOpen: true } }, version: 2 });
		expect(sync.update(current)).toBeNull();
		current.ui.chatOpen = false;
		expect(sync.update(current)?.type).toBe("delta");
	});

	it("ignores reordered attribute maps", () => {
		const sync = new FrontendStateSynchronizer();
		sync.update(sample());
		const state = sample();
		state.product!.selectedAttributes = { size: "L", color: "black" };
		expect(sync.update(state)).toBeNull();
	});

	it("explicitly clears a departed product", () => {
		const before = sample(1);
		const next = collectFrontendState({ pathname: "/en/us/cart", chatOpen: false }, 2);
		expect(buildStateDelta(before, next)).toMatchObject({
			type: "delta",
			patch: { product: null },
			version: 2,
		});
	});

	it("isolates caller and output mutations from its baseline", () => {
		const sync = new FrontendStateSynchronizer();
		const original = sample();
		const first = sync.update(original);
		original.product!.selectedAttributes!.color = "red";
		if (first?.type === "snapshot") first.state.product!.selectedAttributes!.color = "blue";
		expect(sync.update(sample())).toBeNull();
		const delta = sync.update(original);
		if (delta?.type === "delta") delta.patch.product!.selectedAttributes!.color = "green";
		expect(sync.update(original)).toBeNull();
	});

	it("resets to a new thread or an authoritative server revision", () => {
		const sync = new FrontendStateSynchronizer(7);
		expect(sync.update(sample())).toMatchObject({ type: "snapshot", state: { version: 8 } });
		sync.reset(12);
		expect(sync.update(sample())).toMatchObject({ type: "snapshot", state: { version: 13 } });
		sync.reset();
		expect(sync.update(sample())).toMatchObject({ type: "snapshot", state: { version: 1 } });
	});

	it("does not advance for filtered fields and rejects invalid version transitions", () => {
		const sync = new FrontendStateSynchronizer();
		sync.update(sample());
		const state = { ...sample(), token: "secret" };
		expect(sync.update(state)).toBeNull();
		expect(() => buildStateDelta(sample(1), sample(3))).toThrow("revision");
		expect(() => buildStateDelta(null, sample(0))).toThrow("positive");
		expect(() => sync.reset(-1)).toThrow("base version");
		expect(() => new FrontendStateSynchronizer(Number.MAX_SAFE_INTEGER).update(sample())).toThrow(
			"exhausted",
		);
	});
});
