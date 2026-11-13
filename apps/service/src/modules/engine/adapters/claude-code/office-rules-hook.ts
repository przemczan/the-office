import type { HookCallback, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { OfficeRules, ToolDecision } from "../../domain/office-rules.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { foregroundSubAgentInput } from "../office-rules/foreground-sub-agents.js";
import { toolDecision, type SessionHolds } from "../office-rules/tool-decision.js";
import type { ToolRefusals } from "./tool-refusals.js";

/** What the hook changes in a call it allows. */
export type HookRewrites = Pick<SessionOptions, "subAgentsInForeground">;

/**
 * The session's one `PreToolUse` hook (spec §6): it sees every call the engine's input validation
 * lets through, before any rule. It allows what `toolDecision` allows, since `permissionPrompts:
 * 'none'` refuses whatever nothing allowed, and refuses the rest with the reason. In a session
 * whose Sub-agents run in the foreground, an allowed Sub-agent call runs with its input made so.
 */
export function officeRulesHook(
  rules: OfficeRules,
  refusals: ToolRefusals,
  holds: SessionHolds = {},
  { subAgentsInForeground }: HookRewrites = {},
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const decision = await toolDecision(rules, holds, input.tool_name, input.tool_input);
    if (!decision.allowed) {
      refusals.refusedByOfficeRules(input.tool_use_id, decision.reason);
      return hookOutput(decision, undefined);
    }
    const updatedInput =
      subAgentsInForeground === true
        ? foregroundSubAgentInput(input.tool_name, input.tool_input)
        : undefined;
    return hookOutput(decision, updatedInput);
  };
}

function hookOutput(
  decision: ToolDecision,
  updatedInput: Record<string, unknown> | undefined,
): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision.allowed ? "allow" : "deny",
      ...(!decision.allowed && { permissionDecisionReason: decision.reason }),
      ...(updatedInput !== undefined && { updatedInput }),
    },
  };
}
