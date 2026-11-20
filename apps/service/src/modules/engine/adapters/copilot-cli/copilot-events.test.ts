import { describe, expect, it } from "vitest";
import { CopilotTurnEvents, type CopilotTurnOptions } from "./copilot-events.js";
import {
  answer,
  copilotEvent,
  idle,
  READ_A_FILE_TURN,
  toolDenied,
  toolDone,
  toolStart,
  usage,
  userMessage,
} from "./copilot-events.fixtures.js";
import type { CopilotEvent } from "./copilot-runtime.js";
import type { SessionEvent } from "../../ports/session-events.js";

function mapper(overrides: Partial<CopilotTurnOptions> = {}): CopilotTurnEvents {
  return new CopilotTurnEvents({
    session: { officeToolNames: new Set(["office_status"]), mcpServerNames: ["project-tools"] },
    hasOutputSchema: false,
    messageIdOf: (data) =>
      data.clientTurnId === undefined ? undefined : `port-${data.clientTurnId}`,
    ...overrides,
  });
}

function run(events: readonly CopilotEvent[], overrides?: Partial<CopilotTurnOptions>) {
  const turn = mapper(overrides);
  return { turn, events: events.flatMap((event) => turn.map(event)) };
}

function ended(events: readonly SessionEvent[]) {
  const end = events.find((event) => event.kind === "turn-ended");
  if (end?.kind !== "turn-ended") throw new Error("no turn end");
  return end;
}

describe("a turn that reads a file", () => {
  const { turn, events } = run(READ_A_FILE_TURN);

  it("writes each whole message once, never its deltas", () => {
    expect(events.filter((event) => event.kind === "text").map((event) => event.text)).toEqual([
      "Let me look.",
      "The file exports a.",
    ]);
  });

  it("shows the call as Read and its result", () => {
    expect(events).toContainEqual({
      kind: "tool-call",
      callId: "call-1",
      tool: "Read",
      officeTool: false,
      input: { file_path: "/work/a.ts" },
      withinToolCall: undefined,
    });
    expect(events).toContainEqual({
      kind: "tool-result",
      callId: "call-1",
      text: "export const a = 1;",
      isError: false,
      withinToolCall: undefined,
    });
  });

  it("counts tokens as they come, with the context each answer read", () => {
    const soFar = events
      .filter((event) => event.kind === "turn-tokens")
      .map((event) => event.soFar);
    expect(soFar[0]).toEqual({ input: 900, output: 40, cacheRead: 3000, cacheCreation: 100 });
    expect(soFar[1]).toEqual({ input: 1900, output: 60, cacheRead: 6100, cacheCreation: 100 });
    expect(
      events.filter((event) => event.kind === "context-read").map((event) => event.tokens),
    ).toEqual([4000, 4100]);
  });

  it("ends completed with the turn's tokens and the message it took", () => {
    expect(ended(events)).toEqual({
      kind: "turn-ended",
      outcome: "completed",
      consumedMessageIds: ["port-turn-1"],
      usage: { input: 1900, output: 60, cacheRead: 6100, cacheCreation: 100 },
      sessionCostUsd: 0,
      output: undefined,
      errors: [],
    });
  });

  it("keeps the context for readContextUsage", () => {
    expect(turn.contextUsage()).toEqual({ tokens: 4040, limit: 128000 });
  });
});

describe("turns after one another", () => {
  it("starts each turn's tokens and messages anew", () => {
    const { events } = run([
      userMessage("a"),
      usage(10, 1),
      idle(),
      userMessage("b"),
      userMessage("c"),
      usage(20, 2),
      idle(),
    ]);
    const ends = events.filter((event) => event.kind === "turn-ended");
    expect(ends.map((end) => end.consumedMessageIds)).toEqual([["port-a"], ["port-b", "port-c"]]);
    expect(ends[1]?.usage).toEqual({ input: 20, output: 2, cacheRead: 0, cacheCreation: 0 });
  });

  it("leaves out a message the session didn't send", () => {
    const { events } = run([copilotEvent("user.message", { content: "note" }), idle()]);
    expect(ended(events).consumedMessageIds).toEqual([]);
  });
});

describe("tool calls", () => {
  it("shows an Office tool by its own name, flagged", () => {
    const { events } = run([toolStart("c", "office_status", { a: 1 })]);
    expect(events[0]).toMatchObject({ tool: "office_status", officeTool: true, input: { a: 1 } });
  });

  it("shows an MCP tool as Claude Code names it", () => {
    const { events } = run([toolStart("c", "project-tools-read_code_word", {})]);
    expect(events[0]).toMatchObject({ tool: "mcp__project-tools__read_code_word" });
  });

  it("shows a call the rules will refuse as the runtime named it", () => {
    const { events } = run([toolStart("c", "task", { prompt: "x" })]);
    expect(events[0]).toMatchObject({ tool: "task", officeTool: false, input: { prompt: "x" } });
  });

  it("ends a denied call with an error result and no refusal of its own", () => {
    const { events } = run([
      toolStart("c", "bash", { command: "rm -rf /" }),
      toolDenied("c", "no"),
    ]);
    expect(events.map((event) => event.kind)).toEqual(["tool-call", "tool-result"]);
    expect(events[1]).toMatchObject({
      text: "Denied by preToolUse hook: no",
      isError: true,
    });
  });
});

describe("how a turn ends", () => {
  it("is interrupted by an abort", () => {
    const { events } = run([
      userMessage("a"),
      copilotEvent("abort", { reason: "user_initiated" }),
      idle(),
    ]);
    expect(ended(events)).toMatchObject({ outcome: "interrupted", errors: [] });
  });

  it("is interrupted when the idle says it was aborted", () => {
    expect(ended(run([idle(true)]).events).outcome).toBe("interrupted");
  });

  it("fails on a session error, in its words", () => {
    const { events } = run([
      copilotEvent("session.error", { errorType: "model", message: "Model is not available" }),
      idle(),
    ]);
    expect(ended(events)).toMatchObject({ outcome: "failed", errors: ["Model is not available"] });
  });

  it("replaces Server values in the words it reports", () => {
    const { events } = run(
      [copilotEvent("session.error", { errorType: "x", message: "bad token s3cret" }), idle()],
      { redact: (text) => text.replace("s3cret", "***") },
    );
    expect(ended(events).errors).toEqual(["bad token ***"]);
  });

  it("replaces them in a failed call's words, but leaves a tool's own answer as it is", () => {
    const { events } = run(
      [
        toolStart("call-1", "project-tools-show", {}),
        toolDone("call-1", "the value is s3cret"),
        toolStart("call-2", "project-tools-show", {}),
        copilotEvent("tool.execution_complete", {
          toolCallId: "call-2",
          success: false,
          error: { message: "server said s3cret" },
        }),
      ],
      { redact: (text) => text.replace("s3cret", "***") },
    );
    expect(events.filter((event) => event.kind === "tool-result")).toMatchObject([
      { callId: "call-1", text: "the value is s3cret", isError: false },
      { callId: "call-2", text: "server said ***", isError: true },
    ]);
  });
});

describe("an output schema", () => {
  const options = { hasOutputSchema: true };

  it("reads the last answer as the output", () => {
    const { events } = run([answer("working"), answer('{"ok":true}'), idle()], options);
    expect(ended(events)).toMatchObject({ outcome: "completed", output: { ok: true } });
  });

  it("fails a turn whose answer isn't JSON", () => {
    const { events } = run([answer("sorry"), idle()], options);
    expect(ended(events)).toMatchObject({
      outcome: "failed",
      output: undefined,
      errors: ["The turn's answer isn't JSON, as its output schema asks."],
    });
  });

  it("fails a turn with no answer", () => {
    expect(ended(run([idle()], options).events).outcome).toBe("failed");
  });

  it("asks for no answer of an interrupted turn", () => {
    const { events } = run([copilotEvent("abort", { reason: "user_initiated" }), idle()], options);
    expect(ended(events)).toMatchObject({ outcome: "interrupted", errors: [] });
  });
});

const loaded = (servers: object[]) =>
  copilotEvent("session.mcp_servers_loaded", { servers } as never);

describe("MCP servers", () => {
  it("reports a server that failed once, with its reason", () => {
    const { events } = run([
      loaded([
        { name: "docs", status: "connected" },
        { name: "project-tools", status: "failed", error: "spawn ENOENT" },
      ]),
      loaded([{ name: "project-tools", status: "failed", error: "spawn ENOENT" }]),
    ]);
    expect(events).toEqual([
      { kind: "mcp-server-not-started", server: "project-tools", reason: "spawn ENOENT" },
    ]);
  });

  it("gives no reason when the runtime gives none", () => {
    const { events } = run([loaded([{ name: "docs", status: "failed" }])]);
    expect(events).toEqual([{ kind: "mcp-server-not-started", server: "docs", reason: undefined }]);
  });
});

describe("another agent's events", () => {
  it("leaves out its messages, calls and idle, but counts its tokens", () => {
    const { events } = run([
      answer("sub", "agent-1"),
      copilotEvent("session.idle", {}, "agent-1"),
      usage(5, 5, 0, 0, "agent-1"),
      idle(),
    ]);
    expect(events.map((event) => event.kind)).toEqual(["turn-tokens", "turn-ended"]);
    expect(ended(events).usage.output).toBe(5);
  });

  it("makes no Process of a change in background tasks", () => {
    expect(run([copilotEvent("session.background_tasks_changed", {})]).events).toEqual([]);
  });
});
