import { describe, expect, it } from "vitest";
import { oneOptionAnswer, oneWordsAnswer } from "./decision.js";
import { aDecision, THREE_QUESTIONS } from "./decision.fixtures.js";
import { decisionRecordText, withMentionedRecords } from "./mention.js";
import { ANN_LEE } from "./user.fixtures.js";

const TASK_RECORD = "Export CSV (Task 3b1f6f0e)\n\nPlan:\nNo Plan yet.";

describe("a mentioned Decision's record", () => {
  it("asks, with its options and the recommendation, then the Task's record", () => {
    const decision = aDecision();

    expect(decisionRecordText(decision, TASK_RECORD)).toBe(
      [
        `Decision ${decision.id} on the Task ${decision.taskId}, asked 2026-10-25T09:02:00.000Z by the person in the Role planner`,
        "",
        "The export reads every Project; archived ones have no worktree.",
        "",
        "Question 1: Should the export include archived Projects?",
        "Options:",
        "1. Only active Projects",
        "2. Every Project",
        "Recommended: Only active Projects, because Archived Projects have nothing to export.",
        "Not answered yet: it waits on the user.",
        "",
        "The Task's record:",
        "",
        TASK_RECORD,
      ].join("\n"),
    );
  });

  it("says who answered it, who it waits on, and who passed it on", () => {
    const answered = aDecision({
      answer: {
        ...oneWordsAnswer("Active only. "),
        answeredAt: new Date("2026-10-26T10:00:00.000Z"),
        answeredBy: "cto",
      },
    });
    const passedOn = aDecision({
      putTo: "devops",
      passedOn: [{ roleKey: "cto", reason: "Devops owns exports.", passedOnAt: new Date() }],
    });

    expect(decisionRecordText(answered, TASK_RECORD)).toContain(
      "Answered by the person in the Role cto on 2026-10-26T10:00:00.000Z:\n1. Should the export include archived Projects?\n   Answer, in their own words: Active only.",
    );
    expect(decisionRecordText(passedOn, undefined)).toContain(
      [
        "Passed on by the person in the Role cto: Devops owns exports.",
        "Not answered yet: it waits on the person in the Role devops, in a Consultation.",
      ].join("\n"),
    );
    expect(decisionRecordText(passedOn, undefined)).toContain(
      `The Office has no Task ${passedOn.taskId}.`,
    );
  });

  it("says who answered it for the user, at their request, and in which Thread", () => {
    const answered = aDecision({
      answer: {
        ...oneOptionAnswer(1),
        answeredAt: new Date("2026-10-26T10:00:00.000Z"),
        atUsersRequest: { roleKey: "cto", threadId: "thread-of-the-cto", user: ANN_LEE },
      },
    });

    expect(decisionRecordText(answered, TASK_RECORD)).toContain(
      "Answered by the person in the Role cto, for the user Ann Lee at their request in the Thread thread-of-the-cto, on 2026-10-26T10:00:00.000Z:\n1. Should the export include archived Projects?\n   Answer: Every Project",
    );
  });
});

describe("a message with the records it mentions", () => {
  it("stays as written when it mentions none", () => {
    expect(withMentionedRecords("Hello.", [])).toBe("Hello.");
  });
});

describe("a mentioned form's record", () => {
  it("lists every question in order, and that it was asked again with the general comment", () => {
    const form = aDecision({
      questions: THREE_QUESTIONS,
      answer: {
        kind: "asked-again",
        generalComment: "Say what archived means.",
        answeredAt: new Date("2026-10-26T10:00:00.000Z"),
        user: ANN_LEE,
      },
    });

    const text = decisionRecordText(form, TASK_RECORD);

    expect(text).toContain(
      [
        "Question 2: Which years should it cover?",
        "An open question, answered in their own words.",
        "",
        "Question 3: Which format?",
      ].join("\n"),
    );
    expect(text).toContain(
      "Asked again by the user Ann Lee on 2026-10-26T10:00:00.000Z, answering none of its questions: General comment: Say what archived means.",
    );
  });
});
