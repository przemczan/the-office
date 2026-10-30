import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import type { ClaudeCodePSession } from "../../claude-code-p/claude-code-p-session.ts";
import { observeBargeIn } from "../engine/message-priority.ts";

/** Barge-in on the fallback (spec §2.4, §5.4), as `engine.priority-next` and `-later` check it on the SDK. */
function fallbackPriorityCheck(
  priority: NonNullable<SDKUserMessage["priority"]>,
  title: string,
): Check {
  return {
    id: `fallback.priority-${priority}`,
    title,
    run: ({ sandbox, startClaudeCodePSession }) =>
      observeBargeIn<ClaudeCodePSession>(
        sandbox,
        (repository, preToolUse) =>
          startClaudeCodePSession({ repository, hooks: { PreToolUse: preToolUse } }),
        { priority },
      ),
  };
}

export const fallbackPriorityNextCheck = fallbackPriorityCheck(
  "next",
  "a message with priority 'next' lands between tool calls of the running turn",
);

export const fallbackPriorityLaterCheck = fallbackPriorityCheck(
  "later",
  "a message with priority 'later' waits for the turn to end and starts the next",
);
