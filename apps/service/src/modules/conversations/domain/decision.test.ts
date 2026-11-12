import { describe, expect, it } from "vitest";
import { DecisionAnswered, DecisionOpened, DeliveryMarked } from "./conversation-events.js";
import { approvalQuestion, APPROVAL_OPTIONS } from "./consult.js";
import { answerForUserProblems, answerGivenBy, answerProblems } from "./decision.js";
import {
  answerDecision,
  deliverWaitingAnswers,
  keepAnswerForTurnEnd,
  openDecision,
  recordDecisionAnswer,
} from "./thread-changes.js";
import { aThread } from "./thread.fixtures.js";
import { aDecision, AT, TASK_HOME, SESSION, DRAFT, WARM, refusalOf } from "./decision.fixtures.js";

describe("opening a Decision", () => {
  it("logs its card and makes the Thread on the Task wait on it", () => {
    const thread = aThread({ home: TASK_HOME, session: SESSION, state: "answering" });

    const opened = openDecision(thread, { ...DRAFT, id: "decision-1", askedAt: AT });

    const decision = {
      ...DRAFT,
      kind: "question" as const,
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

describe("answering a Decision for the user, at their request", () => {
  const AT_USERS_REQUEST = { roleKey: "cto", threadId: "thread-of-the-cto" };
  const open = aDecision({ id: "decision-1" });
  const waiting = aThread({ home: TASK_HOME, session: SESSION, openDecisions: [open] });

  it("records who answered and the Thread the user asked in, on the Decision, its line and its event", () => {
    const answered = answerDecision(waiting, {
      personName: "Jan",
      decision: WARM,
      newSession: undefined,
      brief: "The record.",
      decisionId: "decision-1",
      answer: { kind: "option", option: 1 },
      messageId: "message-1",
      answeredAt: AT,
      atUsersRequest: AT_USERS_REQUEST,
    });

    const decision = {
      ...open,
      answer: {
        kind: "option" as const,
        option: 1,
        answeredAt: AT,
        atUsersRequest: AT_USERS_REQUEST,
      },
    };
    expect(answered.decision).toEqual(decision);
    expect(answered.decision?.answer).not.toHaveProperty("answeredBy");
    expect(answered.logged).toContainEqual(
      expect.objectContaining({
        kind: "decision-answer",
        id: "message-1",
        atUsersRequest: AT_USERS_REQUEST,
      }),
    );
    expect(answered.event).toEqual(new DecisionAnswered(answered.thread, decision, AT));
  });

  it("records it alike for a Decision whose answer goes to the Pipeline", () => {
    const stageThread = { ...waiting, stageThread: true };

    const recorded = recordDecisionAnswer(stageThread, {
      decisionId: "decision-1",
      answer: { kind: "free-answer", text: "Every Project." },
      messageId: "message-1",
      answeredAt: AT,
      atUsersRequest: AT_USERS_REQUEST,
    });

    expect(recorded.decision?.answer).toEqual({
      kind: "free-answer",
      text: "Every Project.",
      answeredAt: AT,
      atUsersRequest: AT_USERS_REQUEST,
    });
    expect(recorded.logged).toEqual([
      expect.objectContaining({ kind: "decision-answer", atUsersRequest: AT_USERS_REQUEST }),
    ]);
  });

  it("keeps a Consultant's answer and the user's own as they were", () => {
    expect(answerGivenBy(undefined)).toEqual({});
    expect(answerGivenBy({ kind: "consultant", roleKey: "cto", name: "Ada" })).toEqual({
      answeredBy: "cto",
    });
    expect(answerGivenBy({ kind: "at-users-request", name: "Ada", ...AT_USERS_REQUEST })).toEqual({
      atUsersRequest: AT_USERS_REQUEST,
    });
  });
});

describe("what keeps a person from answering a Decision for the user", () => {
  const callersThread = aThread({ id: "thread-of-the-cto", roleKey: "cto" });
  const open = aDecision();

  it("lets them answer a Decision waiting on the user in another Thread", () => {
    expect(answerForUserProblems(open, callersThread)).toEqual([]);
  });

  it("refuses one put to a Consultant, an approval, one answered, and one in their own Thread", () => {
    expect(answerForUserProblems(aDecision({ putTo: "devops" }), callersThread)).toEqual([
      "This Decision is put to the person in the Role devops, who answers it in a Consultation; only a Decision waiting on the user can be answered for them.",
    ]);
    const approval = aDecision({
      kind: "approval",
      question: approvalQuestion("Install ffmpeg on the machine."),
      options: APPROVAL_OPTIONS,
    });
    expect(answerForUserProblems(approval, callersThread)).toEqual([
      "This Decision asks the user's approval of a call: only the user gives it, on its card. Tell them where it waits.",
    ]);
    const answered = aDecision({
      answer: { kind: "option", option: 0, answeredAt: AT },
    });
    expect(answerForUserProblems(answered, callersThread)).toEqual([
      "This Decision is answered already.",
    ]);
    expect(answerForUserProblems(aDecision({ threadId: callersThread.id }), callersThread)).toEqual(
      [
        "This Decision is open in your own Thread: the user answers it on its card here, not through you.",
      ],
    );
  });

  it("refuses from a Stage Thread and a Consultation, where the user isn't the one asking", () => {
    const refusal = [
      "Only in a Thread the user talks to you in can you answer a Decision for them.",
    ];
    expect(answerForUserProblems(open, { ...callersThread, stageThread: true })).toEqual(refusal);
    expect(
      answerForUserProblems(open, {
        ...callersThread,
        consultation: { decisionId: "d", askerThreadId: "t", askerRoleKey: "developer" },
      }),
    ).toEqual(refusal);
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

describe("a call made from a chat", () => {
  const chat = aThread({ home: { kind: "chat", roleKey: "planner" }, session: SESSION });
  const request = {
    kind: "request" as const,
    question: "Set up the Project's commands.",
    context: "The user asked for it.",
    options: [],
    recommendation: { option: 0, reason: "Only Devops drafts them." },
    id: "decision-1",
    askedAt: AT,
  };

  it("opens a Decision on no Task when it is put to a person, one at a time", () => {
    const opened = openDecision(chat, { ...request, putTo: "devops" });

    expect(opened.decision).toMatchObject({ kind: "request", taskId: undefined, putTo: "devops" });
    expect(
      refusalOf(() => openDecision(opened.thread, { ...request, id: "decision-2", putTo: "cto" })),
    ).toEqual([
      `Your call "Set up the Project's commands." still waits on its answer. End your turn: it comes as your next message.`,
    ]);
  });

  it("is refused when it would wait on the user, as a chat has no Needs you", () => {
    expect(refusalOf(() => openDecision(chat, request))).toEqual([
      "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
    ]);
  });
});

describe("a request", () => {
  const thread = aThread({ home: TASK_HOME, session: SESSION });
  const request = {
    kind: "request" as const,
    question: "Set up the Project's commands.",
    context: "",
    options: [],
    recommendation: { option: 0, reason: "Only Devops drafts them." },
    id: "decision-1",
    askedAt: AT,
  };

  it("has no options, and says what is asked and why", () => {
    expect(
      refusalOf(() =>
        openDecision(thread, {
          ...request,
          question: " ",
          options: ["Yes", "No"],
          recommendation: { option: 0, reason: "" },
        }),
      ),
    ).toEqual([
      "Say what you ask them to do.",
      "A request has no options: they answer in their own words.",
      "Say why you need it.",
    ]);
  });

  it("is answered in words only", () => {
    const open = openDecision(thread, request).decision;
    if (!open) throw new Error("No Decision was opened.");

    expect(answerProblems(open, { kind: "option", option: 0 })).toEqual([
      "A request has no options: answer in your own words, saying what you did or why not.",
    ]);
    expect(answerProblems(open, { kind: "free-answer", text: "Drafted it." })).toEqual([]);
  });
});
