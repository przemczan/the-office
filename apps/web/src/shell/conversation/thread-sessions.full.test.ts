import type { ContextMove, ContextReason, Message } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import type { LogPiece } from "./message-groups.ts";
import { piecesBySession, threadSessions } from "./thread-sessions.ts";

const at = "2026-11-01T10:00:00.000Z";

function context(
  id: string,
  move: ContextMove,
  reason: ContextReason,
  contextTokens = 0,
): Extract<Message, { kind: "context" }> {
  return { at, id, kind: "context", move, reason, contextTokens, briefTokens: 3_000, brief: "B" };
}

function said(id: string): Extract<Message, { kind: "person" }> {
  return { at, id, kind: "person", roleKey: "developer", text: id };
}

const alone = (message: Extract<Message, { kind: "context" }>): LogPiece => ({
  kind: "alone",
  id: message.id,
  message,
});

const ids = (messages: readonly Message[]): string[] => messages.map(({ id }) => id);

describe("threadSessions", () => {
  it("keeps a Thread with one session whole, its first context line in it", () => {
    const messages = [context("c1", "fresh", "new-thread"), said("1"), said("2")];

    const sessions = threadSessions(messages);

    expect(sessions).toEqual([{ id: "first", opening: null, messages, endedAtTokens: null }]);
  });

  it("starts a session at each fresh start or hand-off after the first, ended at its size", () => {
    const fresh = context("c2", "fresh", "your-choice", 85_000);
    const handOff = context("c3", "hand-off", "context-full", 0);
    const messages = [
      context("c1", "fresh", "new-thread"),
      said("1"),
      fresh,
      said("2"),
      handOff,
      said("3"),
    ];

    const sessions = threadSessions(messages);

    expect(sessions.map(({ id }) => id)).toEqual(["first", "c2", "c3"]);
    expect(sessions.map(({ opening }) => opening)).toEqual([null, fresh, handOff]);
    expect(sessions.map(({ messages: own }) => ids(own))).toEqual([["c1", "1"], ["2"], ["3"]]);
    // A hand-off's line with no figure leaves the size out.
    expect(sessions.map(({ endedAtTokens }) => endedAtTokens)).toEqual([85_000, null, null]);
  });

  it("splits nothing at a line that continued the session", () => {
    const messages = [
      context("c1", "fresh", "new-thread"),
      said("1"),
      context("c2", "resume", "small-context", 20_000),
      said("2"),
    ];

    expect(threadSessions(messages)).toHaveLength(1);
  });

  it("opens the first session at its first line, even one with a fresh move", () => {
    const messages = [said("0"), context("c1", "fresh", "cache-expired", 48_000), said("1")];

    expect(threadSessions(messages).map(({ messages: own }) => ids(own))).toEqual([
      ["0", "c1", "1"],
    ]);
  });
});

describe("piecesBySession", () => {
  it("shares out the pieces, the opening line left out and the lines before it before it", () => {
    const opening = context("c2", "fresh", "your-choice", 85_000);
    const sessions = threadSessions([
      context("c1", "fresh", "new-thread"),
      said("1"),
      opening,
      said("2"),
    ]);
    const turn = (id: string): LogPiece => ({ kind: "turn", id, messages: [said(id)] });
    const day: LogPiece = { kind: "line", line: { id: "day", at, words: "Today" } };

    const shared = piecesBySession([turn("1"), day, alone(opening), turn("2")], sessions);

    expect(shared.map(({ before, pieces }) => [before, pieces])).toEqual([
      [[], [turn("1")]],
      [[day], [turn("2")]],
    ]);
  });
});
