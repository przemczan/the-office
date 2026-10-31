import type { OfficeRules, ToolDecision } from "../../domain/office-rules.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { agentAction } from "./tool-actions.js";

/** What holds a session's calls beside the Office rules. */
export type SessionHolds = Pick<SessionOptions, "toolHold" | "approvalHold">;

/**
 * Whether a session may make a tool call, as Claude Code names the tool: while The Office holds
 * every tool call (`toolHold`, such as during the fire alarm, spec §2.8) it is refused in the
 * hold's words; otherwise the Office rules decide, and a call they leave to someone's approval is
 * put to `approvalHold`. A call it fails to judge is refused, never let through undecided.
 */
export async function toolDecision(
  rules: OfficeRules,
  { toolHold, approvalHold }: SessionHolds,
  tool: string,
  input: unknown,
): Promise<ToolDecision> {
  try {
    const held = await toolHold?.();
    if (held !== undefined) return { allowed: false, reason: held };
    const action = agentAction(tool, input);
    const decision = rules.decide(action);
    if (decision.allowed || !decision.approval) return decision;
    if (action.kind !== "mcp-tool" || !approvalHold) {
      return { allowed: false, reason: decision.reason };
    }
    const refusal = await approvalHold({
      server: action.server,
      tool: action.tool,
      input,
      setting: decision.approval,
    });
    return refusal === undefined ? { allowed: true } : { allowed: false, reason: refusal };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reason: `Refused by The Office: it could not judge this call (${detail}).`,
    };
  }
}
