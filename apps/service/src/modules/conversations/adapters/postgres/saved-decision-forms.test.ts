import { describe, expect, it } from "vitest";
import type { DecisionAnswer, DecisionQuestion } from "../../domain/decision.js";
import {
  fromSavedFormAnswer,
  fromSavedQuestions,
  toSavedFormAnswer,
  toSavedQuestions,
} from "./saved-decision-forms.js";

const STORES: DecisionQuestion = {
  kind: "choice-of-several",
  question: "Where should drafts be kept?",
  options: ["IndexedDB", "Cookies", "The server"],
  recommendation: { options: [0, 2], reason: "They survive a reload." },
};

const FORMAT: DecisionQuestion = {
  kind: "choice",
  question: "Which format?",
  options: ["CSV", "JSON"],
  recommendation: { option: 1, reason: "Typed." },
};

describe("a choice of several as kept", () => {
  it("is a choice the release before reads, its first recommended option the choice's", () => {
    expect(toSavedQuestions([STORES, FORMAT])).toEqual([
      {
        kind: "choice",
        question: "Where should drafts be kept?",
        options: ["IndexedDB", "Cookies", "The server"],
        recommendation: { option: 0, reason: "They survive a reload." },
        several: { recommended: [0, 2] },
      },
      FORMAT,
    ]);
  });

  it("reads back as the choice of several it was, and a choice as a choice", () => {
    expect(fromSavedQuestions(toSavedQuestions([STORES, FORMAT]))).toEqual([STORES, FORMAT]);
  });

  it("keeps its answer as the options' names in words, marked with the options picked", () => {
    const answer: DecisionAnswer = {
      kind: "submitted",
      answers: [
        { kind: "options", options: [0, 1], comment: "Both." },
        { kind: "option", option: 0 },
      ],
      generalComment: "Thanks.",
    };

    const saved = toSavedFormAnswer(answer, [STORES, FORMAT]);

    expect(saved).toEqual({
      kind: "submitted",
      answers: [
        { kind: "words", text: "IndexedDB; Cookies", comment: "Both.", options: [0, 1] },
        { kind: "option", option: 0 },
      ],
      generalComment: "Thanks.",
    });
    expect(fromSavedFormAnswer(saved)).toEqual(answer);
  });

  it("names the options by their numbers when the Decision isn't at hand", () => {
    expect(
      toSavedFormAnswer({ kind: "submitted", answers: [{ kind: "options", options: [0, 2] }] }, []),
    ).toEqual({ kind: "submitted", answers: [{ kind: "words", text: "1; 3", options: [0, 2] }] });
  });

  it("keeps a dismissal as Ask me again marked dismissed, as before", () => {
    const saved = toSavedFormAnswer({ kind: "dismissed", generalComment: "Not now." }, []);

    expect(saved).toEqual({ kind: "asked-again", generalComment: "Not now.", dismissed: true });
    expect(fromSavedFormAnswer(saved)).toEqual({ kind: "dismissed", generalComment: "Not now." });
  });
});
