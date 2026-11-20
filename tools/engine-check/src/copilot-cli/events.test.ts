import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEvent } from "@microsoft/copilot-sdk";
import {
  eventKinds,
  fieldNames,
  indexOfType,
  lastAnswer,
  tokenUsage,
  toolStarts,
} from "./events.ts";

/** A minimal event of `type`: only the fields these helpers read. */
function event(type: string, data: object = {}, agentId?: string): SessionEvent {
  return { type, data, ...(agentId === undefined ? {} : { agentId }) } as unknown as SessionEvent;
}

test("eventKinds lists each kind once, sorted, without streaming deltas", () => {
  const events = [
    event("session.idle"),
    event("assistant.message_delta"),
    event("assistant.message"),
    event("assistant.reasoning_delta"),
    event("assistant.message"),
  ];
  assert.deepEqual(eventKinds(events), ["assistant.message", "session.idle"]);
});

test("toolStarts gives each start's tool, input and whether a Sub-agent made it", () => {
  const events = [
    event("tool.execution_start", { toolName: "bash", arguments: { command: "ls" } }),
    event("tool.execution_complete", { toolCallId: "1" }),
    event("tool.execution_start", { toolName: "view", arguments: { path: "a" } }, "agent-1"),
  ];
  assert.deepEqual(toolStarts(events), [
    { toolName: "bash", subAgent: false, input: { command: "ls" } },
    { toolName: "view", subAgent: true, input: { path: "a" } },
  ]);
});

test("tokenUsage sums every assistant.usage, missing counts as 0", () => {
  const events = [
    event("assistant.usage", {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 50,
      cacheWriteTokens: 5,
    }),
    event("assistant.message"),
    event("assistant.usage", { inputTokens: 20 }),
  ];
  assert.deepEqual(tokenUsage(events), { input: 120, output: 10, cacheRead: 50, cacheCreation: 5 });
});

test("lastAnswer is the root agent's last message, a Sub-agent's left out", () => {
  const events = [
    event("assistant.message", { content: "first" }),
    event("assistant.message", { content: "second" }),
    event("assistant.message", { content: "from the sub-agent" }, "agent-1"),
  ];
  assert.equal(lastAnswer(events), "second");
  assert.equal(lastAnswer([]), "");
});

test("indexOfType finds the first event of a type from an index, -1 when none", () => {
  const events = [event("session.idle"), event("user.message"), event("session.idle")];
  assert.equal(indexOfType(events, "session.idle"), 0);
  assert.equal(indexOfType(events, "session.idle", 1), 2);
  assert.equal(indexOfType(events, "abort"), -1);
});

test("fieldNames sorts an object's fields and gives none for anything else", () => {
  assert.deepEqual(fieldNames({ b: 1, a: 2 }), ["a", "b"]);
  assert.deepEqual(fieldNames([1, 2]), []);
  assert.deepEqual(fieldNames(null), []);
  assert.deepEqual(fieldNames("text"), []);
});
