import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { OfficeRules, ToolDecision } from "../../domain/office-rules.js";
import { toolDecision, type SessionHolds } from "../office-rules/tool-decision.js";
import type { ToolRefusals } from "./tool-refusals.js";

/**
 * The session's one `PreToolUse` hook (spec §6): it sees every call the engine's input validation
 * lets through, before any rule. It allows what `toolDecision` allows, since `permissionPrompts:
 * 'none'` refuses whatever nothing allowed, and refuses the rest with the reason.
 */
export function officeRulesHook(
  rules: OfficeRules,
  refusals: ToolRefusals,
  holds: SessionHolds = {},
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const decision = await toolDecision(rules, holds, input.tool_name, input.tool_input);
    if (!decision.allowed) refusals.refusedByOfficeRules(input.tool_use_id, decision.reason);
    return hookOutput(decision);
  };
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
