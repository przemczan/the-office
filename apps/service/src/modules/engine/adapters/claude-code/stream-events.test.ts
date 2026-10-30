import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { StreamEvents, userMessage } from "./stream-events.js";

const USAGE = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0 };

const assistant = (content: unknown[]): SDKMessage =>
  ({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m1", content, usage: USAGE },
  }) as unknown as SDKMessage;

describe("StreamEvents", () => {
  it("gives a message's events, then the running turn's tokens", () => {
    const events = new StreamEvents().of(assistant([{ type: "text", text: "hi" }]));

    expect(events).toEqual([
      { kind: "text", text: "hi", withinToolCall: undefined },
      {
        kind: "turn-tokens",
        soFar: { input: 10, output: 2, cacheRead: 0, cacheCreation: 0 },
      },
    ]);
  });

  it("reports a call the Office rules refused after its result", () => {
    const stream = new StreamEvents();
    stream.of(
      assistant([{ type: "tool_use", id: "c1", name: "Write", input: { file_path: "a" } }]),
    );
    stream.refusals.refusedByOfficeRules("c1", "Not allowed in this session: editing files.");

    const events = stream.of({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "c1", content: "denied", is_error: true }],
      },
    } as unknown as SDKMessage);

    expect(events).toEqual([
      { kind: "tool-result", callId: "c1", text: "denied", isError: true },
      {
        kind: "tool-refused",
        callId: "c1",
        tool: "Write",
        reason: "Not allowed in this session: editing files.",
        refusedBy: "office-rules",
      },
    ]);
  });
});

describe("userMessage", () => {
  it("writes a message with its priority, and a brief without one", () => {
    const message = { id: "7b0c0c9e-1b1a-4c55-9d43-31f1d7a5b0aa", text: "hello" };

    expect(userMessage(message, "next")).toEqual({
      type: "user",
      message: { role: "user", content: "hello" },
      parent_tool_use_id: null,
      uuid: message.id,
      priority: "next",
    });
    expect(userMessage(message, undefined)).not.toHaveProperty("priority");
  });
});
