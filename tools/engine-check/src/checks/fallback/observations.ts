import type { SDKMessage, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeCodePSession, UsageAnswer } from "../../claude-code-p/claude-code-p-session.ts";
import type { Observation } from "../../check.ts";
import { sortedNames } from "../observations.ts";

/** The plan windows the Office shows (spec §5.4). */
const WINDOWS = ["five_hour", "seven_day"] as const;

/** Which of the windows the usage query answers with, by field, never their values. */
export function usageWindows(usage: UsageAnswer): Observation {
  return {
    rateLimitsAvailable: usage.rate_limits_available ?? null,
    windows: Object.fromEntries(
      WINDOWS.map((window) => {
        const limit = usage.rate_limits?.[window];
        return [
          window,
          {
            utilization: typeof limit?.utilization === "number",
            resetsAt: typeof limit?.resets_at === "string",
          },
        ];
      }),
    ),
  };
}

/** The `rate_limit_event` messages of a session, with which windows they name. */
export function rateLimitEvents(messages: readonly SDKMessage[]): Observation {
  const events = messages.filter(
    (message): message is SDKRateLimitEvent => message.type === "rate_limit_event",
  );
  return {
    arrived: events.length > 0,
    resetsAt: events.some(({ rate_limit_info: info }) => info.resetsAt !== undefined),
    // Which window it names follows the account's use, so only that it names one is recorded.
    namesAWindow: events.some(({ rate_limit_info: info }) => info.rateLimitType !== undefined),
  };
}

/** What the engine asked the host, by subtype; the check answers each with an error. */
export function requestsToHost(session: ClaudeCodePSession): string[] {
  return sortedNames(
    session.hostRequests.map((request) => {
      const subtype = (request as { subtype?: unknown } | undefined)?.subtype;
      return typeof subtype === "string" ? subtype : "unknown";
    }),
  );
}
