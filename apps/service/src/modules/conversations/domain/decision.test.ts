import { describe, expect, it } from "vitest";
import { DecisionAnswered, DecisionOpened, DeliveryMarked } from "./conversation-events.js";
import {
  answerDecision,
  deliverWaitingAnswers,
  keepAnswerForTurnEnd,
  openDecision,
} from "./thread-changes.js";
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
    expect(opened.thread).toEqual({ ...thread, openDecisions: [decision] });
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
  const waiting = aThread({ home: TASK_HOME, session: SESSION, openDecisions: [open] });
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
    expect(refusalOf(() => answerDecision({ ...waiting, openDecisions: [] }, answering))).toEqual([
      "This Decision is answered already.",
    ]);
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

describe("Decisions in an Initiative's planning Thread", () => {
  const INITIATIVE_HOME = { kind: "initiative", initiativeId: "initiative-1" } as const;
  const planning = aThread({ home: INITIATIVE_HOME, session: SESSION, state: "answering" });

  it("opens several at once, one per Task, each on the Task it names", () => {
    const first = openDecision(planning, {
      ...DRAFT,
      id: "decision-a",
      askedAt: AT,
      taskId: "task-a",
    });
    const second = openDecision(first.thread, {
      ...DRAFT,
      question: "Which format?",
      id: "decision-b",
      askedAt: AT,
      taskId: "task-b",
    });

    expect(second.thread.openDecisions.map(({ id, taskId }) => ({ id, taskId }))).toEqual([
      { id: "decision-a", taskId: "task-a" },
      { id: "decision-b", taskId: "task-b" },
    ]);
    expect(
      refusalOf(() =>
        openDecision(second.thread, { ...DRAFT, id: "decision-c", askedAt: AT, taskId: "task-a" }),
      ),
    ).toEqual([
      `Your Decision "${DRAFT.question}" on this Task still waits on the user. Plan the Tasks that don't wait for it; its answer comes as a message.`,
    ]);
  });

  it("is refused naming no Task, and a Thread on a Task keeps one at a time on its own Task", () => {
    expect(
      refusalOf(() => openDecision(planning, { ...DRAFT, id: "decision-a", askedAt: AT })),
    ).toEqual(["Name the Task the Decision is on, by its taskId: one of the Initiative's Tasks."]);
    const onTask = aThread({ home: TASK_HOME, session: SESSION, state: "answering" });
    expect(
      refusalOf(() =>
        openDecision(onTask, { ...DRAFT, id: "decision-a", askedAt: AT, taskId: "task-2" }),
      ),
    ).toEqual(["A Decision here is on this Thread's Task: leave taskId out, or name this Task."]);
    const waiting = openDecision(onTask, { ...DRAFT, id: "decision-a", askedAt: AT });
    expect(
      refusalOf(() => openDecision(waiting.thread, { ...DRAFT, id: "decision-b", askedAt: AT })),
    ).toEqual([
      `Your Decision "${DRAFT.question}" still waits on the user. End your turn: their answer comes as your next message.`,
    ]);
  });

  const onA = aDecision({ id: "decision-a", taskId: "task-a" });
  const onB = aDecision({ id: "decision-b", taskId: "task-b" });
  const recording = {
    decisionId: "decision-a",
    answer: { kind: "option", option: 1 },
    messageId: "line-a",
    answeredAt: AT,
  } as const;

  it("keeps an answer given while the Planner works for the turn's end, answering the Decision at once", () => {
    const working = { ...planning, openDecisions: [onA, onB] };

    const kept = keepAnswerForTurnEnd(working, recording, "Angela");

    expect(kept.thread).toEqual({ ...working, openDecisions: [onB] });
    expect(kept.decision?.answer).toEqual({ kind: "option", option: 1, answeredAt: AT });
    expect(kept.logged).toEqual([
      {
        kind: "decision-answer",
        id: "line-a",
        threadId: working.id,
        at: AT,
        decisionId: "decision-a",
        answer: { kind: "option", option: 1 },
        delivery: "waiting",
      },
    ]);
    expect(kept.event).toBeInstanceOf(DecisionAnswered);
    const onTask = aThread({ home: TASK_HOME, state: "answering", openDecisions: [onA] });
    expect(refusalOf(() => keepAnswerForTurnEnd(onTask, recording, "Angela"))).toEqual([
      "Angela is still answering. Answer once they finish.",
    ]);
  });

  it("hands the waiting answers over once the turn has ended, marking them delivered", () => {
    const ended = { ...planning, state: "waiting" as const, openDecisions: [onB] };
    const opening = { personName: "Angela", decision: WARM, newSession: undefined, brief: "" };

    const delivered = deliverWaitingAnswers(ended, opening, ["line-a", "line-c"], AT);

    expect(delivered.thread.state).toBe("answering");
    expect(delivered.thread.openDecisions).toEqual([onB]);
    expect(delivered.marked).toEqual({ messageIds: ["line-a", "line-c"], delivery: "delivered" });
    expect(delivered.event).toBeInstanceOf(DeliveryMarked);
    expect(refusalOf(() => deliverWaitingAnswers(planning, opening, ["line-a"], AT))).toEqual([
      "Angela is still answering.",
    ]);
  });

  it("hands waiting answers over with an answer given once the Planner waits", () => {
    const ended = { ...planning, state: "waiting" as const, openDecisions: [onB] };

    const answered = answerDecision(ended, {
      personName: "Angela",
      decision: WARM,
      newSession: undefined,
      brief: "",
      decisionId: "decision-b",
      answer: { kind: "option", option: 0 },
      messageId: "line-b",
      answeredAt: AT,
      waitingAnswerIds: ["line-a"],
    });

    expect(answered.thread).toMatchObject({ state: "answering", openDecisions: [] });
    expect(answered.marked).toEqual({ messageIds: ["line-a"], delivery: "delivered" });
  });
});
