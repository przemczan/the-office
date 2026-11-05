import type { Message } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  newMessagesWords,
  NO_NEW_MESSAGES,
  withArrivals,
  withArrivalsByThread,
  withNewMessagesRead,
  type NewMessages,
  type WatchedLog,
} from "./new-messages.ts";

const AT = "2026-11-04T10:00:00.000Z";

function said(id: string): Message {
  return { kind: "person", id, at: AT, roleKey: "developer", text: id };
}

function toolLine(id: string): Message {
  return { kind: "tool-activity", id, at: AT, roleKey: "developer", tool: "Read", summary: id };
}

const log = (
  messages: readonly Message[] | undefined,
  inView = false,
  threadId = "implement",
): WatchedLog => ({ threadId, messages, inView });

/** A state that has seen `messages` in the Thread. */
function watching(messages: readonly Message[]): NewMessages {
  return withArrivals(NO_NEW_MESSAGES, [log(messages)], false);
}

describe("withArrivalsByThread", () => {
  const seen = withArrivalsByThread(
    new Map(),
    [log([said("a")], false, "jan"), log([said("b")], true, "adam")],
    false,
  );

  it("counts what lands out of view in each Thread on its own", () => {
    const now = withArrivalsByThread(
      seen,
      [log([said("a"), said("c"), said("d")], false, "jan"), log([said("b")], true, "adam")],
      false,
    );
    expect(now.get("jan")?.count).toBe(2);
    expect(now.get("adam")?.count).toBe(0);
  });

  it("reads one Thread and leaves another's count", () => {
    const landed = withArrivalsByThread(
      seen,
      [log([said("a"), said("c")], false, "jan"), log([said("b"), said("d")], false, "adam")],
      false,
    );
    const now = withArrivalsByThread(
      landed,
      [log([said("a"), said("c")], true, "jan"), log([said("b"), said("d")], false, "adam")],
      false,
    );
    expect(now.get("jan")?.count).toBe(0);
    expect(now.get("adam")?.count).toBe(1);
  });

  it("gives back what it was given while nothing changed", () => {
    const now = withArrivalsByThread(
      seen,
      [log([said("a")], false, "jan"), log([said("b")], true, "adam")],
      false,
    );
    expect(now).toBe(seen);
  });
});

describe("withArrivals", () => {
  it("counts nothing a Thread already holds when it starts being watched", () => {
    expect(watching([said("a"), said("b")]).count).toBe(0);
  });

  it("counts what lands out of view, with its Thread", () => {
    const now = withArrivals(watching([said("a")]), [log([said("a"), said("b")])], false);
    expect(now).toMatchObject({ count: 1, threadId: "implement" });
  });

  it("adds to what was counted", () => {
    const one = withArrivals(watching([]), [log([said("a")])], false);
    expect(withArrivals(one, [log([said("a"), said("b")])], false).count).toBe(2);
  });

  it("counts nothing that lands in view, and doesn't count it later", () => {
    const seen = withArrivals(watching([]), [log([said("a")], true)], false);
    expect(seen.count).toBe(0);
    expect(withArrivals(seen, [log([said("a")])], false).count).toBe(0);
  });

  it("counts only what shows: a tool line counts with Details on", () => {
    const messages = [said("a"), toolLine("b")];
    expect(withArrivals(watching([]), [log(messages)], false).count).toBe(1);
    expect(withArrivals(watching([]), [log(messages)], true).count).toBe(2);
  });

  it("isn't fooled by the Details switch showing what was hidden", () => {
    const before = watching([toolLine("a")]);
    expect(withArrivals(before, [log([toolLine("a")])], true)).toBe(before);
  });

  it("waits for a log still loading", () => {
    expect(withArrivals(NO_NEW_MESSAGES, [log(undefined)], false)).toBe(NO_NEW_MESSAGES);
  });

  it("names the Thread of the newest when several are watched", () => {
    const before = withArrivals(NO_NEW_MESSAGES, [log([]), log([], false, "planning")], false);
    const now = withArrivals(
      before,
      [log([said("a")]), log([said("b")], false, "planning")],
      false,
    );
    expect(now).toMatchObject({ count: 2, threadId: "planning" });
  });

  it("starts over on a Thread that stopped being watched", () => {
    const left = withArrivals(watching([said("a")]), [], false);
    expect(withArrivals(left, [log([said("a"), said("b")])], false).count).toBe(0);
  });
});

describe("withNewMessagesRead", () => {
  const counted = withArrivals(watching([]), [log([said("a")])], false);

  it("clears the count once the Thread is in view", () => {
    expect(withNewMessagesRead(counted, () => true)).toMatchObject({
      count: 0,
      threadId: undefined,
    });
  });

  it("keeps it while the Thread is out of view, as a folded chapter is", () => {
    expect(withNewMessagesRead(counted, () => false)).toBe(counted);
  });

  it("still knows what was there after clearing", () => {
    const read = withNewMessagesRead(counted, () => true);
    expect(withArrivals(read, [log([said("a")])], false)).toBe(read);
  });
});

describe("newMessagesWords", () => {
  it("says one or many", () => {
    expect(newMessagesWords(1)).toBe("1 new message");
    expect(newMessagesWords(3)).toBe("3 new messages");
  });
});
