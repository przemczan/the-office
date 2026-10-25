import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { OfficeRules, ToolDecision } from "../../domain/office-rules.js";
import { agentAction } from "./tool-actions.js";
import type { ToolRefusals } from "./tool-refusals.js";

/**
 * The session's one `PreToolUse` hook (spec §6): it sees every call the engine's input validation
 * lets through, before any rule, and the Office rules decide each. It allows what they allow,
 * since `permissionPrompts: 'none'` refuses whatever nothing allowed, and never lets a call
 * through undecided: a call it fails to judge is refused.
 */
export function officeRulesHook(rules: OfficeRules, refusals: ToolRefusals): HookCallback {
  return (input) => {
    if (input.hook_event_name !== "PreToolUse") return Promise.resolve({});
    const decision = decideOrRefuse(rules, input.tool_name, input.tool_input);
    if (!decision.allowed) refusals.refusedByOfficeRules(input.tool_use_id, decision.reason);
    return Promise.resolve(hookOutput(decision));
  };
}

function decideOrRefuse(rules: OfficeRules, tool: string, input: unknown): ToolDecision {
  try {
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
