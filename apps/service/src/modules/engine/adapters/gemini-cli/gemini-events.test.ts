import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../../ports/session-events.js";
import { EMPTY_ANSWER, QUOTA_REFUSAL, TURN_WITH_A_REFUSAL } from "./gemini-events.fixtures.js";
import { GeminiTurnEvents, HookRefusals, parsedStreamLine, turnTokens } from "./gemini-events.js";

const SESSION = { mcpServerNames: [], shell: "Bash" } as const;

function played(lines: readonly string[], refusals = new HookRefusals()) {
  const events = new GeminiTurnEvents(SESSION, refusals);
  const reported: SessionEvent[] = [];
  for (const line of lines) {
    const event = parsedStreamLine(line);
    if (event !== undefined) reported.push(...events.of(event));
  }
  reported.push(...events.rest());
  return { reported, ending: events.ending };
}

describe("parsedStreamLine", () => {
  it("reads the CLI's events and leaves out anything else it printed", () => {
    expect(parsedStreamLine('{"type":"init","session_id":"s"}')).toEqual({
      type: "init",
      session_id: "s",
    });
    expect(parsedStreamLine("Loaded cached credentials.")).toBeUndefined();
    expect(parsedStreamLine('{"type":"other"}')).toBeUndefined();
    expect(parsedStreamLine("")).toBeUndefined();
  });
});

describe("GeminiTurnEvents", () => {
  it("joins the model's deltas into one text before each call, and names calls as the rules judge them", () => {
    const refusals = new HookRefusals();
    refusals.refused(
      "run_shell_command",
      { command: "touch ran.txt", description: "Writes ran.txt" },
      "Refused by The Office: this session runs read-only commands only.",
    );

    const { reported } = played(TURN_WITH_A_REFUSAL, refusals);

    expect(reported).toEqual([
      { kind: "text", text: "I'll read it first.", withinToolCall: undefined },
      {
        kind: "tool-call",
        callId: "read_file__call_1",
        tool: "Read",
        officeTool: false,
        input: { file_path: "README.md" },
        withinToolCall: undefined,
      },
      {
        kind: "tool-result",
        callId: "read_file__call_1",
        text: "",
        isError: false,
        withinToolCall: undefined,
      },
      {
        kind: "tool-call",
        callId: "run_shell_command__call_2",
        tool: "Bash",
        officeTool: false,
        input: { command: "touch ran.txt", description: "Writes ran.txt" },
        withinToolCall: undefined,
      },
      {
        kind: "tool-refused",
        callId: "run_shell_command__call_2",
        tool: "Bash",
        reason: "Refused by The Office: this session runs read-only commands only.",
        refusedBy: "office-rules",
      },
      {
        kind: "tool-result",
        callId: "run_shell_command__call_2",
        text: "Refused by The Office: this session runs read-only commands only.",
        isError: true,
        withinToolCall: undefined,
      },
      { kind: "text", text: "The command was refused.", withinToolCall: undefined },
    ]);
  });

  it("reports a failed call the hook didn't refuse as a failed result alone", () => {
    const { reported } = played(TURN_WITH_A_REFUSAL);

    expect(reported.some((event) => event.kind === "tool-refused")).toBe(false);
  });

  it("ends with the turn's tokens, the cached ones apart", () => {
    expect(played(TURN_WITH_A_REFUSAL).ending).toEqual({
      succeeded: true,
      resultGiven: true,
      usage: { input: 500, output: 110, cacheRead: 2000, cacheCreation: 0 },
      errors: [],
    });
  });

  it("fails a turn the quota refused, showing Google's words", () => {
    const { ending } = played(QUOTA_REFUSAL);

    expect(ending.succeeded).toBe(false);
    expect(ending.errors[0]).toContain("Please retry in 58.5s");
  });

  it("fails a turn the CLI said went wrong in an error event", () => {
    expect(played(EMPTY_ANSWER).ending).toMatchObject({
      succeeded: false,
      errors: ["The model returned an empty response."],
    });
  });

  it("tells an output with no result apart", () => {
    expect(played(TURN_WITH_A_REFUSAL.slice(0, 4)).ending.resultGiven).toBe(false);
  });
});

describe("turnTokens", () => {
  it("counts nothing for a turn with no stats", () => {
    expect(turnTokens(undefined)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  });
});
