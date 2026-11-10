import { describe, expect, it } from "vitest";
import { DecisionOpened } from "./conversation-events.js";
import { answerDecision, openDecision } from "./thread-changes.js";
import { aThread } from "./thread.fixtures.js";
import { aDecision, AT, TASK_HOME, SESSION, DRAFT, WARM, refusalOf } from "./decision.fixtures.js";

describe("opening a Decision", () => {
  it("logs its card and makes the Thread on the Task wait on it", () => {
    const thread = aThread({ home: TASK_HOME, session: SESSION, state: "answering" });

    const opened = openDecision(thread, { ...DRAFT, id: "decision-1", askedAt: AT });

    const decision = {
      ...DRAFT,
      id: "decision-1",
      threadId: thread.id,
      taskId: "task-1",
      roleKey: "planner",
      askedAt: AT,
      attachmentIds: [],
      passedOn: [],
      answer: undefined,
    };
    expect(opened.decision).toEqual(decision);
    expect(opened.thread).toEqual({ ...thread, openDecision: decision });
    expect(opened.logged).toEqual([
      {
        kind: "decision",
        id: expect.any(String),
        threadId: thread.id,
        at: AT,
        roleKey: "planner",
        decisionId: "decision-1",
      },
    ]);
    expect(opened.event).toEqual(new DecisionOpened(opened.thread, decision));
  });
});

describe("answering a Decision", () => {
  const open = aDecision({ id: "decision-1" });
  const waiting = aThread({ home: TASK_HOME, session: SESSION, openDecision: open });
  const answering = {
    personName: "Jan",
    decision: WARM,
    newSession: undefined,
    brief: "The record.",
    decisionId: "decision-1",
    answer: { kind: "free-answer", text: "Only this year's." },
    messageId: "message-1",
    answeredAt: AT,
  } as const;

  it("is refused once answered, with an answer that isn't one, and while the person answers", () => {
    expect(
      refusalOf(() => answerDecision({ ...waiting, openDecision: undefined }, answering)),
    ).toEqual(["This Decision is answered already."]);
    expect(
      refusalOf(() =>
        answerDecision(waiting, { ...answering, answer: { kind: "option", option: 5 } }),
      ),
    ).toEqual(["Choose one of the Decision's options."]);
    expect(refusalOf(() => answerDecision({ ...waiting, state: "answering" }, answering))).toEqual([
      "Jan is still answering. Answer once they finish.",
    ]);
  });
});
