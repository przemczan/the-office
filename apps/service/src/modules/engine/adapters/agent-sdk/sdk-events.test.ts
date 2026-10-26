import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { sessionEvents, TurnTokens, usageWindows } from "./sdk-events.js";

/** Stream messages as the engine sends them, with only the fields the mapping reads. */
const message = (fields: Record<string, unknown>): SDKMessage => fields as unknown as SDKMessage;

const RESULT = {
  type: "result",
  duration_ms: 1200,
  num_turns: 1,
  usage: {
    input_tokens: 4,
    output_tokens: 12,
    cache_read_input_tokens: 24_600,
    cache_creation_input_tokens: 180,
  },
  total_cost_usd: 0.0042,
  modelUsage: {},
  permission_denials: [],
  user_message_uuids: ["brief", "barge-in"],
  session_id: "session",
};

describe("sessionEvents", () => {
  it("reports the Agent's text and tool calls, naming Office tools by their own names", () => {
    const events = sessionEvents(
      message({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [
            { type: "thinking", thinking: "Let me look." },
            { type: "text", text: "Reading the plan." },
            { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "plan.md" } },
            { type: "tool_use", id: "call-2", name: "mcp__office__handover_note", input: {} },
          ],
        },
      }),
    );

    expect(events).toEqual([
      { kind: "text", text: "Reading the plan.", withinToolCall: undefined },
      {
        kind: "tool-call",
        callId: "call-1",
        tool: "Read",
        officeTool: false,
        input: { file_path: "plan.md" },
        withinToolCall: undefined,
      },
      {
        kind: "tool-call",
        callId: "call-2",
        tool: "handover_note",
        officeTool: true,
        input: {},
        withinToolCall: undefined,
      },
    ]);
  });

  it("names the subagent's tool call on what a subagent does", () => {
    const [event] = sessionEvents(
      message({
        type: "assistant",
        parent_tool_use_id: "call-task",
        message: { content: [{ type: "text", text: "Found it." }] },
      }),
    );

    expect(event).toEqual({ kind: "text", text: "Found it.", withinToolCall: "call-task" });
  });

  it("reports tool results as text, and nothing for the caller's own messages or replays", () => {
    const toolResult = message({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-1",
            content: [
              { type: "text", text: "line one" },
              { type: "image", source: {} },
              { type: "text", text: "line two" },
            ],
          },
          { type: "tool_result", tool_use_id: "call-2", content: "refused", is_error: true },
        ],
      },
    });
    const sent = message({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: "Read the plan." },
    });
    const replayed = message({ ...toolResult, isReplay: true });

    expect(sessionEvents(toolResult)).toEqual([
      { kind: "tool-result", callId: "call-1", text: "line one\nline two", isError: false },
      { kind: "tool-result", callId: "call-2", text: "refused", isError: true },
    ]);
    expect(sessionEvents(sent)).toEqual([]);
    expect(sessionEvents(replayed)).toEqual([]);
  });

  it("ends a successful turn completed, with its tokens, the session's cost and its output", () => {
    const [event] = sessionEvents(
      message({
        ...RESULT,
        subtype: "success",
        is_error: false,
        result: "",
        structured_output: { word: "ready" },
      }),
    );

    expect(event).toEqual({
      kind: "turn-ended",
      outcome: "completed",
      consumedMessageIds: ["brief", "barge-in"],
      usage: { input: 4, output: 12, cacheRead: 24_600, cacheCreation: 180 },
      sessionCostUsd: 0.0042,
      output: { word: "ready" },
      errors: [],
    });
  });

  it("ends a turn interrupt() stopped interrupted, and any other error failed", () => {
    const interrupted = message({
      ...RESULT,
      subtype: "error_during_execution",
      is_error: true,
      terminal_reason: "aborted_tools",
      errors: [],
    });
    const failed = message({
      ...RESULT,
      subtype: "error_max_turns",
      is_error: true,
      terminal_reason: "max_turns",
      errors: ["Reached the turn limit."],
    });
    const apiError = message({
      ...RESULT,
      subtype: "success",
      is_error: true,
      result: "API Error: overloaded",
    });

    expect(sessionEvents(interrupted)[0]).toMatchObject({ outcome: "interrupted", errors: [] });
    expect(sessionEvents(failed)[0]).toMatchObject({
      outcome: "failed",
      errors: ["Reached the turn limit."],
      output: undefined,
    });
    expect(sessionEvents(apiError)[0]).toMatchObject({
      outcome: "failed",
      errors: ["API Error: overloaded"],
    });
  });

  it("falls back to the one message id an older engine names", () => {
    const [event] = sessionEvents(
      message({
        ...RESULT,
        subtype: "success",
        is_error: false,
        result: "",
        user_message_uuids: undefined,
        user_message_uuid: "brief",
      }),
    );

    expect(event).toMatchObject({ consumedMessageIds: ["brief"] });
  });

  it("reports a rate limit's status and reset time", () => {
    const events = sessionEvents(
      message({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed_warning", resetsAt: 1_793_000_000 },
      }),
    );

    expect(events).toEqual([
      { kind: "rate-limit", status: "warning", resetsAt: new Date(1_793_000_000_000) },
    ]);
  });

  it("reports nothing for messages the Office has no use for, or doesn't know", () => {
    expect(sessionEvents(message({ type: "system", subtype: "init" }))).toEqual([]);
    expect(sessionEvents(message({ type: "command_lifecycle" }))).toEqual([]);
  });
});

/** One frame of an assistant message: its id and its usage, as the engine repeats it. */
const frame = (id: string, output: number, parent: string | null = null): SDKMessage =>
  message({
    type: "assistant",
    parent_tool_use_id: parent,
    message: {
      id,
      content: [],
      usage: {
        input_tokens: 3,
        output_tokens: output,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: null,
      },
    },
  });

describe("TurnTokens", () => {
  it("counts each message once, at its latest frame's usage, a subagent's too", () => {
    const turnTokens = new TurnTokens();

    const first = turnTokens.eventsOf(frame("msg-1", 10));
    const repeated = turnTokens.eventsOf(frame("msg-1", 10));
    const grown = turnTokens.eventsOf(frame("msg-1", 40));
    const subagent = turnTokens.eventsOf(frame("msg-2", 5, "call-1"));

    expect(first).toEqual([
      { kind: "turn-tokens", soFar: { input: 3, output: 10, cacheRead: 1000, cacheCreation: 0 } },
    ]);
    expect(repeated).toEqual([]);
    expect(grown).toEqual([
      { kind: "turn-tokens", soFar: { input: 3, output: 40, cacheRead: 1000, cacheCreation: 0 } },
    ]);
    expect(subagent).toEqual([
      { kind: "turn-tokens", soFar: { input: 6, output: 45, cacheRead: 2000, cacheCreation: 0 } },
    ]);
  });

  it("starts over once the turn ends, and reports nothing for other messages", () => {
    const turnTokens = new TurnTokens();
    turnTokens.eventsOf(frame("msg-1", 10));

    expect(turnTokens.eventsOf(message({ ...RESULT, subtype: "success" }))).toEqual([]);
    expect(turnTokens.eventsOf(message({ type: "system", subtype: "init" }))).toEqual([]);
    expect(turnTokens.eventsOf(frame("msg-2", 7))).toEqual([
      { kind: "turn-tokens", soFar: { input: 3, output: 7, cacheRead: 1000, cacheCreation: 0 } },
    ]);
  });
});

describe("usageWindows", () => {
  it("reads the 5-hour and 7-day windows, a window not begun as unused", () => {
    expect(
      usageWindows({
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 12.5, resets_at: "2026-10-25T18:00:00Z" },
          seven_day: { utilization: null, resets_at: null },
        },
      }),
    ).toEqual({
      fiveHour: { percentUsed: 12.5, resetsAt: new Date("2026-10-25T18:00:00Z") },
      sevenDay: { percentUsed: 0, resetsAt: undefined },
    });
  });

  it("has none for an account without them", () => {
    expect(usageWindows({ rate_limits_available: false, rate_limits: null })).toBe(undefined);
  });
});
