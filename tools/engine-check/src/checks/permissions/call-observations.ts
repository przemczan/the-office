import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import type { ProbeSession } from "../../probe-session.ts";
import { lastOutcome, permissionDeniedMessage, toolResultIndex, type AttemptOutcome, type ToolCall } from "../tool-calls.ts";

/** How the engine and the Office's hooks met one tool call. */
export type CallObservation = {
  outcome: AttemptOutcome;
  /** The `PreToolUse` hook was called for it before its result arrived. */
  preToolUseFirst: boolean;
  /** `decision_reason_type` of the engine's `permission_denied` message, null when none came. */
  permissionDeniedMessage: string | null;
  permissionDeniedHook: boolean;
};

/** Observes the latest of `calls`, the retry when the model tried twice. */
export function observeCall(session: ProbeSession, calls: readonly ToolCall[]): CallObservation {
  const call = calls.at(-1);
  if (call === undefined) {
    return { outcome: lastOutcome(calls), preToolUseFirst: false, permissionDeniedMessage: null, permissionDeniedHook: false };
  }
  return {
    outcome: call.outcome,
    preToolUseFirst: seenFirstByPreToolUse(session, call),
    permissionDeniedMessage: permissionDeniedMessage(session.messages, call.id)?.decision_reason_type ?? null,
    permissionDeniedHook: hookCalledFor(session, "PermissionDenied", call),
  };
}

export function seenFirstByPreToolUse(session: ProbeSession, call: ToolCall): boolean {
  const hookCall = session.hookCalls.find((hookCall) => hookCall.event === "PreToolUse" && hookedToolUseId(hookCall.input) === call.id);
  const resultIndex = toolResultIndex(session.messages, call.id);
  return hookCall !== undefined && (resultIndex === -1 || hookCall.messageIndex <= resultIndex);
}

function hookCalledFor(session: ProbeSession, event: "PreToolUse" | "PermissionDenied", call: ToolCall): boolean {
  return session.hookCalls.some((hookCall) => hookCall.event === event && hookedToolUseId(hookCall.input) === call.id);
}

function hookedToolUseId(input: HookInput): string | undefined {
  return "tool_use_id" in input && typeof input.tool_use_id === "string" ? input.tool_use_id : undefined;
}
