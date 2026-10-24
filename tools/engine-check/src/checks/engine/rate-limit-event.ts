import type { SDKMessage, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk";
import type { Check } from "../../check.ts";
import { sortedNames } from "../observations.ts";

/** The plan windows the Office shows (spec §5.4). */
const WINDOWS = ["five_hour", "seven_day"] as const;

type WindowFields = { utilization: boolean; resetsAt: boolean };

/**
 * How the Office reads the 5-hour and 7-day windows (spec §5.4): from `rate_limit_event` and from the
 * experimental usage query. Only which fields are present is recorded, never their values.
 */
export const rateLimitEventCheck: Check = {
  id: "engine.rate-limit-event",
  title: "rate_limit_event and the usage query carry utilization and reset time for five_hour and seven_day",
  async run({ sandbox, startSession }) {
    const repository = await sandbox.createRepository();
    const session = await startSession({ repository });
    session.send("Reply with just OK.");
    await session.nextResult();
    const events = rateLimitEvents(session.messages);
    const usage = await session.control.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    return {
      eventArrived: events.length > 0,
      topLevel: {
        utilization: events.some(({ rate_limit_info: info }) => info.utilization !== undefined),
        resetsAt: events.some(({ rate_limit_info: info }) => info.resetsAt !== undefined),
      },
      eventWindows: sortedNames(events.flatMap((event) => Object.keys(unifiedWindows(event)))),
      eventWindowFields: Object.fromEntries(WINDOWS.map((window) => [window, eventWindowFields(events, window)])),
      usageQuery: {
        rateLimitsAvailable: usage.rate_limits_available,
        windows: Object.fromEntries(
          WINDOWS.map((window) => {
            const limit = usage.rate_limits?.[window];
            return [window, { utilization: typeof limit?.utilization === "number", resetsAt: typeof limit?.resets_at === "string" }];
          }),
        ),
      },
    };
  },
};

function rateLimitEvents(messages: readonly SDKMessage[]): SDKRateLimitEvent[] {
  return messages.filter((message): message is SDKRateLimitEvent => message.type === "rate_limit_event");
}

/** Every window's state, which the engine sends in a field its typings do not declare. */
function unifiedWindows(event: SDKRateLimitEvent): Record<string, { utilization?: unknown; resetsAt?: unknown }> {
  const { unifiedWindows: windows } = event.rate_limit_info as { unifiedWindows?: unknown };
  return typeof windows === "object" && windows !== null ? (windows as Record<string, { utilization?: unknown; resetsAt?: unknown }>) : {};
}

function eventWindowFields(events: readonly SDKRateLimitEvent[], window: string): WindowFields {
  const states = events.flatMap((event) => {
    const state = unifiedWindows(event)[window];
    return state === undefined ? [] : [state];
  });
  return {
    utilization: states.some((state) => typeof state.utilization === "number"),
    resetsAt: states.some((state) => typeof state.resetsAt === "number"),
  };
}
