import type { ToolCallEvent } from "../../ports/session-events.js";
import type { SessionOptions } from "../../ports/session-options.js";

/** The tools whose call starts a Sub-agent: `Agent` is the newer name of `Task`. */
export const SUB_AGENT_TOOLS: ReadonlySet<string> = new Set(["Task", "Agent"]);

/**
 * A Sub-agent call's input made to run in the foreground, so the turn holds until it answers
 * (spec §2.9, in a Stage); undefined for any other tool's call. The engine takes the input whole
 * in its place, so every other field stays as the Agent gave it.
 */
export function foregroundSubAgentInput(
  tool: string,
  input: unknown,
): Record<string, unknown> | undefined {
  if (!SUB_AGENT_TOOLS.has(tool)) return undefined;
  const given = typeof input === "object" && input !== null ? input : {};
  return { ...given, run_in_background: false };
}

/**
 * A call as the session's Office rules hook let it run: the engine's stream shows it as the model
 * wrote it, so a Sub-agent forced to the foreground would read as a background one.
 */
export function callAsRun(
  call: ToolCallEvent,
  { subAgentsInForeground }: Pick<SessionOptions, "subAgentsInForeground">,
): ToolCallEvent {
  if (subAgentsInForeground !== true) return call;
  const input = foregroundSubAgentInput(call.tool, call.input);
  return input === undefined ? call : { ...call, input };
}
