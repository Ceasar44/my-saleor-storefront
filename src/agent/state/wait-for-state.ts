import type { FrontendState } from "@/agent/state/types";
export function waitForFrontendState(
	getState: () => FrontendState,
	predicate: (state: FrontendState) => boolean,
	signal?: AbortSignal,
): Promise<boolean> {
	return new Promise((resolve) => {
		const finish = (result: boolean) => {
			clearInterval(interval);
			clearTimeout(timeout);
			signal?.removeEventListener("abort", cancel);
			resolve(result);
		};
		const cancel = () => finish(false);
		const interval = setInterval(() => {
			if (predicate(getState())) finish(true);
		}, 25);
		const timeout = setTimeout(cancel, 10000);
		signal?.addEventListener("abort", cancel, { once: true });
		if (signal?.aborted) cancel();
		else if (predicate(getState())) finish(true);
	});
}
