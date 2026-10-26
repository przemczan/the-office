import { describe, expect, it } from "vitest";
import { publishOutcome, pullRequestText } from "./publish.js";
import type { Stage } from "./stage.js";
import type { StageRunDecision } from "./stage-run.js";
import { aStageRun } from "./stage-run.fixtures.js";

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Do it.",
  session: "fresh",
  budget: 250_000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 1 },
};
const lint: Stage = { kind: "script", key: "lint", name: "Lint", optional: true, command: "lint" };
const acceptance: Stage = {
  kind: "gate",
  key: "acceptance",
  name: "UI acceptance",
  optional: false,
};
const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};
const stages = [implement, tests, lint, acceptance, publish];
const task = {
  title: "Rename a device",
  definitionOfDone: ["The new name shows on the list", "The rename persists"],
};
const continuedWithIssues: StageRunDecision = {
  id: "decision-1",
  kind: "no-retries-left",
  options: [],
  answer: { kind: "accept-issues" },
};

describe("pullRequestText", () => {
  it("holds the Definition of Done, each Stage's latest result before Publish and the accepted issues", () => {
    const runs = [
      aStageRun({
        number: 1,
        stageKey: "implement",
        outcome: {
          status: "done",
          summary: "Added the rename dialog.\n\nIt saves on Enter.",
          definitionOfDoneMet: [1],
        },
      }),
      aStageRun({
        number: 2,
        stageKey: "tests",
        outcome: {
          status: "failed",
          error: "`npm test` failed with exit code 1.\n\nWhat it printed: …",
        },
        decisions: [continuedWithIssues],
      }),
      aStageRun({ number: 3, stageKey: "lint", outcome: undefined }),
      aStageRun({
        number: 4,
        stageKey: "acceptance",
        outcome: { status: "done", summary: "The Task waits at the Gate." },
        gateAction: { kind: "continue" },
      }),
      aStageRun({
        number: 5,
        stageKey: "publish",
        outcome: { status: "failed", error: "Pushing failed." },
      }),
    ];

    expect(pullRequestText(task, stages, runs, "publish")).toEqual({
      title: "Rename a device",
      body: [
        "## Definition of Done",
        "",
        "- [x] The new name shows on the list",
        "- [ ] The rename persists",
        "",
        "## Stage results",
        "",
        "### Implement",
        "",
        "Added the rename dialog.\n\nIt saves on Enter.",
        "",
        "### Tests",
        "",
        "Failed: `npm test` failed with exit code 1.",
        "",
        "### UI acceptance",
        "",
        "The user looked at the work and let it continue.",
        "",
        "## Issues the user accepted",
        "",
        "- Tests: `npm test` failed with exit code 1.",
      ].join("\n"),
    });
  });

  it("holds only the Definition of Done before any Stage has a result", () => {
    expect(pullRequestText(task, [publish], [], "publish").body).toBe(
      "## Definition of Done\n\n- [ ] The new name shows on the list\n- [ ] The rename persists",
    );
  });
});

describe("publishOutcome", () => {
  it("is done with the pull request it opened", () => {
    expect(
      publishOutcome({
        kind: "pull-request-opened",
        branch: "office/task-1",
        url: "https://github.com/notnullsoft/admin/pull/7",
      }),
    ).toEqual({
      status: "done",
      summary:
        "Pushed office/task-1 and opened the pull request https://github.com/notnullsoft/admin/pull/7",
    });
  });

  it("is done with where the merge left the base", () => {
    expect(
      publishOutcome({
        kind: "merged",
        branch: "office/task-1",
        into: { remote: "origin", branch: "main" },
        commit: "0123456789abcdef0123456789abcdef01234567",
        rebased: false,
      }),
    ).toEqual({
      status: "done",
      summary: "Merged office/task-1 into main on origin, which is now at 01234567.",
    });
  });

  it("says it rebased the branch first when the base had moved on", () => {
    expect(
      publishOutcome({
        kind: "merged",
        branch: "office/task-1",
        into: { remote: "origin", branch: "main" },
        commit: "0123456789abcdef0123456789abcdef01234567",
        rebased: true,
      }),
    ).toEqual({
      status: "done",
      summary:
        "Rebased office/task-1 onto main, which had moved on, then merged it into main on origin, which is now at 01234567.",
    });
  });

  it("is done when there was nothing to publish", () => {
    expect(
      publishOutcome({
        kind: "nothing-to-publish",
        branch: "office/task-1",
        base: { remote: "origin", branch: "main" },
      }),
    ).toEqual({
      status: "done",
      summary: "office/task-1 adds nothing to main on origin, so there was nothing to publish.",
    });
  });

  it("fails with the base moved on, which asks the user, or with the error, which goes back", () => {
    expect(
      publishOutcome({ kind: "base-moved", error: "It conflicts.", conflictedFiles: ["a.ts"] }),
    ).toEqual({
      status: "failed",
      error: "It conflicts.",
      baseMoved: { conflictedFiles: ["a.ts"] },
    });
    expect(publishOutcome({ kind: "failed", error: "Pushing failed." })).toEqual({
      status: "failed",
      error: "Pushing failed.",
    });
  });
});
