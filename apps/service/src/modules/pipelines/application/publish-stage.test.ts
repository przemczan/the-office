import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  answerLastDecision,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

const implement = anAgentStage("implement", { name: "Implement" });
const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
  onFailure: { goBackTo: "implement", rounds: 1 },
};
const PULL_REQUEST = "https://github.com/notnullsoft/admin/pull/7";

describe("A Publish Stage", () => {
  it("publishes the Task's branch with a pull request worded from its record, then removes the worktree", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult("Added the dialog."))]);

    const taskId = await walkStages(pipelines, [implement, publish]);

    expect(pipelines.publishing.published).toEqual([
      {
        taskId,
        text: {
          title: "Rename a device",
          body: [
            "## Definition of Done",
            "",
            "- [x] The new name shows on the list",
            "- [x] The rename persists",
            "",
            "## Stage results",
            "",
            "### Implement",
            "",
            "Added the dialog.",
          ].join("\n"),
        },
      },
    ]);
    const [implemented, published] = await runsOf(pipelines, taskId);
    expect(published?.outcome).toEqual({
      status: "done",
      summary: `Pushed office/task and opened the pull request ${PULL_REQUEST}`,
    });
    expect(published?.headCommit).toBe(implemented?.headCommit);
    expect(pipelines.commands.ran).toEqual([]);
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("ends the waiting sessions of the Task's Threads before it removes the worktree they work in", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const calls: string[] = [];
    pipelines.threadSessions.observe = (taskId) => void calls.push(`end sessions of ${taskId}`);
    pipelines.git.observe = (call) => {
      if (call === "removeWorktree") calls.push(call);
    };

    const taskId = await walkStages(pipelines, [implement, publish]);

    expect(calls).toEqual([`end sessions of ${taskId}`, "removeWorktree"]);
  });

  it("goes to its on-failure target with the error, keeping the worktree until it publishes", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Removed the workflow change.")),
    ]);
    const error =
      "GitHub refused the push of office/task to office/task on origin: the change touches .github/workflows.";
    pipelines.publishing.publications.push({ kind: "failed", error });
    const removedBefore: string[] = [];
    pipelines.git.observe = (call) => {
      if (call === "removeWorktree")
        removedBefore.push(String(pipelines.publishing.published.length));
    };

    const taskId = await walkStages(pipelines, [implement, publish]);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      ["implement", "done"],
      ["publish", "done"],
    ]);
    expect(runs[1]?.outcome).toEqual({ status: "failed", error });
    expect(runs[2]?.carriedFailure).toEqual({ stageKey: "publish", error, round: 1, rounds: 1 });
    // Removed once, after the second Publish.
    expect(removedBefore).toEqual(["2"]);
  });

  it("asks the user when the base moved on, going back nowhere, and publishes again once told", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const error =
      "office/task no longer applies cleanly on main on origin: merging it would conflict in\n- src/index.ts";
    pipelines.publishing.publications.push({
      kind: "base-moved",
      error,
      conflictedFiles: ["src/index.ts"],
    });

    const taskId = await walkStages(pipelines, [implement, publish]);

    expect((await runsOf(pipelines, taskId)).at(-1)?.outcome).toEqual({
      status: "failed",
      error,
      baseMoved: { conflictedFiles: ["src/index.ts"] },
    });
    expect(pipelines.decisions.on(taskId).at(-1)?.draft).toMatchObject({
      question:
        "\"Publish\" can't publish: the Task's branch conflicts with the base branch. What now?",
      options: ['Run "Publish" again', "Continue without publishing", "Drop the Task"],
    });
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
    expect(pipelines.git.removedWorktrees).toEqual([]);

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      ["publish", "done"],
    ]);
    expect(runs[2]?.carriedFailure).toBeUndefined();
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
  });

  it("leaves the branch where a rebasing merge left it, for any Stage after it to expect", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const rebased = "r".repeat(40);
    pipelines.publishing.publications.push({
      kind: "merged",
      branch: "office/task",
      into: { remote: "origin", branch: "main" },
      commit: rebased,
      rebased: true,
    });

    const taskId = await walkStages(pipelines, [implement, publish]);

    const published = (await runsOf(pipelines, taskId)).at(-1);
    expect(published?.headCommit).toBe(rebased);
    expect(published?.outcome).toEqual({
      status: "done",
      summary:
        "Rebased office/task onto main, which had moved on, then merged it into main on origin, which is now at rrrrrrrr.",
    });
  });

  it("tells of a worktree it couldn't remove, its publishing done all the same", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    pipelines.git.removalFailure =
      "EBUSY: resource busy or locked, rmdir 'D:\\office\\worktrees\\task'";

    const taskId = await walkStages(pipelines, [implement, publish]);

    expect((await runsOf(pipelines, taskId)).at(-1)?.outcome).toEqual({
      status: "done",
      summary: `Pushed office/task and opened the pull request ${PULL_REQUEST}\n\nThe Office couldn't remove the Task's worktree, which stays: EBUSY: resource busy or locked, rmdir 'D:\\office\\worktrees\\task'`,
    });
  });

  it("publishes nothing from a worktree that isn't where The Office left it", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.git.move(taskId, { commit: PLANNED_COMMIT, branch: "main" });

    await walkStages(pipelines, [publish], taskId);

    expect((await runsOf(pipelines, taskId))[0]?.outcome).toEqual({
      status: "failed",
      error:
        "The Task's worktree isn't where The Office left it: the worktree is on the branch main, not the Task's branch office/task. The Stage didn't start; put the branch back to go on.",
    });
    expect(pipelines.publishing.published).toEqual([]);
  });
});
