import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../ports/session-events.js";
import { sessionEvents } from "./sdk-events.js";
import { ToolRefusals } from "./tool-refusals.js";

const message = (fields: Record<string, unknown>): SDKMessage => fields as unknown as SDKMessage;

const call = (id: string, name: string): SDKMessage =>
  message({
    type: "assistant",
    parent_tool_use_id: null,
    message: { content: [{ type: "tool_use", id, name, input: {} }] },
  });

const failedResult = (id: string, text: string): SDKMessage =>
  message({
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: true }],
    },
  });

const turnResult = (denials: { tool_use_id: string; tool_name: string }[]): SDKMessage =>
  message({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    total_cost_usd: 0,
    permission_denials: denials.map((denial) => ({ ...denial, tool_input: {} })),
    user_message_uuids: [],
  });

function play(refusals: ToolRefusals, messages: readonly SDKMessage[]): SessionEvent[] {
  return messages.flatMap((each) => refusals.withRefusals(each, sessionEvents(each)));
}

describe("ToolRefusals", () => {
  it("reports an Office rules refusal after the result the Agent read, once", () => {
    const refusals = new ToolRefusals();
    const events = play(refusals, [call("c1", "Write")]);
    refusals.refusedByOfficeRules("c1", "Not allowed in this session: editing files.");
    events.push(
      ...play(refusals, [
        failedResult(
          "c1",
          "PreToolUse:Write hook error: Not allowed in this session: editing files.",
        ),
        turnResult([{ tool_use_id: "c1", tool_name: "Write" }]),
      ]),
    );

    expect(events.map((event) => event.kind)).toEqual([
      "tool-call",
      "tool-result",
      "tool-refused",
      "turn-ended",
    ]);
    expect(events[2]).toEqual({
      kind: "tool-refused",
      callId: "c1",
      tool: "Write",
      reason: "Not allowed in this session: editing files.",
      refusedBy: "office-rules",
    });
  });

  it("reports the engine's refusal from its permission_denied message, not again at the turn's end", () => {
    const refusals = new ToolRefusals();
    const events = play(refusals, [
      call("c1", "Read"),
      message({
        type: "system",
        subtype: "permission_denied",
        tool_name: "Read",
        tool_use_id: "c1",
        message: "Reads outside the working directories are blocked.",
      }),
      turnResult([{ tool_use_id: "c1", tool_name: "Read" }]),
    ]);

    expect(events.filter((event) => event.kind === "tool-refused")).toEqual([
      {
        kind: "tool-refused",
        callId: "c1",
        tool: "Read",
        reason: "Reads outside the working directories are blocked.",
        refusedBy: "engine",
      },
    ]);
  });

  it("reports what only the turn's denials hold before the turn ends, with the result's words", () => {
    const refusals = new ToolRefusals();
    const events = play(refusals, [
      call("c1", "mcp__office__note"),
      failedResult("c1", "No approval surface in this session."),
      call("c2", "Bash"),
      turnResult([
        { tool_use_id: "c1", tool_name: "mcp__office__note" },
        { tool_use_id: "c2", tool_name: "Bash" },
      ]),
    ]);

    expect(events.slice(-3)).toEqual([
      {
        kind: "tool-refused",
        callId: "c1",
        tool: "note",
        reason: "No approval surface in this session.",
        refusedBy: "engine",
      },
      {
        kind: "tool-refused",
        callId: "c2",
        tool: "Bash",
        reason: "Refused by the engine.",
        refusedBy: "engine",
      },
      expect.objectContaining({ kind: "turn-ended" }),
    ]);
  });
});
