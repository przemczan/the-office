import { describe, expect, it } from "vitest";
import { sessionEvents } from "./sdk-events.js";
import { message, RESULT } from "./sdk-events.fixtures.js";

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
});
