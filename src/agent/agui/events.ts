import { EventSchemas, EventType } from "@ag-ui/core";
export type AgentEvent = ReturnType<typeof EventSchemas.parse>;
function matches(event: unknown, types: EventType[]) {
	const parsed = EventSchemas.safeParse(event);
	return parsed.success && types.includes(parsed.data.type);
}
export const isTextMessageEvent = (event: unknown) =>
	matches(event, [EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END]);
export const isToolCallEvent = (event: unknown) =>
	matches(event, [EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END]);
export const isRunStartedEvent = (event: unknown) => matches(event, [EventType.RUN_STARTED]);
export const isRunFinishedEvent = (event: unknown) => matches(event, [EventType.RUN_FINISHED]);
export const isRunErrorEvent = (event: unknown) => matches(event, [EventType.RUN_ERROR]);
