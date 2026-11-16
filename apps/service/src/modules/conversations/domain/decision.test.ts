import { describe, expect, it } from "vitest";
import {
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  DeliveryMarked,
} from "./conversation-events.js";
import { approvalQuestion, APPROVAL_OPTIONS } from "./consult.js";
import {
  answerForUserProblems,
  answerGivenBy,
  answerProblems,
  CLOSED_DECISION_REFUSAL,
  decisionProblems,
  decisionSummary,
  isOpen,
  oneOptionAnswer,
  oneWordsAnswer,
  type Decision,
  type DecisionAnswer,
} from "./decision.js";
import {
  answerDecision,
  closeDecision,
  deliverWaitingAnswers,
  keepAnswerForTurnEnd,
  openDecision,
  recordDecisionAnswer,
} from "./thread-changes.js";
import { aThread } from "./thread.fixtures.js";
import {
  aDecision,
  AT,
  TASK_HOME,
  SESSION,
  DRAFT,
  THREE_QUESTIONS,
  WARM,
  refusalOf,
} from "./decision.fixtures.js";
import { ANN_LEE, ANSWERED_BY_ANN_LEE } from "./user.fixtures.js";

describe("opening a Decision", () => {
  it("logs its card and makes the Thread on the Task wait on it", () => {
    const thread = aThread({ home: TASK_HOME, session: SESSION, state: "answering" });

    const opened = openDecision(thread, { ...DRAFT, id: "decision-1", askedAt: AT });

    const decision = {
      ...DRAFT,
      kind: "form" as const,
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
    answer: oneWordsAnswer("Only this year's."),
    messageId: "message-1",
    answeredAt: AT,
  } as const;

  it("is refused once answered, with an answer that isn't one, and while the person answers", () => {
    expect(refusalOf(() => answerDecision({ ...waiting, openDecisions: [] }, answering))).toEqual([
      "This Decision is answered already.",
    ]);
    expect(
      refusalOf(() => answerDecision(waiting, { ...answering, answer: oneOptionAnswer(5) })),
    ).toEqual(["Choose one of the Decision's options."]);
    expect(refusalOf(() => answerDecision({ ...waiting, state: "answering" }, answering))).toEqual([
      "Jan is still answering. Answer once they finish.",
    ]);
  });
});

describe("closing a Decision as its Task is dropped", () => {
  const open = aDecision({ id: "decision-1" });
  const waiting = aThread({ home: TASK_HOME, session: SESSION, openDecisions: [open] });

  it("closes the open Decision, so the Thread no longer waits on it", () => {
    const closed = closeDecision(waiting, "decision-1", AT);
    if (!closed) throw new Error("It closed nothing.");

    const decision = { ...open, closedAt: AT };
    expect(closed.decision).toEqual(decision);
    expect(closed.thread).toEqual({ ...waiting, openDecisions: [] });
    expect(closed.logged).toEqual([]);
    expect(closed.event).toEqual(new DecisionClosed(closed.thread, decision, AT));
    expect(isOpen(decision)).toBe(false);
  });

  it("changes nothing for a Decision the Thread doesn't wait on", () => {
    expect(closeDecision({ ...waiting, openDecisions: [] }, "decision-1", AT)).toBeUndefined();
  });

  it("refuses an answer to a closed Decision, by the user or a person at their request", () => {
    const closed = { ...open, closedAt: AT };
    const words = [CLOSED_DECISION_REFUSAL];
    expect(words).toEqual(["This Decision was closed: its Task was dropped."]);
    expect(answerProblems(closed, oneOptionAnswer(0))).toEqual(words);
    expect(answerProblems(closed, { kind: "asked-again" })).toEqual(words);
    expect(answerForUserProblems(closed, aThread({ id: "thread-of-the-cto" }))).toEqual(words);
  });
});

describe("answering a Decision for the user, at their request", () => {
  const AT_USERS_REQUEST = { roleKey: "cto", threadId: "thread-of-the-cto", user: ANN_LEE };
  const open = aDecision({ id: "decision-1" });
  const waiting = aThread({ home: TASK_HOME, session: SESSION, openDecisions: [open] });

  it("records who answered and the Thread the user asked in, on the Decision, its line and its event", () => {
    const answered = answerDecision(waiting, {
      personName: "Jan",
      decision: WARM,
      newSession: undefined,
      brief: "The record.",
      decisionId: "decision-1",
      answer: oneOptionAnswer(1),
      messageId: "message-1",
      answeredAt: AT,
      atUsersRequest: AT_USERS_REQUEST,
    });

    const decision: Decision = {
      ...open,
      answer: {
        ...oneOptionAnswer(1),
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
      answer: oneWordsAnswer("Every Project."),
      messageId: "message-1",
      answeredAt: AT,
      atUsersRequest: AT_USERS_REQUEST,
    });

    expect(recorded.decision?.answer).toEqual({
      ...oneWordsAnswer("Every Project."),
      answeredAt: AT,
      atUsersRequest: AT_USERS_REQUEST,
    });
    expect(recorded.logged).toEqual([
      expect.objectContaining({ kind: "decision-answer", atUsersRequest: AT_USERS_REQUEST }),
    ]);
  });

  it("records the user who answered, the Consultant, and the person who answered for the user", () => {
    expect(answerGivenBy(ANSWERED_BY_ANN_LEE)).toEqual({ user: ANN_LEE });
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
    expect(answerForUserProblems(APPROVAL, callersThread)).toEqual([
      "This Decision asks the user's approval of a call: only the user gives it, on its card. Tell them where it waits.",
    ]);
    const answered = aDecision({
      answer: { ...oneOptionAnswer(0), answeredAt: AT },
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
      questions: THREE_QUESTIONS.slice(2),
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
      `Your Decision "${decisionSummary(DRAFT)}" on this Task still waits on the user. Plan the Tasks that don't wait for it; its answer comes as a message.`,
    ]);
  });

  it("is refused naming no Task, and a Thread on a Task keeps one at a time on its own Task", () => {
    expect(
      refusalOf(() => openDecision(planning, { ...DRAFT, id: "decision-a", askedAt: AT })),
    ).toEqual([
      "Name the Task the Decision is on, by its taskId: one of the Initiative's Tasks. Only a call to a person may name none.",
    ]);
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
      `Your Decision "${decisionSummary(DRAFT)}" still waits on the user. End your turn: their answer comes as your next message.`,
    ]);
  });

  const onA = aDecision({ id: "decision-a", taskId: "task-a" });
  const onB = aDecision({ id: "decision-b", taskId: "task-b" });
  const recording = {
    decisionId: "decision-a",
    answer: oneOptionAnswer(1),
    messageId: "line-a",
    answeredAt: AT,
  } as const;

  it("keeps an answer given while the Planner works for the turn's end, answering the Decision at once", () => {
    const working = { ...planning, openDecisions: [onA, onB] };

    const kept = keepAnswerForTurnEnd(working, recording, "Angela");

    expect(kept.thread).toEqual({ ...working, openDecisions: [onB] });
    expect(kept.decision?.answer).toEqual({ ...oneOptionAnswer(1), answeredAt: AT });
    expect(kept.logged).toEqual([
      {
        kind: "decision-answer",
        id: "line-a",
        threadId: working.id,
        at: AT,
        decisionId: "decision-a",
        answer: oneOptionAnswer(1),
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
      answer: oneOptionAnswer(0),
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
    context: "The user asked for it.",
    questions: [
      { kind: "open", question: "Set up the Project's commands.", why: "Only Devops drafts them." },
    ] as const,
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
    context: "",
    questions: [
      { kind: "open", question: "Set up the Project's commands.", why: "Only Devops drafts them." },
    ] as const,
    id: "decision-1",
    askedAt: AT,
  };

  it("asks one thing, in words, saying what is asked and why", () => {
    expect(
      refusalOf(() =>
        openDecision(thread, { ...request, questions: [{ kind: "open", question: " " }] }),
      ),
    ).toEqual(["Say what you ask them to do.", "Say why you need it."]);
    expect(
      refusalOf(() => openDecision(thread, { ...request, questions: DRAFT.questions })),
    ).toEqual(["A request has no options: they answer in their own words."]);
    expect(
      refusalOf(() =>
        openDecision(thread, {
          ...request,
          questions: [...request.questions, ...request.questions],
        }),
      ),
    ).toEqual(["A request asks one thing."]);
    expect(refusalOf(() => openDecision(thread, { ...request, questions: [] }))).toEqual([
      "A request asks one thing.",
    ]);
  });

  it("is answered in words only", () => {
    const open = openDecision(thread, request).decision;
    if (!open) throw new Error("No Decision was opened.");

    expect(answerProblems(open, oneOptionAnswer(0))).toEqual([
      "A request has no options: answer in your own words, saying what you did or why not.",
    ]);
    expect(answerProblems(open, oneWordsAnswer("Drafted it."))).toEqual([]);
  });
});

const APPROVAL = aDecision({
  kind: "approval",
  questions: [
    {
      kind: "choice",
      question: approvalQuestion("Install ffmpeg on the machine."),
      options: APPROVAL_OPTIONS,
      recommendation: { option: 0, reason: "The Task converts videos." },
    },
  ],
});

describe("what an Agent asks in a form", () => {
  it("asks at least one question, each a choice or an open question", () => {
    expect(decisionProblems({ context: "", questions: THREE_QUESTIONS })).toEqual([]);
    expect(decisionProblems({ context: "", questions: [] })).toEqual([
      "Ask at least one question.",
    ]);
  });

  it("gives a choice two or more options of their own and a recommended one, with its reason", () => {
    expect(
      decisionProblems({
        context: "",
        questions: [
          {
            kind: "choice",
            question: " ",
            options: ["Yes"],
            recommendation: { option: 3, reason: "" },
          },
        ],
      }),
    ).toEqual([
      "Write the question.",
      "Give the user at least two options.",
      "Recommend one of the options.",
      "Say why you recommend it.",
    ]);
    expect(
      decisionProblems({
        context: "",
        questions: [
          {
            kind: "choice",
            question: "Which?",
            options: ["Every Project", "every project ", ""],
            recommendation: { option: 0, reason: "It is all." },
          },
        ],
      }),
    ).toEqual(["Name every option.", "Give each option a name of its own."]);
  });

  it("writes an open question's text", () => {
    expect(
      decisionProblems({ context: "", questions: [{ kind: "open", question: "  " }] }),
    ).toEqual(["Write the question."]);
  });

  it("names the question of each problem when it asks several", () => {
    expect(
      decisionProblems({
        context: "",
        questions: [
          THREE_QUESTIONS[0]!,
          { kind: "open", question: "" },
          {
            kind: "choice",
            question: "Which format?",
            options: ["CSV"],
            recommendation: { option: 0, reason: "Short." },
          },
        ],
      }),
    ).toEqual([
      "Question 2: Write the question.",
      "Question 3: Give the user at least two options.",
    ]);
  });
});

/** The form's answer sent with Submit. */
function submitted(
  answers: Extract<DecisionAnswer, { kind: "submitted" }>["answers"],
  generalComment?: string,
): DecisionAnswer {
  return { kind: "submitted", answers, generalComment };
}

describe("answering a form", () => {
  const form = aDecision({ questions: THREE_QUESTIONS });

  it("submits an answer to every question, with optional comments and a general comment", () => {
    expect(
      answerProblems(
        form,
        submitted(
          [
            { kind: "option", option: 1, comment: "Archived ones too." },
            { kind: "words", text: "2025 and 2026" },
            { kind: "option", option: 0 },
          ],
          "Thanks.",
        ),
      ),
    ).toEqual([]);
  });

  it("is refused unless every question has an answer", () => {
    expect(answerProblems(form, submitted([{ kind: "option", option: 1 }]))).toEqual([
      "Answer every question: this Decision asks 3.",
    ]);
    expect(answerProblems(aDecision(), submitted([]))).toEqual(["Answer the question first."]);
  });

  it("takes a choice answered in words alone, and refuses empty words and an option it hasn't", () => {
    expect(
      answerProblems(
        form,
        submitted([
          { kind: "words", text: "Ask the CTO." },
          { kind: "words", text: "This year" },
          { kind: "words", text: "Whichever is quicker." },
        ]),
      ),
    ).toEqual([]);
    expect(
      answerProblems(
        form,
        submitted([
          { kind: "words", text: " " },
          { kind: "option", option: 0 },
          { kind: "option", option: 2 },
        ]),
      ),
    ).toEqual([
      "Question 1: Write your answer first.",
      "Question 2: It is an open question: answer in your own words.",
      "Question 3: Choose one of the Decision's options.",
    ]);
    expect(answerProblems(aDecision(), oneOptionAnswer(-1))).toEqual([
      "Choose one of the Decision's options.",
    ]);
  });

  it("asks again with or without a general comment", () => {
    expect(answerProblems(form, { kind: "asked-again" })).toEqual([]);
    expect(
      answerProblems(form, { kind: "asked-again", generalComment: "Why not both formats?" }),
    ).toEqual([]);
  });

  it("refuses Ask me again on an approval and on The Office's own Decision", () => {
    expect(answerProblems(APPROVAL, { kind: "asked-again" })).toEqual([
      "An approval has no Ask me again: answer Allow once or Deny.",
    ]);
    expect(
      answerProblems(aDecision({ roleKey: undefined }), {
        kind: "asked-again",
        generalComment: "Explain.",
      }),
    ).toEqual(["The Office's own Decisions have no Ask me again: nobody is there to ask again."]);
  });

  it("answers an approval with one of its options and no comments", () => {
    expect(answerProblems(APPROVAL, oneOptionAnswer(1))).toEqual([]);
    expect(answerProblems(APPROVAL, oneOptionAnswer(2))).toEqual(["Choose Allow once or Deny."]);
    expect(answerProblems(APPROVAL, oneWordsAnswer("Yes"))).toEqual(["Choose Allow once or Deny."]);
    expect(
      answerProblems(APPROVAL, submitted([{ kind: "option", option: 0, comment: "Once only." }])),
    ).toEqual(["An approval takes no comments: choose Allow once or Deny."]);
    expect(answerProblems(APPROVAL, submitted([{ kind: "option", option: 0 }], "Fine."))).toEqual([
      "An approval takes no comments: choose Allow once or Deny.",
    ]);
  });

  it("takes an approval's empty comment boxes as no comments", () => {
    expect(
      answerProblems(APPROVAL, submitted([{ kind: "option", option: 0, comment: " " }], "")),
    ).toEqual([]);
  });
});
