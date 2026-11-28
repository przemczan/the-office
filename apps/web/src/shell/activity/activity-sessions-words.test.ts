import { describe, expect, it } from "vitest";
import { minutesAgo, NOW, sessionOf } from "./activity.fixtures.ts";
import {
  sessionKindWords,
  sessionQuestionWords,
  sessionStateWords,
  sessionTimeWords,
} from "./activity-sessions-words.ts";

describe("a session's state", () => {
  it("is Working while its Agent takes a turn", () => {
    expect(sessionStateWords(sessionOf())).toEqual({ label: "Working", tone: "info" });
  });

  it.each([
    [{ kind: "decision", question: "Which one?" }, "Waiting on you"],
    [{ kind: "consultant", question: null }, "Waiting on a Consultant"],
    [{ kind: "reply", question: null }, "Reply waiting"],
  ] as const)("says what it waits on: %j", (waitingOn, label) => {
    expect(sessionStateWords(sessionOf({ state: "waiting", waitingOn }))).toEqual({
      label,
      tone: "warning",
    });
  });

  it("names the Gate it waits at", () => {
    const gate = sessionOf({
      state: "waiting",
      sessionKind: "gate",
      stageName: "Approve",
      waitingOn: { kind: "gate", question: null },
    });

    expect(sessionStateWords(gate).label).toBe("Waiting at Approve");
  });
});

describe("what a session is", () => {
  it("is its Stage, else its kind", () => {
    expect(sessionKindWords(sessionOf())).toBe("Implement");
    expect(sessionKindWords(sessionOf({ sessionKind: "consultation", stageName: null }))).toBe(
      "Consultation",
    );
    expect(sessionKindWords(sessionOf({ sessionKind: "thread", stageName: null }))).toBe(
      "Planning",
    );
    expect(sessionKindWords(sessionOf({ sessionKind: "chat", stageName: null }))).toBe("Chat");
  });
});

describe("a session's time and question", () => {
  it("says how long it has been in its state", () => {
    expect(sessionTimeWords(sessionOf({ since: minutesAgo(12) }), NOW)).toBe("Working for 12 min");
    expect(
      sessionTimeWords(
        sessionOf({ state: "waiting", waitingOn: { kind: "reply", question: null } }),
        NOW,
      ),
    ).toBe("Waiting for 18 min");
  });

  it("gives a Decision's question, and nothing otherwise", () => {
    const asking = sessionOf({
      state: "waiting",
      waitingOn: { kind: "decision", question: "Which one?" },
    });

    expect(sessionQuestionWords(asking)).toBe("Which one?");
    expect(sessionQuestionWords(sessionOf())).toBeUndefined();
  });
});
