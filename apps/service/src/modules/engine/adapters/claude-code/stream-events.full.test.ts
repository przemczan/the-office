import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import { StreamEvents, userMessage } from "./stream-events.js";

const USAGE = { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 0 };

const assistant = (content: unknown[]): SDKMessage =>
  ({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m1", content, usage: USAGE },
  }) as unknown as SDKMessage;

const releaseCommand = (input: string) => ({
  id: "7b0c0c9e-1b1a-4c55-9d43-31f1d7a5b0aa",
  text: "release it",
  skillCommand: { skill: "office:release", input },
});

describe("StreamEvents", () => {
  it("gives a message's events, then the context it read and the running turn's tokens", () => {
    const events = new StreamEvents([]).of(assistant([{ type: "text", text: "hi" }]));

    expect(events).toEqual([
      { kind: "text", text: "hi", withinToolCall: undefined },
      { kind: "context-read", tokens: 10 },
      {
        kind: "turn-tokens",
        soFar: { input: 10, output: 2, cacheRead: 0, cacheCreation: 0 },
      },
    ]);
  });

  it("reports a call the Office rules refused after its result", () => {
    const stream = new StreamEvents([]);
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

  it("reports each of the session's MCP servers that didn't start once, from the init that opens each turn", () => {
    // The shape binary 2.1.310 writes: `status` is the server's connection state, with no error text.
    const init = {
      type: "system",
      subtype: "init",
      mcp_servers: [
        { name: OFFICE_TOOL_SERVER, status: "failed", source: "sdk" },
        { name: "github", status: "failed", source: "dynamic" },
        { name: "sentry", status: "needs-auth", source: "dynamic" },
        { name: "linear", status: "connected", source: "dynamic" },
        { name: "slow", status: "pending", source: "dynamic" },
      ],
    } as unknown as SDKMessage;
    const stream = new StreamEvents(["github", "sentry", "linear", "slow"]);

    const firstTurn = stream.of(init);
    const secondTurn = stream.of(init);

    expect(firstTurn).toEqual([
      { kind: "mcp-server-not-started", server: "github", reason: undefined },
      {
        kind: "mcp-server-not-started",
        server: "sentry",
        reason: "It asked for authentication; check its Server values.",
      },
    ]);
    expect(secondTurn).toEqual([]);
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

  it("writes a skill command as the user types it, whatever its priority", () => {
    expect(userMessage(releaseCommand("v2 now"), "later")).toMatchObject({
      message: { role: "user", content: "/office:release v2 now" },
      priority: "later",
    });
    expect(userMessage(releaseCommand(""), "next")).toMatchObject({
      message: { role: "user", content: "/office:release" },
      priority: "next",
    });
  });
});
