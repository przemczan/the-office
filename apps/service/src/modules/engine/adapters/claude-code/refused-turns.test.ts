import { describe, expect, it } from "vitest";
import { UNKNOWN_RESET_RETRY_MS, type SessionEvent } from "../../ports/session-events.js";
import { message, RESULT } from "./sdk-events.fixtures.js";
import { StreamEvents } from "./stream-events.js";

// A refused turn as the pinned binary builds it (docs/engine-check.md, engine.usage-window-refusal):
// a rejected rate-limit event read from a 429's headers, a synthetic assistant message, and a result
// that is an error.
const LIMIT_TEXT = "You've hit your limit · resets 2pm (UTC)";
const RESET_SECONDS = 1_794_578_400;

const rateLimit = (info: Record<string, unknown>) =>
  message({ type: "rate_limit_event", rate_limit_info: info });

const LIMIT_REPLY = message({
  type: "assistant",
  parent_tool_use_id: null,
  error: "rate_limit",
  message: {
    id: "synthetic",
    content: [{ type: "text", text: LIMIT_TEXT }],
    usage: { input_tokens: 0, output_tokens: 0 },
  },
});

const failedResult = (text: string) =>
  message({ ...RESULT, subtype: "success", is_error: true, result: text, api_error_status: 429 });

function turnEnd(events: readonly SessionEvent[]) {
  const ended = events.find((event) => event.kind === "turn-ended");
  if (ended?.kind !== "turn-ended") throw new Error("The turn didn't end");
  return ended;
}

function streamed(...messages: ReturnType<typeof message>[]): SessionEvent[] {
  const stream = new StreamEvents([]);
  return messages.flatMap((each) => stream.of(each));
}

function windowOf(rateLimitType: string) {
  return turnEnd(
    streamed(
      rateLimit({ status: "rejected", rateLimitType, resetsAt: RESET_SECONDS }),
      failedResult(LIMIT_TEXT),
    ),
  ).usedUpWindow?.window;
}

describe("a turn refused for a used-up usage window, on both Claude Code adapters", () => {
  it("ends as usage-window-used-up, naming the window and the reset the rejected event gave", () => {
    const events = streamed(
      rateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: RESET_SECONDS }),
      LIMIT_REPLY,
      failedResult(LIMIT_TEXT),
    );

    expect(turnEnd(events)).toMatchObject({
      outcome: "usage-window-used-up",
      errors: [LIMIT_TEXT],
      usedUpWindow: {
        window: "five-hour",
        resetsAt: new Date(RESET_SECONDS * 1000),
        resetGiven: true,
      },
    });
  });

  it("names each window the engine reports in the port's words, and keeps a new one's own name", () => {
    expect(windowOf("seven_day")).toBe("seven-day");
    expect(windowOf("seven_day_opus")).toBe("seven-day-opus");
    expect(windowOf("seven_day_sonnet")).toBe("seven-day-sonnet");
    expect(windowOf("seven_day_overage_included")).toBe("seven-day-overage-included");
    expect(windowOf("overage")).toBe("overage");
    expect(windowOf("thirty_day_fable")).toBe("thirty_day_fable");
  });

  it("waits the named delay when the engine gives no reset time", () => {
    const before = Date.now();
    const ended = turnEnd(streamed(rateLimit({ status: "rejected" }), failedResult(LIMIT_TEXT)));

    expect(ended.outcome).toBe("usage-window-used-up");
    expect(ended.usedUpWindow?.window).toBe("unknown");
    expect(ended.usedUpWindow?.resetGiven).toBe(false);
    expect(ended.usedUpWindow?.resetsAt.getTime()).toBeGreaterThanOrEqual(
      before + UNKNOWN_RESET_RETRY_MS,
    );
  });

  it("leaves a turn failing after an allowed event an ordinary failure, as overloaded or a 5xx", () => {
    const ended = turnEnd(
      streamed(
        rateLimit({ status: "allowed", rateLimitType: "five_hour", resetsAt: RESET_SECONDS }),
        failedResult("API Error: Repeated 529 Overloaded errors"),
      ),
    );

    expect(ended.outcome).toBe("failed");
    expect(ended.usedUpWindow).toBeUndefined();
  });

  it("leaves a rate_limit error without a rejected event an ordinary failure", () => {
    const ended = turnEnd(streamed(LIMIT_REPLY, failedResult(LIMIT_TEXT)));

    expect(ended.outcome).toBe("failed");
  });

  it("forgets the rejected event at the turn's end, so the next turn's failure stays a failure", () => {
    const events = streamed(
      rateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: RESET_SECONDS }),
      failedResult(LIMIT_TEXT),
      failedResult("API Error: 500"),
    );
    const ends = events.filter((event) => event.kind === "turn-ended");

    expect(ends.map((ended) => ended.outcome)).toEqual(["usage-window-used-up", "failed"]);
  });

  it("leaves a turn that completes after a rejected event completed", () => {
    const ended = turnEnd(
      streamed(
        rateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: RESET_SECONDS }),
        message({ ...RESULT, subtype: "success", is_error: false, result: "ok" }),
      ),
    );

    expect(ended.outcome).toBe("completed");
  });
});

describe("the engine's own message for a refused turn", () => {
  it("is not the Agent's words: its text reaches the turn only as its error", () => {
    const events = streamed(
      rateLimit({ status: "rejected", rateLimitType: "five_hour", resetsAt: RESET_SECONDS }),
      LIMIT_REPLY,
      failedResult(LIMIT_TEXT),
    );

    expect(events.some((event) => event.kind === "text")).toBe(false);
    expect(turnEnd(events).errors).toEqual([LIMIT_TEXT]);
  });
});
