import { describe, expect, it } from "vitest";
import { headProblem, stageCommitMessage } from "./stage-commit.js";

describe("stageCommitMessage", () => {
  it("keeps the subject to one short line and the whole result below it", () => {
    const summary = `${"Renamed devices from their page and the list, ".repeat(2)}with a dialog.`;

    const [subject, body] = stageCommitMessage("Implement", { status: "done", summary }).split(
      "\n\n",
    );

    expect(subject).toHaveLength(72);
    expect(subject?.startsWith("Implement: Renamed devices")).toBe(true);
    expect(subject?.endsWith("…")).toBe(true);
    expect(body).toBe(summary);
  });

  it("tells a Stage waiting on a Decision, or failed, by its result", () => {
    const waiting = stageCommitMessage("Implement", {
      status: "needs-decision",
      question: "Which page?",
      context: "",
      options: ["The device page"],
      recommendation: { option: 0, reason: "Room." },
      handoverNote: "Half the dialog.",
    });
    const failed = stageCommitMessage("Review", { status: "failed", error: "The list broke." });

    expect(waiting).toBe(
      "Implement: Waiting on a Decision: Which page?\n\nWaiting on a Decision: Which page?\n\nHandover note:\nHalf the dialog.",
    );
    expect(failed).toBe("Review: Failed: The list broke.\n\nFailed: The list broke.");
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
