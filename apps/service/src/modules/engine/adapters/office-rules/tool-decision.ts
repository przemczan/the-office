import type { OfficeRules, ToolDecision } from "../../domain/office-rules.js";
import type { ToolHold } from "../../ports/session-options.js";
import { agentAction } from "./tool-actions.js";

/**
 * Whether a session may make a tool call, as Claude Code names the tool: while The Office holds
 * every tool call (`hold`, such as during the fire alarm, spec §2.8) it is refused in the hold's
 * words; otherwise the Office rules decide. A call it fails to judge is refused, never let through
 * undecided.
 */
export async function toolDecision(
  rules: OfficeRules,
  hold: ToolHold | undefined,
  tool: string,
  input: unknown,
): Promise<ToolDecision> {
  try {
    const held = await hold?.();
    if (held !== undefined) return { allowed: false, reason: held };
    return rules.decide(agentAction(tool, input));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reason: `Refused by The Office: it could not judge this call (${detail}).`,
    };
  }
}
