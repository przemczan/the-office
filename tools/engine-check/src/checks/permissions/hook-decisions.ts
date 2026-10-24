import type { HookJSONOutput, HookPermissionDecision } from "@anthropic-ai/claude-agent-sdk";
import type { ProbeHook } from "../../probe-session.ts";
import { isWithin } from "../paths.ts";
import { targetPath } from "../tool-calls.ts";

/** The answer of a `PreToolUse` hook that decides the call, as the Office's one hook does (spec §6). */
export function toolDecision(permissionDecision: HookPermissionDecision, permissionDecisionReason?: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      ...(permissionDecisionReason === undefined ? {} : { permissionDecisionReason }),
    },
  };
}

/** A `PreToolUse` hook that decides calls of `tool` by the path they work on; other calls, and an undefined decision, go to the engine's own rules. */
export function decideCallsOf(tool: string, decide: (path: string | undefined) => HookJSONOutput | undefined): ProbeHook {
  return async (input) => (input.hook_event_name === "PreToolUse" && input.tool_name === tool ? (decide(targetPath(input.tool_input)) ?? {}) : {});
}

/**
 * Allows `tool` inside `folder` only, so a hook that grants a call never lets the session act outside
 * its sandbox, whatever path the model picks.
 */
export function allowCallsWithin(tool: string, folder: string): ProbeHook {
  return decideCallsOf(tool, (path) =>
    path !== undefined && isWithin(path, folder) ? toolDecision("allow") : toolDecision("deny", "Outside the engine check's sandbox."),
  );
}
