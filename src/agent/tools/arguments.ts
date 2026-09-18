export function objectArgs(args: unknown, keys: string[]) {
	if (
		!args ||
		typeof args !== "object" ||
		Array.isArray(args) ||
		Object.keys(args).some((k) => !keys.includes(k))
	)
		throw new Error("Invalid tool arguments");
	return args as Record<string, unknown>;
}
export function idArg(value: unknown): string {
	if (typeof value !== "string" || !value.trim() || value.length > 255) throw new Error("Invalid identifier");
	return value;
}
export function quantityArg(value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100)
		throw new Error("Invalid quantity");
	return value;
}
export function emptyArgs(args: unknown): Record<string, never> {
	objectArgs(args, []);
	return {};
}
