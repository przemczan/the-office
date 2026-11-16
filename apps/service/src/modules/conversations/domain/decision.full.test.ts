import { describe, expect, it } from "vitest";
import { APPROVAL_OPTIONS, approvalQuestion } from "./consult.js";
import { DecisionAnswered, DecisionReopened } from "./conversation-events.js";
import {
  decisionProblems,
  decisionSummary,
  formAnswerFromOne,
  formAnswerWords,
  formFromOne,
  oneAnswerView,
  oneOptionAnswer,
  oneQuestionKind,
  oneQuestionView,
  oneWordsAnswer,
  questionAnswerWords,
  type Decision,
  type DecisionAnswer,
} from "./decision.js";
import { decisionAnswerMessage } from "./session-instructions.js";
import {
  answerDecision,
  failDecisionAnswer,
  openDecision,
  passDecisionOn,
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
import { ANSWERED_BY_ANN_LEE } from "./user.fixtures.js";

describe("what an Agent asks in a Decision", () => {
  it("is a choice with two or more named options, one of them recommended with a reason", () => {
    expect(decisionProblems(DRAFT)).toEqual([]);
  });
});

const FORM = aDecision({ questions: THREE_QUESTIONS });
const SUBMITTED: DecisionAnswer = {
  kind: "submitted",
  answers: [
    { kind: "option", option: 1, comment: " Archived ones too. " },
    { kind: "words", text: " 2025 and 2026 " },
    { kind: "words", text: "Whichever is quicker." },
  ],
  generalComment: " Thanks. ",
};
const APPROVAL = aDecision({
  kind: "approval",
  questions: [
    {
      kind: "choice",
      question: approvalQuestion("Install ffmpeg."),
      options: APPROVAL_OPTIONS,
      recommendation: { option: 0, reason: "The Task converts videos." },
    },
  ],
});

describe("the answer in words", () => {
  it("gives each question with its answer and comment, then the general comment", () => {
    expect(formAnswerWords(FORM, SUBMITTED)).toBe(
      [
        "1. Should the export include archived Projects?",
        "   Answer: Every Project",
        "   Comment: Archived ones too.",
        "2. Which years should it cover?",
        "   Answer, in their own words: 2025 and 2026",
        "3. Which format?",
        "   Answer, in their own words: Whichever is quicker.",
        "",
        "General comment: Thanks.",
      ].join("\n"),
    );
    expect(questionAnswerWords(THREE_QUESTIONS[0]!, { kind: "option", option: 0 })).toBe(
      "Only active Projects",
    );
  });

  it("says it was asked again, with the general comment or none, and gives an approval's option", () => {
    expect(formAnswerWords(FORM, { kind: "asked-again", generalComment: " Why? " })).toBe(
      "Asked again: Why?",
    );
    expect(formAnswerWords(FORM, { kind: "asked-again" })).toBe("Asked again, with no comment.");
    expect(formAnswerWords(APPROVAL, oneOptionAnswer(1))).toBe("Deny");
  });

  it("names the form in one line: its first question and how many more it asks", () => {
    expect(decisionSummary(FORM)).toBe(
      "Should the export include archived Projects? (and 2 more questions)",
    );
    expect(decisionSummary({ questions: THREE_QUESTIONS.slice(1) })).toBe(
      "Which years should it cover? (and 1 more question)",
    );
    expect(decisionSummary(aDecision())).toBe("Should the export include archived Projects?");
  });
});

describe("the answer the asking session gets", () => {
  it("names who submitted, then every question with its answer and comment, and the general comment", () => {
    expect(decisionAnswerMessage(FORM, SUBMITTED, ANSWERED_BY_ANN_LEE)).toBe(
      `The user Ann Lee answered your Decision:\n\n${formAnswerWords(FORM, SUBMITTED)}`,
    );
    expect(
      decisionAnswerMessage(aDecision(), oneOptionAnswer(0), {
        kind: "consultant",
        roleKey: "cto",
        name: "Ada",
      }),
    ).toBe(
      "Ada answered your Decision:\n\n1. Should the export include archived Projects?\n   Answer: Only active Projects",
    );
  });

  it("says they asked again, with their general comment or that they gave none", () => {
    expect(
      decisionAnswerMessage(
        FORM,
        { kind: "asked-again", generalComment: "Why not both formats?" },
        ANSWERED_BY_ANN_LEE,
      ),
    ).toBe(
      "The user Ann Lee asked you to ask again, answering none of your Decision's questions:\n\nGeneral comment: Why not both formats?\n\nAnswer what they said, then open a new Decision for what you still need to ask.",
    );
    expect(decisionAnswerMessage(FORM, { kind: "asked-again" }, ANSWERED_BY_ANN_LEE)).toBe(
      "The user Ann Lee asked you to ask again, answering none of your Decision's questions:\n\nThey gave no comment.\n\nAnswer what they said, then open a new Decision for what you still need to ask.",
    );
  });

  it("keeps an approval's one line, and words a request's answer", () => {
    expect(decisionAnswerMessage(APPROVAL, oneOptionAnswer(0), ANSWERED_BY_ANN_LEE)).toBe(
      `The user Ann Lee answered your Decision "${approvalQuestion("Install ffmpeg.")}" with the option "Allow once".`,
    );
    const request = aDecision({
      kind: "request",
      questions: [{ kind: "open", question: "Set up the commands.", why: "Only Devops can." }],
    });
    expect(
      decisionAnswerMessage(request, oneWordsAnswer("Drafted a Proposal."), {
        kind: "consultant",
        roleKey: "devops",
        name: "Nina",
      }),
    ).toBe(
      "Nina answered your request:\n\n1. Set up the commands.\n   Answer, in their own words: Drafted a Proposal.",
    );
  });
});

describe("the form as one question, for the previous release", () => {
  it("reads a one-choice form back as it was written", () => {
    const view = oneQuestionView(aDecision());
    expect(view).toEqual({
      question: "Should the export include archived Projects?",
      options: ["Only active Projects", "Every Project"],
      recommendation: { option: 0, reason: "Archived Projects have nothing to export." },
    });
    expect(formFromOne(oneQuestionKind("form"), view)).toEqual({
      kind: "form",
      questions: aDecision().questions,
    });
    expect(formFromOne(oneQuestionKind("approval"), oneQuestionView(APPROVAL))).toEqual({
      kind: "approval",
      questions: APPROVAL.questions,
    });
  });

  it("reads a request back with its why, and a question with no options as an open one", () => {
    const request = [
      { kind: "open", question: "Set up the commands.", why: "Only Devops can." },
    ] as const;
    const view = oneQuestionView({ questions: request });
    expect(view).toEqual({
      question: "Set up the commands.",
      options: [],
      recommendation: { option: 0, reason: "Only Devops can." },
    });
    expect(formFromOne("request", view)).toEqual({ kind: "request", questions: request });
    expect(formFromOne("question", { ...view, recommendation: { option: 0, reason: "" } })).toEqual(
      {
        kind: "form",
        questions: [{ kind: "open", question: "Set up the commands." }],
      },
    );
    expect(oneQuestionKind("form")).toBe("question");
    expect(oneQuestionKind("request")).toBe("request");
  });

  it("gives a plain one-question answer as it was, and any other in words", () => {
    const one = aDecision();
    expect(oneAnswerView(one, oneOptionAnswer(1))).toEqual({ kind: "option", option: 1 });
    expect(formAnswerFromOne({ kind: "option", option: 1 })).toEqual(oneOptionAnswer(1));
    expect(oneAnswerView(one, oneWordsAnswer("Later."))).toEqual({
      kind: "free-answer",
      text: "Later.",
    });
    expect(formAnswerFromOne({ kind: "free-answer", text: "Later." })).toEqual(
      oneWordsAnswer("Later."),
    );
    expect(oneAnswerView(FORM, SUBMITTED)).toEqual({
      kind: "free-answer",
      text: formAnswerWords(FORM, SUBMITTED),
    });
    const commented: DecisionAnswer = {
      kind: "submitted",
      answers: [{ kind: "option", option: 1, comment: "Archived too." }],
    };
    expect(oneAnswerView(one, commented)).toEqual({
      kind: "free-answer",
      text: formAnswerWords(one, commented),
    });
    const emptyComments: DecisionAnswer = {
      kind: "submitted",
      answers: [{ kind: "option", option: 1, comment: "" }],
      generalComment: " ",
    };
    expect(oneAnswerView(one, emptyComments)).toEqual({ kind: "option", option: 1 });
    expect(oneAnswerView(FORM, { kind: "asked-again", generalComment: " Why? " })).toEqual({
      kind: "free-answer",
      text: "Why?",
    });
  });
});

describe("opening a Decision", () => {
  it("is refused in a chat, while another waits, and with what is asked wrong", () => {
    const opening = { ...DRAFT, id: "decision-2", askedAt: AT };

    expect(refusalOf(() => openDecision(aThread({ session: SESSION }), opening))).toEqual([
      "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
    ]);
    const waiting = aThread({ home: TASK_HOME, openDecisions: [aDecision()] });
    expect(refusalOf(() => openDecision(waiting, opening))).toEqual([
      'Your Decision "Should the export include archived Projects?" still waits on the user. End your turn: their answer comes as your next message.',
    ]);
    expect(
      refusalOf(() => openDecision(aThread({ home: TASK_HOME }), { ...opening, questions: [] })),
    ).toEqual(["Ask at least one question."]);
  });

  it("names the Task's Attachments it is about, each once", () => {
    const { decision } = openDecision(aThread({ home: TASK_HOME }), {
      ...DRAFT,
      id: "decision-3",
      askedAt: AT,
      attachmentIds: ["screenshot", "report", "screenshot"],
      attachmentsOfTheTask: ["report", "screenshot", "notes"],
    });

    expect(decision?.attachmentIds).toEqual(["screenshot", "report"]);
  });

  it("is refused for an Attachment that isn't the Task's", () => {
    const opening = {
      ...DRAFT,
      id: "decision-4",
      askedAt: AT,
      attachmentIds: ["screenshot", "of-another-task"],
      attachmentsOfTheTask: ["screenshot"],
    };

    expect(refusalOf(() => openDecision(aThread({ home: TASK_HOME }), opening))).toEqual([
      "A Decision names Attachments of its own Task only, and these aren't: of-another-task.",
    ]);
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

  it("logs the answer, closes the Decision and has the person take it", () => {
    const answered = answerDecision(waiting, answering);

    const decision: Decision = {
      ...open,
      answer: { ...oneWordsAnswer("Only this year's."), answeredAt: AT },
    };
    expect(answered.decision).toEqual(decision);
    expect(answered.thread).toMatchObject({ state: "answering", openDecisions: [] });
    expect(answered.logged).toEqual([
      {
        kind: "decision-answer",
        id: "message-1",
        threadId: waiting.id,
        at: AT,
        decisionId: "decision-1",
        answer: oneWordsAnswer("Only this year's."),
      },
    ]);
    expect(answered.event).toEqual(new DecisionAnswered(answered.thread, decision, AT));
  });

  it("logs the move first when the session doesn't simply continue warm", () => {
    const cold = { ...WARM, move: "fresh", reason: "cache-expired", cacheWarm: false } as const;

    const answered = answerDecision(waiting, { ...answering, decision: cold });

    expect(answered.logged.map(({ kind }) => kind)).toEqual(["context", "decision-answer"]);
  });
});

describe("an answer that never reached a session", () => {
  const answered = aDecision({
    id: "decision-1",
    answer: { ...oneOptionAnswer(1), answeredAt: AT },
  });
  const failing = aThread({ home: TASK_HOME, state: "answering", session: SESSION });

  it("opens the Decision again, unanswered, logging why the session didn't start", () => {
    const reopened = failDecisionAnswer(failing, answered, "The engine is down.", AT);

    const decision: Decision = { ...answered, answer: undefined };
    expect(reopened.decision).toEqual(decision);
    expect(reopened.thread).toMatchObject({ state: "waiting", openDecisions: [decision] });
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

describe("passing an approval on", () => {
  const approval = aDecision({
    ...APPROVAL,
    id: "decision-1",
    putTo: "devops",
  });
  const waiting = aThread({ home: TASK_HOME, openDecisions: [approval] });
  const passing = {
    decisionId: "decision-1",
    by: "devops",
    to: "cto",
    reason: " It changes every Project's build. ",
    passedOnAt: AT,
  };

  it("puts it to the next one up, keeping who passed it on and why", () => {
    const passed = passDecisionOn(waiting, passing);

    const decision: Decision = {
      ...approval,
      putTo: "cto",
      passedOn: [
        { roleKey: "devops", reason: "It changes every Project's build.", passedOnAt: AT },
      ],
    };
    expect(passed.decision).toEqual(decision);
    expect(passed.thread.openDecisions[0]).toEqual(decision);
    expect(passed.event).toEqual(new DecisionReopened(passed.thread, decision, AT));
  });

  it("puts it to the user when nobody is next", () => {
    expect(passDecisionOn(waiting, { ...passing, to: undefined }).decision?.putTo).toBeUndefined();
  });

  it("is refused for a question, without a reason, and by someone it no longer waits on", () => {
    const question = aThread({
      home: TASK_HOME,
      openDecisions: [aDecision({ id: "decision-1", putTo: "devops" })],
    });
    expect(refusalOf(() => passDecisionOn(question, passing))[0]).toMatch(/Only an approval/);
    expect(refusalOf(() => passDecisionOn(waiting, { ...passing, reason: " " }))).toEqual([
      "Say why you pass it on.",
    ]);
    expect(refusalOf(() => passDecisionOn(waiting, { ...passing, by: "cto" }))[0]).toMatch(
      /no longer waits on you/,
    );
  });
});
