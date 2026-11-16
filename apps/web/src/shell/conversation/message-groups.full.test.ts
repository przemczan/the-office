import type { Message } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  groupedMessages,
  withDayLines,
  withLogLines,
  type LogLine,
  type MessageGroup,
} from "./message-groups.ts";

const at = "2026-11-04T10:00:00.000Z";

function fromPerson(id: string, roleKey = "developer"): Message {
  return { id, at, kind: "person", roleKey, text: id };
}

function fromUser(id: string, handoverNoteFrom: string | null = null): Message {
  return {
    id,
    at,
    kind: "user",
    text: id,
    delivery: "delivered",
    writtenBy: null,
    handoverNoteFrom,
    openPage: null,
    images: [],
  };
}

function writtenBy(id: string, userId: string): Message {
  return { ...fromUser(id), writtenBy: { userId, name: userId } } as Message;
}

function toolCall(id: string): Message {
  return { id, at, kind: "tool-activity", roleKey: "developer", tool: "Read", summary: "" };
}

function linkCard(id: string): Message {
  return {
    id,
    at,
    kind: "link-card",
    roleKey: "office-manager",
    to: { roleKey: "developer", letGo: false },
    taskId: null,
    note: "",
  };
}

/** Each group as its kind and its messages' ids. */
function shape(groups: readonly MessageGroup[]): readonly (readonly string[])[] {
  return groups.map((group) =>
    group.kind === "alone"
      ? [group.kind, group.message.id]
      : [group.kind, ...group.messages.map(({ id }) => id)],
  );
}

describe("groupedMessages", () => {
  it("joins one author's neighbouring messages into a turn", () => {
    const groups = groupedMessages([
      fromUser("u1"),
      fromUser("u2"),
      fromPerson("p1"),
      fromPerson("p2"),
      fromPerson("p3"),
      fromUser("u3"),
    ]);
    expect(shape(groups)).toEqual([
      ["turn", "u1", "u2"],
      ["turn", "p1", "p2", "p3"],
      ["turn", "u3"],
    ]);
  });

  it("keeps two people's messages apart", () => {
    const groups = groupedMessages([fromPerson("a", "developer"), fromPerson("b", "reviewer")]);
    expect(shape(groups)).toEqual([
      ["turn", "a"],
      ["turn", "b"],
    ]);
  });

  it("keeps two users' messages apart, and joins one user's", () => {
    const groups = groupedMessages([
      writtenBy("a", "ada"),
      writtenBy("b", "ada"),
      writtenBy("c", "ann"),
    ]);
    expect(shape(groups)).toEqual([
      ["turn", "a", "b"],
      ["turn", "c"],
    ]);
  });

  it("keeps a Handover note the user passed on out of the user's own turn", () => {
    const groups = groupedMessages([
      fromUser("said"),
      fromUser("note", "cto"),
      fromUser("other note", "cto"),
      fromUser("said again"),
    ]);
    expect(shape(groups)).toEqual([
      ["turn", "said"],
      ["turn", "note"],
      ["turn", "other note"],
      ["turn", "said again"],
    ]);
  });

  it("lets a card in a run of messages stand alone, in its place, ending the turn", () => {
    const groups = groupedMessages([fromPerson("before"), linkCard("card"), fromPerson("after")]);
    expect(shape(groups)).toEqual([
      ["turn", "before"],
      ["alone", "card"],
      ["turn", "after"],
    ]);
  });

  it("ends a turn at a tool call and joins neighbouring tool calls into one block", () => {
    const groups = groupedMessages([
      fromPerson("before"),
      toolCall("t1"),
      toolCall("t2"),
      fromPerson("after"),
      toolCall("t3"),
    ]);
    expect(shape(groups)).toEqual([
      ["turn", "before"],
      ["tool-calls", "t1", "t2"],
      ["turn", "after"],
      ["tool-calls", "t3"],
    ]);
  });

  it("keeps a group's id as it grows, so the list doesn't redraw it", () => {
    const first = groupedMessages([fromPerson("p1")]);
    const grown = groupedMessages([fromPerson("p1"), fromPerson("p2")]);
    expect(grown[0]?.id).toBe(first[0]?.id);
  });

  it("has nothing to group in an empty log", () => {
    expect(groupedMessages([])).toEqual([]);
  });
});

function atMinute(minute: number): string {
  return `2026-11-03T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

function said(id: string, minute: number): Message {
  return { ...fromPerson(id), at: atMinute(minute) };
}

function cardAt(id: string, minute: number): Message {
  return { ...linkCard(id), at: atMinute(minute) };
}

function line(id: string, minute: number): LogLine {
  return { id, at: atMinute(minute), words: id };
}

function onDay(id: string, day: number): Message {
  return { ...fromPerson(id), at: new Date(2026, 10, day, 12).toISOString() };
}

describe("withDayLines", () => {
  const now = new Date(2026, 10, 5, 12);
  const shown = (messages: readonly Message[]): readonly string[] =>
    withDayLines(withLogLines(groupedMessages(messages), []), now).map((piece) =>
      piece.kind === "line" ? piece.line.words : piece.id,
    );

  it("adds nothing to a Thread of one day", () => {
    expect(shown([onDay("first", 3), onDay("second", 3)])).toEqual(["first"]);
  });

  it("opens every day, the first too, in the words of the day", () => {
    expect(shown([onDay("old", 2), onDay("before", 4), onDay("now", 5)])).toEqual([
      "2 Nov",
      "old",
      "Yesterday",
      "before",
      "Today",
      "now",
    ]);
  });

  it("splits one author's turn at midnight, so the day line sits between", () => {
    const turns = groupedMessages([onDay("first", 3), onDay("second", 4)]);
    expect(turns).toHaveLength(2);
  });
});

describe("withLogLines", () => {
  it("puts a line where it happened, and what came after everything at the end", () => {
    const groups = groupedMessages([said("first", 1), cardAt("card", 5), said("second", 9)]);
    const pieces = withLogLines(groups, [line("late", 12), line("run ended", 3)]);
    expect(pieces.map((piece) => (piece.kind === "line" ? piece.line.id : piece.id))).toEqual([
      "first",
      "run ended",
      "card",
      "second",
      "late",
    ]);
  });
});
