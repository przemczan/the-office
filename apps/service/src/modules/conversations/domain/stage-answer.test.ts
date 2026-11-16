import { describe, expect, it } from "vitest";
import { formAnswerWords, oneOptionAnswer, type DecisionAnswer } from "./decision.js";
import { AT, aDecision, THREE_QUESTIONS } from "./decision.fixtures.js";
import { stageAnswerOf } from "./stage-answer.js";

describe("a Decision's answer as a Task's Pipeline takes it", () => {
  const theOffices = aDecision({ roleKey: undefined });
  const answered = (answer: DecisionAnswer, answeredBy?: string) =>
    aDecision({ ...theOffices, answer: { ...answer, answeredAt: AT, answeredBy } });

  it("is undefined while the Decision waits", () => {
    expect(stageAnswerOf(theOffices)).toBeUndefined();
  });

  it("gives The Office's own form the option picked, its comment and the general comment its guidance", () => {
    expect(stageAnswerOf(answered(oneOptionAnswer(1)))).toEqual({ kind: "option", option: 1 });
    expect(
      stageAnswerOf(
        answered({
          kind: "submitted",
          answers: [{ kind: "option", option: 0, comment: " Fix the flaky test first. " }],
          generalComment: "Then run it twice.",
        }),
      ),
    ).toEqual({
      kind: "option",
      option: 0,
      guidance: "Fix the flaky test first.\n\nThen run it twice.",
    });
  });

  it("joins the words, the question's comment and the general comment, keeping who answered", () => {
    expect(
      stageAnswerOf(
        answered(
          {
            kind: "submitted",
            answers: [
              { kind: "words", text: "Retry with a longer timeout.", comment: "It hangs." },
            ],
            generalComment: " ",
          },
          "cto",
        ),
      ),
    ).toEqual({
      kind: "free-answer",
      text: "Retry with a longer timeout.\n\nIt hangs.",
      answeredBy: "cto",
    });
  });

  it("gives an Agent's own form in words, as its session gets them", () => {
    const form = aDecision({ questions: THREE_QUESTIONS });
    const answer: DecisionAnswer = {
      kind: "submitted",
      answers: [
        { kind: "option", option: 1 },
        { kind: "words", text: "2026" },
        { kind: "option", option: 0, comment: "For the spreadsheet." },
      ],
      generalComment: "Thanks.",
    };
    expect(
      stageAnswerOf({ ...form, answer: { ...answer, answeredAt: AT, answeredBy: "cto" } }),
    ).toEqual({ kind: "free-answer", text: formAnswerWords(form, answer), answeredBy: "cto" });
    const askedAgain: DecisionAnswer = { kind: "asked-again", generalComment: "Why CSV?" };
    expect(stageAnswerOf({ ...form, answer: { ...askedAgain, answeredAt: AT } })).toEqual({
      kind: "free-answer",
      text: formAnswerWords(form, askedAgain),
    });
  });
});
