import { describe, expect, it } from "vitest";
import { headProblem, stageCommitMessage } from "./stage-commit.js";

describe("stageCommitMessage", () => {
  it("names the Stage and the Task in the subject, with the whole result below it", () => {
    const summary = `${"Renamed devices from their page and the list, ".repeat(2)}with a dialog.`;

    const [subject, body] = stageCommitMessage("Implement", " Rename devices ", {
      status: "done",
      summary,
    }).split("\n\n");

    expect(subject).toBe("Implement: Rename devices");
    expect(body).toBe(summary);
  });

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

  it("tells a switched branch before a moved commit", () => {
    expect(headProblem(expected, { commit: "b".repeat(40), branch: "main" })).toBe(
      "the worktree is on the branch main, not the Task's branch office/task",
    );
    expect(headProblem(expected, { commit: "b".repeat(40), branch: "office/task" })).toBe(
      "HEAD moved from aaaaaaaa to bbbbbbbb",
    );
  });
});
