import { CAPTURE_IDEA_TOOL, type Message } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { latestToolCall, visibleMessages } from "./message-visibility.ts";

const at = "2026-11-04T10:00:00.000Z";

function toolCall(id: string, tool: string): Message {
  return { at, id, kind: "tool-activity", roleKey: "developer", tool, summary: "a.ts" };
}

const contextLine: Message = {
  at,
  id: "context",
  kind: "context",
  move: "fresh",
  reason: "new-thread",
  contextTokens: 0,
  briefTokens: 10,
  brief: "What the session starts from",
};
const said: Message = { at, id: "said", kind: "person", roleKey: "developer", text: "Done" };
const refused: Message = {
  at,
  id: "refused",
  kind: "refusal",
  roleKey: "developer",
  tool: "Write",
  reason: "Not there",
};
const failed: Message = { at, id: "failed", kind: "failure", reason: "It broke" };
const held: Message = { at, id: "held", kind: "held", heldBy: "pause", text: "Paused here" };
const serverDown: Message = {
  at,
  id: "server",
  kind: "mcp-server-not-started",
  server: "files",
  reason: null,
};

const ids = (messages: readonly Message[]): string[] => messages.map(({ id }) => id);

describe("visibleMessages", () => {
  it("hides tool activity and context lines with Details off", () => {
    const log = [contextLine, toolCall("read", "Read"), said];
    expect(ids(visibleMessages(log, false))).toEqual(["said"]);
  });

  it("shows them with Details on", () => {
    const log = [contextLine, toolCall("read", "Read"), said];
    expect(ids(visibleMessages(log, true))).toEqual(["context", "read", "said"]);
  });

  it("always shows refusals, failures and held lines", () => {
    const log = [refused, failed, serverDown, held];
    expect(ids(visibleMessages(log, false))).toEqual(ids(log));
  });

  it("shows a kind it doesn't know", () => {
    const fromANewerService = { at, id: "new", kind: "not-yet-known" } as unknown as Message;
    expect(ids(visibleMessages([fromANewerService], false))).toEqual(["new"]);
  });

  it.each([true, false])("leaves out a tool call shown as a card, Details %s", (details) => {
    expect(visibleMessages([toolCall("card", CAPTURE_IDEA_TOOL)], details)).toEqual([]);
  });
});

describe("latestToolCall", () => {
  it("is the last tool call, whatever came after it", () => {
    const log = [toolCall("read", "Read"), toolCall("edit", "Edit"), said];
    expect(latestToolCall(log)?.id).toBe("edit");
  });

  it("passes over a tool call shown as a card", () => {
    expect(
      latestToolCall([toolCall("read", "Read"), toolCall("card", CAPTURE_IDEA_TOOL)])?.id,
    ).toBe("read");
  });

  it("is nothing before the first tool call", () => {
    expect(latestToolCall([said])).toBeUndefined();
  });
});
