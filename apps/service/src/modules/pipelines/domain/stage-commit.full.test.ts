import { describe, expect, it } from "vitest";
import { baseWords } from "./base-words.js";
import { branchUpdateWords, headProblem, stageCommitMessage } from "./stage-commit.js";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { PIPELINES_PROMPT_TEMPLATES } from "./pipelines-prompt-templates.js";

const prompts = defaultPromptTexts(PIPELINES_PROMPT_TEMPLATES);

describe("stageCommitMessage", () => {
  it("keeps the subject to one short line when the Task's title is long", () => {
    const title = "Rename devices from their page and the list, ".repeat(2);

    const [subject] = stageCommitMessage("Implement", title, {
      status: "done",
      summary: "Done.",
    }).split("\n\n");

    expect(subject?.length).toBeLessThanOrEqual(72);
    expect(subject?.startsWith("Implement: Rename devices")).toBe(true);
    expect(subject?.endsWith("…")).toBe(true);
  });

  it("names the issues the user accepted, each by its first line", () => {
    const message = stageCommitMessage(
      "Review & fix",
      "Fix the list",
      { status: "done", summary: "Fixed the list.", handoverNote: "All set." },
      [{ stageName: "Tests", error: "2 tests fail.\n\nThe output." }],
    );

    expect(message).toBe(
      "Review & fix: Fix the list\n\nFixed the list.\n\nHandover note:\nAll set.\n\nIssues the user accepted:\n- Tests: 2 tests fail.",
    );
  });

  it("tells a Stage waiting on a Decision, or failed, by its result in the body", () => {
    const waiting = stageCommitMessage("Implement", "Rename devices", {
      status: "needs-decision",
      question: "Which page?",
      context: "",
      options: ["The device page"],
      recommendation: { option: 0, reason: "Room." },
      handoverNote: "Half the dialog.",
    });
    const failed = stageCommitMessage("Review", "Rename devices", {
      status: "failed",
      error: "The list broke.",
    });

    expect(waiting).toBe(
      "Implement: Rename devices\n\nWaiting on a Decision: Which page?\n\nHandover note:\nHalf the dialog.",
    );
    expect(failed).toBe("Review: Rename devices\n\nFailed: The list broke.");
  });
});

describe("headProblem", () => {
  const expected = { commit: "a".repeat(40), branch: "office/task" };

  it("finds none where The Office left HEAD", () => {
    expect(headProblem(expected, { ...expected })).toBeUndefined();
  });
});

describe("branchUpdateWords", () => {
  const bases = baseWords({
    project: { baseBranch: "main" },
    initiativeBranch: "initiative/usage-exports",
  });

  it("names the Initiative's branch, then the base, as what the branch was brought up to date with", () => {
    expect(branchUpdateWords(prompts, { kind: "updated", commit: "c".repeat(40) }, bases)).toBe(
      "The Office brought the Task's branch up to date with initiative/usage-exports, then main as this Stage started, so the code may be newer than the Plan.",
    );
  });

  it("names the branch that conflicted, and keeps a clean merge before it", () => {
    const conflicted = { kind: "conflicted", conflictedFiles: ["a.ts"], from: "main" } as const;

    expect(branchUpdateWords(prompts, conflicted, bases)).toBe(
      "The Task's branch is behind main and conflicts with it in a.ts, so it stays as it was. When your work needs what the base has, call update_branch and resolve the conflict in the files.",
    );
    expect(branchUpdateWords(prompts, { ...conflicted, commit: "c".repeat(40) }, bases)).toContain(
      "conflicts with it in a.ts, so it took in what came before it and stays without it.",
    );
  });

  it("names the base branch alone for a Task of no Initiative", () => {
    expect(baseWords({ project: { baseBranch: "main" } })).toBe("main");
  });
});
