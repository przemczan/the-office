import type { Decision } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  WAITS_FOR_ITS_INITIATIVE,
  needsYouClearWords,
  needsYouSummary,
  waitingOnYou,
} from "./needs-you-words.ts";

function decisionPutTo(putTo: string | null): Decision {
  return {
    id: crypto.randomUUID(),
    threadId: "thread",
    taskId: "task",
    roleKey: "planner",
    question: "Which one?",
    context: "",
    options: ["This", "That"],
    recommendation: { option: 0, reason: "It is smaller." },
    attachmentIds: [],
    putTo,
    passedOn: [],
    askedAt: "2026-11-04T10:00:00.000Z",
    answer: null,
    answeredAt: null,
    answeredBy: null,
    atUsersRequest: null,
  };
}

describe("waitingOnYou", () => {
  it("leaves out a Decision waiting on a Consultant", () => {
    const onYou = decisionPutTo(null);
    expect(waitingOnYou([onYou, decisionPutTo("developer")])).toEqual([onYou]);
  });
});

describe("needsYouSummary", () => {
  it("counts the Decisions waiting on the user", () => {
    expect(needsYouSummary([decisionPutTo(null)], false)).toBe("1 Decision");
    expect(needsYouSummary([decisionPutTo(null), decisionPutTo(null)], false)).toBe("2 Decisions");
  });

  it("names those waiting on a Consultant apart", () => {
    expect(needsYouSummary([decisionPutTo(null), decisionPutTo("developer")], false)).toBe(
      "1 Decision · 1 waiting on a Consultant",
    );
    expect(needsYouSummary([decisionPutTo("developer")], false)).toBe("1 waiting on a Consultant");
  });

  it("names the Gate after the Decisions", () => {
    expect(needsYouSummary([], true)).toBe("a Gate");
    expect(needsYouSummary([decisionPutTo(null), decisionPutTo("developer")], true)).toBe(
      "1 Decision · a Gate · 1 waiting on a Consultant",
    );
  });
});

describe("needsYouClearWords", () => {
  const NOTHING = "Nothing needs you right now. You'll see it here first.";

  it("says a Done Task is done", () => {
    expect(needsYouClearWords("done", false)).toBe("Nothing needs you: this Task is Done.");
  });

  it("says a Dropped Task was dropped", () => {
    expect(needsYouClearWords("dropped", false)).toBe("This Task was dropped.");
    expect(needsYouClearWords("shaping", false)).toBe(WAITS_FOR_ITS_INITIATIVE);
  });

  it("leaves a Ready Task's Start to the user", () => {
    expect(needsYouClearWords("ready", false)).toBe(
      "Ready: start it when you want; nothing starts by itself.",
    );
  });

  it.each(["backlog", "in-progress", "paused"] as const)(
    "says the card will show what comes on a Task in %s",
    (state) => {
      expect(needsYouClearWords(state, false)).toBe(NOTHING);
    },
  );

  it("has nothing to ask of a queued Task, which starts when its turn comes", () => {
    expect(needsYouClearWords("ready", true)).toBe(NOTHING);
  });
});
