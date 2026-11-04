import type { Decision } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { needsYouSummary, nothingNeedsYouWords, waitingOnYou } from "./needs-you-words.ts";

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
    expect(needsYouSummary([decisionPutTo(null)])).toBe("1 Decision");
    expect(needsYouSummary([decisionPutTo(null), decisionPutTo(null)])).toBe("2 Decisions");
  });

  it("names those waiting on a Consultant apart", () => {
    expect(needsYouSummary([decisionPutTo(null), decisionPutTo("developer")])).toBe(
      "1 Decision · 1 waiting on a Consultant",
    );
    expect(needsYouSummary([decisionPutTo("developer")])).toBe("1 waiting on a Consultant");
  });
});

describe("nothingNeedsYouWords", () => {
  it("says a Done Task is done", () => {
    expect(nothingNeedsYouWords("done")).toBe("Nothing needs you: this Task is Done.");
  });

  it("says the card will show what comes", () => {
    expect(nothingNeedsYouWords("in-progress")).toBe(
      "Nothing needs you right now. You'll see it here first.",
    );
  });
});
