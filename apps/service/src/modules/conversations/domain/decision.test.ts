import { describe, expect, it } from "vitest";
import type { ContextDecision } from "./context-policy.js";
import { DecisionAnswered, DecisionOpened, DecisionReopened } from "./conversation-events.js";
import {
  answerProblems,
  answerWords,
  decisionProblems,
  type Decision,
  type DecisionDraft,
} from "./decision.js";
import { aDecision } from "./decision.fixtures.js";
import { decisionAnswerMessage } from "./session-instructions.js";
import type { ThreadSession } from "./thread.js";
import { answerDecision, failDecisionAnswer, openDecision } from "./thread-changes.js";
import { aThread } from "./thread.fixtures.js";
import { ThreadRefused } from "./thread-refused.js";

const AT = new Date("2026-10-25T10:00:00.000Z");
const TASK_HOME = { kind: "task", taskId: "task-1" } as const;

const SESSION: ThreadSession = {
  id: "session-1",
  roleKey: "planner",
  cardVersion: 1,
  startedAt: AT,
  lastCallAt: AT,
  contextTokens: 34_000,
  startContextTokens: 33_000,
  full: false,
};

const DRAFT: DecisionDraft = {
  question: "Should the export include archived Projects?",
  context: "Archived Projects have no worktree.",
  options: ["Only active Projects", "Every Project"],
  recommendation: { option: 0, reason: "Archived ones have nothing to export." },
};

const WARM: ContextDecision = {
  move: "resume",
  reason: "cache-warm",
  cacheWarm: true,
  contextTokens: 34_000,
  briefTokens: undefined,
  alternatives: [],
};

function refusalOf(change: () => unknown): readonly string[] {
  try {
    change();
  } catch (error) {
    if (error instanceof ThreadRefused) return error.reasons;
    throw error;
  }
  throw new Error("It wasn't refused.");
}

describe("what an Agent asks in a Decision", () => {
  it("is a question with two or more named options, one of them recommended with a reason", () => {
    expect(decisionProblems(DRAFT)).toEqual([]);
  });

  it("is refused with every problem at once", () => {
    expect(
      decisionProblems({
        question: " ",
        context: "",
        options: ["Yes"],
        recommendation: { option: 3, reason: "" },
      }),
    ).toEqual([
      "Write the question.",
      "Give the user at least two options.",
      "Recommend one of the options.",
      "Say why you recommend it.",
    ]);
    expect(
      decisionProblems({
        ...DRAFT,
        options: ["Every Project", "every project ", ""],
      }),
    ).toEqual(["Name every option.", "Give each option a name of its own."]);
  });
});

describe("the user's answer", () => {
  const decision = aDecision();

  it("is one of the options or a free answer, in words", () => {
    expect(answerProblems(decision, { kind: "option", option: 1 })).toEqual([]);
    expect(answerProblems(decision, { kind: "option", option: 2 })).toEqual([
      "Choose one of the Decision's options.",
    ]);
    expect(answerProblems(decision, { kind: "free-answer", text: "  " })).toEqual([
      "Write your answer first.",
    ]);
    expect(answerWords(decision, { kind: "option", option: 1 })).toBe("Every Project");
    expect(answerWords(decision, { kind: "free-answer", text: " Only this year's. " })).toBe(
      "Only this year's.",
    );
  });

  it("reaches the asking session with the question", () => {
    expect(decisionAnswerMessage(decision, { kind: "option", option: 0 })).toBe(
      'The user answered your Decision "Should the export include archived Projects?" with the option "Only active Projects".',
    );
    expect(
      decisionAnswerMessage(decision, { kind: "free-answer", text: "Ask me next week." }),
    ).toBe(
      'The user answered your Decision "Should the export include archived Projects?" in their own words:\n\nAsk me next week.',
    );
  });
});

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

  it("is refused in a chat, while another waits, and with what is asked wrong", () => {
    const opening = { ...DRAFT, id: "decision-2", askedAt: AT };

    expect(refusalOf(() => openDecision(aThread({ session: SESSION }), opening))).toEqual([
      "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
    ]);
    const waiting = aThread({ home: TASK_HOME, openDecision: aDecision() });
    expect(refusalOf(() => openDecision(waiting, opening))).toEqual([
      'Your Decision "Should the export include archived Projects?" still waits on the user. End your turn: their answer comes as your next message.',
    ]);
    expect(
      refusalOf(() => openDecision(aThread({ home: TASK_HOME }), { ...opening, options: [] })),
    ).toEqual(["Give the user at least two options.", "Recommend one of the options."]);
  });
});

describe("answering a Decision", () => {
  const open = aDecision({ id: "decision-1" });
  const waiting = aThread({ home: TASK_HOME, session: SESSION, openDecision: open });
  const answering = {
    personName: "Jan",
    decision: WARM,
    newSession: undefined,
    decisionId: "decision-1",
    answer: { kind: "free-answer", text: "Only this year's." },
    messageId: "message-1",
    answeredAt: AT,
  } as const;

  it("logs the answer, closes the Decision and has the person take it", () => {
    const answered = answerDecision(waiting, answering);

    const decision: Decision = {
      ...open,
      answer: { kind: "free-answer", text: "Only this year's.", answeredAt: AT },
    };
    expect(answered.decision).toEqual(decision);
    expect(answered.thread).toMatchObject({ state: "answering", openDecision: undefined });
    expect(answered.logged).toEqual([
      {
        kind: "decision-answer",
        id: "message-1",
        threadId: waiting.id,
        at: AT,
        decisionId: "decision-1",
        answer: { kind: "free-answer", text: "Only this year's." },
      },
    ]);
    expect(answered.event).toEqual(new DecisionAnswered(answered.thread, decision, AT));
  });

  it("logs the move first when the session doesn't simply continue warm", () => {
    const cold = { ...WARM, move: "fresh", reason: "cache-expired", cacheWarm: false } as const;

    const answered = answerDecision(waiting, { ...answering, decision: cold });

    expect(answered.logged.map(({ kind }) => kind)).toEqual(["context", "decision-answer"]);
  });

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

describe("an answer that never reached a session", () => {
  const answered = aDecision({
    id: "decision-1",
    answer: { kind: "option", option: 1, answeredAt: AT },
  });
  const failing = aThread({ home: TASK_HOME, state: "answering", session: SESSION });

  it("opens the Decision again, unanswered, logging why the session didn't start", () => {
    const reopened = failDecisionAnswer(failing, answered, "The engine is down.", AT);

    const decision: Decision = { ...answered, answer: undefined };
    expect(reopened.decision).toEqual(decision);
    expect(reopened.thread).toMatchObject({ state: "waiting", openDecision: decision });
    expect(reopened.logged).toEqual([
      {
        kind: "failure",
        id: expect.any(String),
        threadId: failing.id,
        at: AT,
        reason: "The engine is down.",
      },
    ]);
    expect(reopened.event).toEqual(new DecisionReopened(reopened.thread, decision, AT));
  });

  it("puts back the session the Thread had when the new one never opened", () => {
    const fresh = { ...SESSION, id: "session-2" };

    const reopened = failDecisionAnswer(
      { ...failing, session: fresh },
      answered,
      "The engine is down.",
      AT,
      { sessionId: "session-2", previous: SESSION },
    );

    expect(reopened.thread.session).toEqual(SESSION);
  });
});
