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
});

describe("headProblem", () => {
  const expected = { commit: "a".repeat(40), branch: "office/task" };

  it("tells a switched branch before a moved commit", () => {
    expect(headProblem(expected, { commit: "b".repeat(40), branch: "main" })).toBe(
      "the worktree is on the branch main, not the Task's branch office/task",
    );
    expect(headProblem(expected, { commit: "b".repeat(40), branch: "office/task" })).toBe(
      "HEAD moved from aaaaaaaa to bbbbbbbb",
    );
  });
});
