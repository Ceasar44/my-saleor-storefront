import type { FrontendToolResult } from "@/agent/tools/types";
export type DeleteCartLine = (checkoutId: string, lineId: string) => Promise<void | FrontendToolResult>;

export type UpdateCartLineQuantity = (
	checkoutId: string,
	lineId: string,
	quantity: number,
) => Promise<void | FrontendToolResult>;
