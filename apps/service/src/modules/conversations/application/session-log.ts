import type { EngineSessions } from "../../engine/index.js";
import type { MessageDraft } from "../domain/message.js";
import { toolActivitySummary } from "../domain/tool-activity.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;
export type SessionEvent =
  EngineSession["events"] extends AsyncIterable<infer Event> ? Event : never;

/** Whose session reports, and where it works, which its tool calls are summed up against. */
export interface SessionLogger {
  readonly roleKey: string;
  readonly folder: string;
  /** The person writes their Handover note in the turn running now. */
  readonly handingOver: boolean;
}

/**
 * What a session's event adds to its Thread's log: the person's words, what they did with a tool
 * and what was refused. Work inside a tool call stays the tool's; a turn's end is the caller's.
 */
export function sessionLogLines(
  event: SessionEvent,
  { roleKey, folder, handingOver }: SessionLogger,
): MessageDraft[] {
  switch (event.kind) {
    case "text":
      if (event.withinToolCall !== undefined) return [];
      return [
        handingOver
          ? { kind: "handover-note", roleKey, text: event.text }
          : { kind: "person", roleKey, text: event.text },
      ];
    case "tool-call":
      if (event.withinToolCall !== undefined) return [];
      return [
        {
          kind: "tool-activity",
          roleKey,
          tool: event.tool,
          summary: toolActivitySummary(event.input, folder),
        },
      ];
    case "tool-refused":
      return [{ kind: "refusal", roleKey, tool: event.tool, reason: event.reason }];
    default:
      return [];
  }
}
