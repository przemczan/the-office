import { describe, expect, it } from "vitest";
import {
  codexTokens,
  completedItemEvents,
  itemCalls,
  outputReader,
  rateLimitEvent,
  refusalEvents,
  tokensBefore,
  tokensSince,
  turnEnding,
} from "./codex-events.js";
import type {
  CodexCommandExecutionItem,
  CodexFileChangeItem,
  CodexMcpToolCallItem,
  CodexTokenUsage,
} from "./codex-protocol.js";

const NOW = new Date("2026-11-17T12:00:00Z");

function command(overrides: Partial<CodexCommandExecutionItem> = {}): CodexCommandExecutionItem {
  return {
    type: "commandExecution",
    id: "call-1",
    command: "/bin/bash -lc 'ls -la src'",
    cwd: "/work",
    status: "inProgress",
    ...overrides,
  };
}

function mcpCall(overrides: Partial<CodexMcpToolCallItem> = {}): CodexMcpToolCallItem {
  return {
    type: "mcpToolCall",
    id: "call-9",
    server: "office",
    tool: "note",
    status: "inProgress",
    arguments: { word: "tangerine" },
    ...overrides,
  };
}

const FILE_CHANGE: CodexFileChangeItem = {
  type: "fileChange",
  id: "patch-1",
  status: "completed",
  changes: [
    { path: "/work/new.txt", kind: { type: "add" }, diff: "hi\n" },
    { path: "/work/old.txt", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@" },
    { path: "/work/gone.txt", kind: { type: "delete" }, diff: "" },
  ],
};

function breakdown(input: number, cached: number, output: number): CodexTokenUsage {
  return {
    totalTokens: input + output,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: 0,
  };
}

describe("Codex's items as the port's events", () => {
  it("reports a command as a call of the system's shell with the command line its wrapper runs", () => {
    expect(itemCalls(command(), "Bash")).toEqual([
      { callId: "call-1", tool: "Bash", officeTool: false, input: { command: "ls -la src" } },
    ]);
    expect(itemCalls(command({ command: "Get-ChildItem" }), "PowerShell")).toEqual([
      {
        callId: "call-1",
        tool: "PowerShell",
        officeTool: false,
        input: { command: "Get-ChildItem" },
      },
    ]);
  });

  it("answers a command with its output, an error after its exit code when it failed", () => {
    expect(
      completedItemEvents(
        command({ status: "completed", aggregatedOutput: "a\nb\n", exitCode: 0 }),
      ),
    ).toEqual([
      {
        kind: "tool-result",
        callId: "call-1",
        text: "a\nb\n",
        isError: false,
        withinToolCall: undefined,
      },
    ]);
    expect(
      completedItemEvents(
        command({ status: "failed", aggregatedOutput: "no such file", exitCode: 2 }),
      ),
    ).toMatchObject([{ text: "Exit code 2\nno such file", isError: true }]);
    expect(completedItemEvents(command({ status: "declined" }))).toMatchObject([
      { text: "The command was declined.", isError: true },
    ]);
  });

  it("reports a file change as a Write of each new file and an Edit of each other, one call per path", () => {
    const calls = itemCalls(FILE_CHANGE, "Bash");

    expect(calls.map(({ callId, tool, input }) => ({ callId, tool, input }))).toEqual([
      { callId: "patch-1", tool: "Write", input: { file_path: "/work/new.txt", diff: "hi\n" } },
      {
        callId: "patch-1#2",
        tool: "Edit",
        input: { file_path: "/work/old.txt", diff: "@@ -1 +1 @@" },
      },
      { callId: "patch-1#3", tool: "Edit", input: { file_path: "/work/gone.txt", diff: "" } },
    ]);
    expect(completedItemEvents(FILE_CHANGE)).toMatchObject([
      { callId: "patch-1", text: "The file /work/new.txt was written.", isError: false },
      { callId: "patch-1#2", text: "The file /work/old.txt was changed.", isError: false },
      { callId: "patch-1#3", text: "The file /work/gone.txt was removed.", isError: false },
    ]);
    expect(completedItemEvents({ ...FILE_CHANGE, status: "declined" })).toMatchObject([
      { isError: true },
      { isError: true },
      { isError: true },
    ]);
  });

  it("reports an Office tool by its own name, Skill as Claude Code's, and another server's tool by its MCP name", () => {
    expect(itemCalls(mcpCall(), "Bash")).toEqual([
      { callId: "call-9", tool: "note", officeTool: true, input: { word: "tangerine" } },
    ]);
    expect(
      itemCalls(mcpCall({ tool: "Skill", arguments: { skill: "office:review" } }), "Bash"),
    ).toEqual([
      { callId: "call-9", tool: "Skill", officeTool: false, input: { skill: "office:review" } },
    ]);
    expect(itemCalls(mcpCall({ server: "fake", tool: "echo", arguments: null }), "Bash")).toEqual([
      { callId: "call-9", tool: "mcp__fake__echo", officeTool: false, input: {} },
    ]);
  });

  it("answers an MCP tool's call with its text, and a failed one with its error", () => {
    expect(
      completedItemEvents(
        mcpCall({
          status: "completed",
          result: {
            content: [
              { type: "text", text: "Noted." },
              { type: "image", data: "…" },
            ],
          },
        }),
      ),
    ).toMatchObject([{ callId: "call-9", text: "Noted.\n[image]", isError: false }]);
    expect(
      completedItemEvents(mcpCall({ status: "failed", error: { message: "declined" } })),
    ).toMatchObject([{ text: "declined", isError: true }]);
    expect(
      completedItemEvents(
        mcpCall({
          status: "completed",
          result: { content: [{ type: "text", text: "Not allowed." }], isError: true },
        }),
      ),
    ).toMatchObject([{ text: "Not allowed.", isError: true }]);
  });

  it("reports the Agent's message as its text, and nothing of an item it doesn't read", () => {
    expect(completedItemEvents({ type: "agentMessage", id: "m", text: "done" })).toEqual([
      { kind: "text", text: "done", withinToolCall: undefined },
    ]);
    expect(completedItemEvents({ type: "agentMessage", id: "m", text: "  " })).toEqual([]);
    expect(completedItemEvents({ type: "other", itemType: "reasoning", id: "r" })).toEqual([]);
    expect(itemCalls({ type: "other", itemType: "reasoning", id: "r" }, "Bash")).toEqual([]);
  });

  it("reports a refusal by the Office rules with the error result the Agent reads", () => {
    const refusal = {
      callId: "call-1",
      tool: "Write",
      input: { file_path: "/work/notes.txt" },
      reason: "Not allowed in this session: editing files.",
    };

    expect(refusalEvents("call-1", refusal)).toEqual([
      {
        kind: "tool-refused",
        callId: "call-1",
        tool: "Write",
        reason: "Not allowed in this session: editing files.",
        refusedBy: "office-rules",
      },
      {
        kind: "tool-result",
        callId: "call-1",
        text: "Not allowed in this session: editing files.",
        isError: true,
        withinToolCall: undefined,
      },
    ]);
  });
});

describe("Codex's tokens", () => {
  it("counts cached input as cache reads, and a turn's tokens as what the thread's total grew by", () => {
    expect(codexTokens(breakdown(1000, 600, 50))).toEqual({
      input: 400,
      output: 50,
      cacheRead: 600,
      cacheCreation: 0,
    });
    const before = tokensBefore(breakdown(1500, 900, 80), breakdown(500, 300, 30));
    expect(before).toEqual({ input: 400, output: 50, cacheRead: 600, cacheCreation: 0 });
    expect(tokensSince(before, codexTokens(breakdown(2600, 1700, 120)))).toEqual({
      input: 500,
      output: 70,
      cacheRead: 1100,
      cacheCreation: 0,
    });
  });
});

describe("a Codex turn's end", () => {
  const turn = { id: "turn-1", error: null } as const;

  it("ends as the app-server says, a failure in its words", () => {
    expect(turnEnding({ ...turn, status: "completed" }, undefined, NOW)).toEqual({
      outcome: "completed",
      errors: [],
    });
    expect(turnEnding({ ...turn, status: "interrupted" }, undefined, NOW)).toEqual({
      outcome: "interrupted",
      errors: [],
    });
    expect(
      turnEnding(
        {
          ...turn,
          status: "failed",
          error: {
            message: "stream disconnected",
            codexErrorInfo: "other",
            additionalDetails: "retry",
          },
        },
        undefined,
        NOW,
      ),
    ).toEqual({ outcome: "failed", errors: ["stream disconnected retry"] });
  });

  it("ends a turn refused for a used-up usage window as such, naming the window and its reset", () => {
    const resetsAt = Date.parse("2026-11-20T00:00:00Z") / 1000;

    expect(
      turnEnding(
        {
          ...turn,
          status: "failed",
          error: { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded" },
        },
        {
          limitId: "codex",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt },
          secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: resetsAt + 1000 },
        },
        NOW,
      ),
    ).toEqual({
      outcome: "usage-window-used-up",
      errors: ["You've hit your usage limit."],
      usedUpWindow: { window: "five-hour", resetsAt: new Date(resetsAt * 1000), resetGiven: true },
    });
    expect(
      turnEnding(
        {
          ...turn,
          status: "failed",
          error: { message: "limit", codexErrorInfo: "usageLimitExceeded" },
        },
        undefined,
        NOW,
      ).usedUpWindow,
    ).toEqual({
      window: "unknown",
      resetsAt: new Date(NOW.getTime() + 3_600_000),
      resetGiven: false,
    });
  });

  it("signals a rate-limit reading, rejected once a limit is reached", () => {
    const resetsAt = Date.parse("2026-12-01T00:00:00Z") / 1000;

    expect(
      rateLimitEvent({
        limitId: "codex",
        primary: { usedPercent: 12, windowDurationMins: 43_200, resetsAt },
      }),
    ).toEqual({
      kind: "rate-limit",
      status: "allowed",
      window: "codex",
      resetsAt: new Date(resetsAt * 1000),
    });
    expect(
      rateLimitEvent({ rateLimitReachedType: "primary", primary: { usedPercent: 100 } }),
    ).toMatchObject({ status: "rejected" });
  });
});

describe("a Codex turn's output", () => {
  const read = outputReader({
    type: "object",
    properties: { word: { type: "string" } },
    required: ["word"],
    additionalProperties: false,
  });

  it("takes the turn's last answer as JSON that fits the schema", () => {
    expect(read('{"word":"ready"}')).toEqual({ fits: true, output: { word: "ready" } });
  });

  it("refuses an answer that isn't JSON, doesn't fit, or isn't there", () => {
    expect(read("ready")).toMatchObject({
      fits: false,
      problem: expect.stringContaining("isn't JSON"),
    });
    expect(read('{"word":1}')).toMatchObject({
      fits: false,
      problem: expect.stringContaining("doesn't fit its output schema"),
    });
    expect(read(undefined)).toMatchObject({ fits: false });
  });
});
