import {
  USAGE_LIMIT_ERROR_PREFIXES,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKRateLimitEvent,
  type SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { CheckSkipped, type Check, type Observation } from "../../check.ts";
import { sortedNames } from "../observations.ts";

/** A window the usage query reports, by the fields the check reads. */
type QueryWindow = { readonly utilization?: unknown; readonly resets_at?: unknown } | null;

/** The usage query's windows, as both routes answer them; `model_scoped` is a list of windows. */
type QueryWindows = Readonly<Record<string, unknown>> | null | undefined;

const USED_UP_PERCENT = 100;

/**
 * What a turn the engine refuses for a used-up usage window carries (spec §5.4, Task 3de35a58): which
 * messages arrive, the `rate_limit_event`'s fields, the assistant message's `error` and text, and the
 * result's fields. Only facts are recorded; the error text and the reset time vary by account and
 * hour, so the report keeps them and the observation says only whether the text is one the SDK
 * lists as a usage limit (`USAGE_LIMIT_ERROR_PREFIXES`).
 */
export const usageWindowRefusalCheck: Check = {
  id: "engine.usage-window-refusal",
  title: "a turn refused for a used-up usage window: its rate_limit_event, error and result",
  async run({ sandbox, startSession }) {
    const session = await startSession({ repository: await sandbox.createRepository() });
    const usage = await session.control.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
      skipBehaviors: true,
    });
    skipUnlessUsedUp(usage.rate_limits);
    session.send("Reply with just OK.");
    const result = await session.nextResult();
    return refusedTurn(session.messages, result);
  },
};

/** The same on the pinned binary in `-p`, the fallback's route (spec §5.4 Defaults). */
export const fallbackUsageWindowRefusalCheck: Check = {
  id: "fallback.usage-window-refusal",
  title: "on -p, a turn refused for a used-up usage window: its rate_limit_event, error and result",
  async run({ sandbox, startClaudeCodePSession }) {
    const session = await startClaudeCodePSession({
      repository: await sandbox.createRepository(),
    });
    const usage = await session.usage();
    skipUnlessUsedUp(usage.rate_limits);
    session.send("Reply with just OK.");
    const result = await session.nextResult();
    return refusedTurn(session.messages, result);
  },
};

/** A turn is spent only when the usage query, which makes no model call, shows a window used up. */
function skipUnlessUsedUp(windows: QueryWindows): void {
  if (usedUpWindows(windows).length === 0) {
    throw new CheckSkipped(
      "No usage window of this account is used up, so no turn would be refused; run it again once one is.",
    );
  }
}

/** The windows at 100%, by the query's names; a model's weekly window by its display name. */
export function usedUpWindows(windows: QueryWindows): string[] {
  if (!windows) return [];
  return sortedNames(
    Object.entries(windows).flatMap(([name, window]) => {
      if (name === "model_scoped" && Array.isArray(window)) {
        return window.flatMap((scoped: QueryWindow & { readonly display_name?: unknown }) =>
          isUsedUp(scoped) ? [`model_scoped:${String(scoped?.display_name)}`] : [],
        );
      }
      return isUsedUp(window as QueryWindow) ? [name] : [];
    }),
  );
}

function isUsedUp(window: QueryWindow): boolean {
  return typeof window?.utilization === "number" && window.utilization >= USED_UP_PERCENT;
}

function refusedTurn(messages: readonly SDKMessage[], result: SDKResultMessage): Observation {
  const events = messages.filter(
    (message): message is SDKRateLimitEvent => message.type === "rate_limit_event",
  );
  const assistants = messages.filter(
    (message): message is SDKAssistantMessage => message.type === "assistant",
  );
  const resultText = result.subtype === "success" ? result.result : result.errors.join("\n");
  return {
    messageTypes: sortedNames(messages.map(messageType)),
    rateLimitEvent: {
      statuses: sortedNames(events.map(({ rate_limit_info: info }) => info.status)),
      namesAWindow: events.some(({ rate_limit_info: info }) => info.rateLimitType !== undefined),
      resetsAt: events.some(({ rate_limit_info: info }) => info.resetsAt !== undefined),
      overageStatuses: sortedNames(
        events.flatMap(({ rate_limit_info: info }) =>
          info.overageStatus === undefined ? [] : [info.overageStatus],
        ),
      ),
    },
    assistant: {
      errors: sortedNames(assistants.flatMap(({ error }) => (error === undefined ? [] : [error]))),
      textIsUsageLimit: assistants.some(({ message }) =>
        message.content.some((block) => block.type === "text" && isUsageLimitText(block.text)),
      ),
      madeToolCalls: assistants.some(({ message }) =>
        message.content.some((block) => block.type === "tool_use"),
      ),
    },
    result: {
      subtype: result.subtype,
      isError: result.is_error,
      terminalReason: result.terminal_reason ?? null,
      apiErrorStatus: result.subtype === "success" ? (result.api_error_status ?? null) : null,
      textIsUsageLimit: isUsageLimitText(resultText),
    },
  };
}

function messageType(message: SDKMessage): string {
  return "subtype" in message && typeof message.subtype === "string"
    ? `${message.type}:${message.subtype}`
    : message.type;
}

function isUsageLimitText(text: string): boolean {
  return USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix));
}
