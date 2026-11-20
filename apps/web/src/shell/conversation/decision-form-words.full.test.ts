import type { Decision, DecisionQuestion } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  acceptAnswer,
  allChoices,
  answeredCount,
  answeredLines,
  askedAgainAnswer,
  canBeDismissed,
  decisionSummary,
  dismissedAnswer,
  draftAnswerWords,
  draftChanges,
  draftKeptWords,
  formAnswerWords,
  initialDraft,
  isCompact,
  missingAnswer,
  moreQuestionsWords,
  progressWords,
  submitBlockedWords,
  submittedAnswer,
  type DecisionDraft,
} from "./decision-form-words.ts";

const STORE: DecisionQuestion = {
  kind: "choice",
  question: "Where do drafts live?",
  options: ["localStorage", "IndexedDB"],
  recommendation: { option: 1, reason: "Drafts can hold pictures." },
};
const NAME: DecisionQuestion = { kind: "open", question: "What do we call it?" };
const KEEP: DecisionQuestion = {
  kind: "choice",
  question: "Keep drafts after sending?",
  options: ["Keep", "Drop"],
  recommendation: { option: 1, reason: "Nobody reads them again." },
};

type Form = Pick<Decision, "questions" | "attachmentIds">;
const MIXED: Form = { questions: [STORE, NAME, KEEP], attachmentIds: [] };

function changed(
  draft: DecisionDraft,
  index: number,
  change: Partial<DecisionDraft["questions"][number]>,
): DecisionDraft {
  return {
    ...draft,
    questions: draft.questions.map((question, at) =>
      at === index ? { ...question, ...change } : question,
    ),
  };
}

describe("a fresh draft", () => {
  it("picks every choice's recommended option and writes nothing", () => {
    expect(initialDraft(MIXED)).toEqual({
      questions: [
        { option: 1, words: "", comment: "" },
        { option: null, words: "", comment: "" },
        { option: 1, words: "", comment: "" },
      ],
      generalComment: "",
    });
  });

  it("counts untouched recommendations as answered, an empty open question not", () => {
    const draft = initialDraft(MIXED);
    expect(answeredCount(MIXED, draft)).toBe(2);
    expect(progressWords(MIXED, draft)).toBe("2 of 3 answered");
    expect(missingAnswer(MIXED, draft)).toBe(1);
  });
});

describe("Submit's reason to wait", () => {
  it("names an empty open question", () => {
    expect(submitBlockedWords(MIXED, initialDraft(MIXED))).toBe("Answer question 2 first.");
  });

  it("names a choice answered by None of these with no words yet", () => {
    const draft = changed(changed(initialDraft(MIXED), 1, { words: "Drafts" }), 2, {
      option: null,
    });
    expect(submitBlockedWords(MIXED, draft)).toBe("Answer question 3 in its words first.");
  });

  it("asks for an option or words on a form of one question", () => {
    const one = { questions: [STORE] };
    expect(submitBlockedWords(one, changed(initialDraft(one), 0, { option: null }))).toBe(
      "Pick an option or write your answer first.",
    );
    const open = { questions: [NAME] };
    expect(submitBlockedWords(open, initialDraft(open))).toBe("Write your answer first.");
  });

  it("has none once every question is answered", () => {
    const draft = changed(initialDraft(MIXED), 1, { words: "Drafts" });
    expect(submitBlockedWords(MIXED, draft)).toBeUndefined();
    expect(progressWords(MIXED, draft)).toBe("3 of 3 answered");
  });
});

describe("the answers sent", () => {
  it("Submit sends each answer in order, a choice's comment alone as its words", () => {
    let draft = initialDraft(MIXED);
    draft = changed(draft, 0, { comment: " Pictures matter. " });
    draft = changed(draft, 1, { words: " Drafts ", comment: "Short." });
    draft = changed(draft, 2, { option: null, comment: "Keep a week" });
    draft = { ...draft, generalComment: "  Thanks " };

    expect(submittedAnswer(MIXED, draft)).toEqual({
      kind: "submitted",
      answers: [
        { kind: "option", option: 1, comment: "Pictures matter." },
        { kind: "words", text: "Drafts", comment: "Short." },
        { kind: "words", text: "Keep a week" },
      ],
      generalComment: "Thanks",
    });
  });

  it("leaves out empty comments", () => {
    const draft = changed(initialDraft(MIXED), 1, { words: "Drafts" });
    expect(submittedAnswer(MIXED, draft)).toEqual({
      kind: "submitted",
      answers: [
        { kind: "option", option: 1 },
        { kind: "words", text: "Drafts" },
        { kind: "option", option: 1 },
      ],
    });
  });

  it("Accept sends every recommended option and no comments", () => {
    const choices = { questions: [STORE, KEEP] };
    expect(allChoices(choices)).toBe(true);
    expect(allChoices(MIXED)).toBe(false);
    expect(acceptAnswer(choices)).toEqual({
      kind: "submitted",
      answers: [
        { kind: "option", option: 1 },
        { kind: "option", option: 1 },
      ],
    });
  });

  it("Ask me again sends the general comment alone", () => {
    expect(askedAgainAnswer(" Why not SQLite? ")).toEqual({
      kind: "asked-again",
      generalComment: "Why not SQLite?",
    });
    expect(askedAgainAnswer("  ")).toEqual({ kind: "asked-again" });
  });
});

describe("the Decision in short", () => {
  it("is its first question, and how many more it asks", () => {
    expect(decisionSummary({ questions: [STORE] })).toBe("Where do drafts live?");
    expect(decisionSummary(MIXED)).toBe("Where do drafts live? (and 2 more questions)");
    expect(decisionSummary({ questions: [STORE, NAME] })).toBe(
      "Where do drafts live? (and 1 more question)",
    );
  });

  it("is compact past 3 questions, or with any Attachment", () => {
    expect(isCompact(MIXED)).toBe(false);
    expect(isCompact({ questions: [STORE, NAME, KEEP, STORE], attachmentIds: [] })).toBe(true);
    expect(isCompact({ questions: [STORE], attachmentIds: ["a"] })).toBe(true);
  });

  it("is compact in the feed from 2 questions, or with any Attachment", () => {
    expect(isCompact({ questions: [STORE], attachmentIds: [] }, "feed")).toBe(false);
    expect(isCompact({ questions: [STORE, NAME], attachmentIds: [] }, "feed")).toBe(true);
    expect(isCompact({ questions: [STORE, NAME], attachmentIds: [] })).toBe(false);
    expect(isCompact({ questions: [STORE], attachmentIds: ["a"] }, "feed")).toBe(true);
  });

  it("lets the user dismiss only an open Decision a person asked them in their own Thread", () => {
    const open = {
      kind: "form",
      roleKey: "planner",
      inStageThread: false,
      putTo: null,
      formAnswer: null,
      closedAt: null,
    } as const;
    expect(canBeDismissed(open)).toBe(true);
    expect(canBeDismissed({ ...open, kind: "request" })).toBe(true);
    expect(canBeDismissed({ ...open, kind: "approval" })).toBe(false);
    expect(canBeDismissed({ ...open, roleKey: null })).toBe(false);
    expect(canBeDismissed({ ...open, inStageThread: true })).toBe(false);
    expect(canBeDismissed({ ...open, putTo: "reviewer" })).toBe(false);
    expect(canBeDismissed({ ...open, formAnswer: { kind: "dismissed" } })).toBe(false);
    expect(canBeDismissed({ ...open, closedAt: "2026-11-15T09:00:00.000Z" })).toBe(false);
  });

  it("says how many more questions the compact card holds, and how many are open", () => {
    expect(moreQuestionsWords({ questions: [STORE] })).toBeUndefined();
    expect(moreQuestionsWords({ questions: [STORE, KEEP] })).toBe("1 more question");
    expect(moreQuestionsWords({ questions: [STORE, NAME, KEEP, NAME] })).toBe(
      "3 more questions, 2 of them open questions",
    );
  });

  it("counts the draft's changes from the recommendations", () => {
    let draft = initialDraft(MIXED);
    expect(draftChanges(MIXED, draft)).toBe(0);
    draft = changed(draft, 0, { option: 0 });
    draft = changed(draft, 2, { comment: "Hm" });
    draft = { ...draft, generalComment: "All good" };
    expect(draftChanges(MIXED, draft)).toBe(3);
    expect(draftKeptWords(1)).toBe("Draft kept · 1 change");
    expect(draftKeptWords(2)).toBe("Draft kept · 2 changes");
  });

  it("says each question's answer so far", () => {
    expect(draftAnswerWords(STORE, { option: 1, words: "", comment: "" })).toBe(
      "IndexedDB (recommended)",
    );
    expect(draftAnswerWords(STORE, { option: 0, words: "", comment: "" })).toBe("localStorage");
    expect(draftAnswerWords(STORE, { option: null, words: "", comment: "" })).toBe(
      "Needs an answer in words",
    );
    expect(draftAnswerWords(STORE, { option: null, words: "", comment: "SQLite" })).toBe(
      "In words: SQLite",
    );
    expect(draftAnswerWords(NAME, { option: null, words: "", comment: "" })).toBe(
      "Needs an answer",
    );
  });
});

describe("an answered form", () => {
  const answer = {
    kind: "submitted" as const,
    answers: [
      { kind: "option" as const, option: 1, comment: "Pictures." },
      { kind: "words" as const, text: "Drafts" },
      { kind: "option" as const, option: 0 },
    ],
    generalComment: "Thanks",
  };

  it("marks the recommended option and keeps each comment", () => {
    expect(answeredLines(MIXED, answer)).toEqual([
      {
        number: 1,
        question: STORE.question,
        answer: "IndexedDB",
        recommended: true,
        inWords: false,
        comment: "Pictures.",
      },
      {
        number: 2,
        question: NAME.question,
        answer: "Drafts",
        recommended: false,
        inWords: true,
        comment: undefined,
      },
      {
        number: 3,
        question: KEEP.question,
        answer: "Keep",
        recommended: false,
        inWords: false,
        comment: undefined,
      },
    ]);
  });

  it("reads in words: one question's answer alone, several each with its question", () => {
    expect(
      formAnswerWords(
        { questions: [STORE] },
        { kind: "submitted", answers: [{ kind: "option", option: 1, comment: "Pictures." }] },
      ),
    ).toBe("IndexedDB\n\nComment: Pictures.");
    expect(formAnswerWords(MIXED, answer)).toBe(
      [
        "1. Where do drafts live?: **IndexedDB**. Pictures.",
        "2. What do we call it?: **Drafts**",
        "3. Keep drafts after sending?: **Keep**",
        "",
        "General comment: Thanks",
      ].join("\n"),
    );
    expect(formAnswerWords(MIXED, { kind: "asked-again", generalComment: "Why?" })).toBe(
      "Asked again: Why?",
    );
    expect(formAnswerWords(MIXED, { kind: "asked-again" })).toBe("Asked again, with no comment.");
    expect(formAnswerWords(MIXED, dismissedAnswer(" Not needed "))).toBe("Dismissed: Not needed");
    expect(formAnswerWords(MIXED, dismissedAnswer(""))).toBe("Dismissed, with no comment.");
  });
});
