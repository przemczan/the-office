import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { OfficeRules, ToolDecision } from "../../domain/office-rules.js";
import type { ToolHold } from "../../ports/session-options.js";
import { agentAction } from "./tool-actions.js";
import type { ToolRefusals } from "./tool-refusals.js";

/**
 * The session's one `PreToolUse` hook (spec §6): it sees every call the engine's input validation
 * lets through, before any rule. While The Office holds every tool call (`hold`, such as during
 * the fire alarm, spec §2.8) it refuses each in the hold's words; otherwise the Office rules decide
 * each. It allows what they allow, since `permissionPrompts: 'none'` refuses whatever nothing
 * allowed, and never lets a call through undecided: a call it fails to judge is refused.
 */
export function officeRulesHook(
  rules: OfficeRules,
  refusals: ToolRefusals,
  hold?: ToolHold,
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const decision = await decideOrRefuse(rules, hold, input.tool_name, input.tool_input);
    if (!decision.allowed) refusals.refusedByOfficeRules(input.tool_use_id, decision.reason);
    return hookOutput(decision);
  };
}

async function decideOrRefuse(
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

function hookOutput(decision: ToolDecision): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.allowed ? "allow" : "deny",
      ...(!decision.allowed && { permissionDecisionReason: decision.reason }),
    },
  };
}
