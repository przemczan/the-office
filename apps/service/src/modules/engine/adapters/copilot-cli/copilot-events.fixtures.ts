import type { CopilotEvent } from "./copilot-runtime.js";

type DataOf<T extends CopilotEvent["type"]> = Extract<CopilotEvent, { type: T }>["data"];

let sequence = 0;

/**
 * One runtime event with the envelope the runtime gives every event; the one cast of the fixtures,
 * since a recording's data is what each test names and the envelope is never read.
 */
export function copilotEvent<T extends CopilotEvent["type"]>(
  type: T,
  data: Partial<DataOf<T>>,
  agentId?: string,
): CopilotEvent {
  sequence += 1;
  return {
    id: `event-${sequence}`,
    parentId: null,
    timestamp: "2026-11-19T12:00:00.000Z",
    ephemeral: true,
    type,
    data,
    ...(agentId === undefined ? {} : { agentId }),
  } as unknown as CopilotEvent;
}

export const userMessage = (clientTurnId: string): CopilotEvent =>
  copilotEvent("user.message", { content: "Do it.", clientTurnId, delivery: "idle" });

export const answer = (content: string, agentId?: string): CopilotEvent =>
  copilotEvent("assistant.message", { messageId: `m-${content.length}`, content }, agentId);

export const usage = (
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  agentId?: string,
): CopilotEvent =>
  copilotEvent(
    "assistant.usage",
    { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model: "auto" },
    agentId,
  );

export const toolStart = (toolCallId: string, toolName: string, args: unknown): CopilotEvent =>
  copilotEvent("tool.execution_start", { toolCallId, toolName, arguments: args as never });

export const toolDone = (toolCallId: string, content: string): CopilotEvent =>
  copilotEvent("tool.execution_complete", { toolCallId, success: true, result: { content } });

export const toolDenied = (toolCallId: string, reason: string): CopilotEvent =>
  copilotEvent("tool.execution_complete", {
    toolCallId,
    success: false,
    error: { code: "denied", message: `Denied by preToolUse hook: ${reason}` },
  });

export const idle = (aborted?: boolean): CopilotEvent =>
  copilotEvent("session.idle", aborted === undefined ? {} : { aborted });

/** A turn that reads a file, then answers: the shape of a recorded one, without its deltas' count. */
export const READ_A_FILE_TURN: readonly CopilotEvent[] = [
  userMessage("turn-1"),
  copilotEvent("assistant.message_delta", { messageId: "m-1", deltaContent: "Let me " }),
  copilotEvent("assistant.message_delta", { messageId: "m-1", deltaContent: "look." }),
  answer("Let me look."),
  toolStart("call-1", "view", { path: "/work/a.ts" }),
  toolDone("call-1", "export const a = 1;"),
  usage(4000, 40, 3000, 100),
  copilotEvent("session.usage_info", {
    currentTokens: 4040,
    tokenLimit: 128000,
    messagesLength: 3,
  }),
  answer("The file exports a."),
  usage(4100, 20, 3100, 0),
  idle(),
];
