import type { z } from "zod";

/** The session an Office tool is called from, so the tool can tell whose work it acts on. */
export interface OfficeToolCall {
  readonly sessionId: string;
}

/** What an Office tool answers the Agent. */
export interface OfficeToolResult {
  readonly text: string;
  /** Whether the call failed; the Agent reads `text` either way. */
  readonly isError: boolean;
}

/**
 * A tool The Office gives Agents, run in-process by the service (spec §5.4), such as opening a
 * Decision or writing a Handover note.
 */
export interface OfficeTool<Input extends z.ZodObject = z.ZodObject> {
  /** Unique among Office tools; what the Agent calls it by. */
  readonly name: string;
  /** What the Agent reads to decide when to call it. */
  readonly description: string;
  readonly input: Input;
  run(input: z.output<Input>, call: OfficeToolCall): Promise<OfficeToolResult>;
}
