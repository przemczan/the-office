import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptStage } from "../domain/stage.js";
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
import { PLANNED_COMMIT, RESOLVED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { RESOLVE_GATE_KEY, RESOLVE_KEY, RESOLVE_TEST_KEY } from "../domain/resolve-stages.js";
import { GateService } from "./gate-service.js";
import { StageInterpreter } from "./stage-interpreter.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

const implement = anAgentStage("implement", { name: "Implement" });
const publish: ScriptStage = {
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
        target: "publishing-mode",
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

  it("pushes the branch only when its target says so, then removes the worktree", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult("Tried it out."))]);
    pipelines.publishing.publications.push({
      kind: "branch-pushed",
      branch: "office/task",
      remote: "origin",
    });

    const taskId = await walkStages(pipelines, [
      implement,
      { ...publish, publishTarget: "branch-only" },
    ]);

    expect(pipelines.publishing.published.map(({ target }) => target)).toEqual(["branch-only"]);
    expect((await runsOf(pipelines, taskId)).at(-1)?.outcome).toEqual({
      status: "done",
      summary:
        "Pushed office/task to origin, with no pull request and no merge, as this Publish pushes the branch only.",
    });
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

  it("goes to Resolve when the branch conflicts with the base: the Task's person resolves, The Office commits the merge, the Test and a Gate run, then Publish again", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Kept both renames.")),
    ]);
    const error =
      "office/task no longer applies cleanly on main on origin: merging it would conflict in\n- src/index.ts";
    pipelines.publishing.publications.push({
      kind: "base-moved",
      error,
      conflictedFiles: ["src/index.ts"],
    });

    const taskId = await walkStages(pipelines, [implement, publish]);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      [RESOLVE_KEY, "done"],
      [RESOLVE_TEST_KEY, "done"],
      [RESOLVE_GATE_KEY, "done"],
    ]);
    expect(runs[2]?.carriedFailure).toEqual({ stageKey: "publish", error, round: 1, rounds: 3 });
    expect(runs[2]?.headCommit).toBe(RESOLVED_COMMIT);
    expect(pipelines.publishing.resolveCalls).toEqual([
      { call: "start", taskId },
      { call: "finish", taskId },
    ]);
    // The merge is The Office's: the Agent's work isn't committed apart from it.
    expect(pipelines.git.commits).toHaveLength(1);
    expect(pipelines.commands.ran.map(({ key }) => key)).toEqual(["test"]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
    expect(pipelines.git.removedWorktrees).toEqual([]);

    const after = await pipelines.app.get(GateService).continue(taskId);
    await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);

    expect(after?.stages.map(({ stage }) => stage.name)).toEqual([
      "Implement",
      "Resolve",
      "Test after Resolve",
      "Review the resolved conflict",
      "Publish",
    ]);
    expect((await runsOf(pipelines, taskId)).at(-1)).toMatchObject({
      stageKey: "publish",
      outcome: { status: "done" },
    });
    expect(pipelines.publishing.published).toHaveLength(2);
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
  });

  it("asks the user directly when Resolve gives up, and commits the merge once they resolved it in the worktree", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Couldn't tell which rename wins.")),
    ]);
    pipelines.publishing.publications.push({
      kind: "base-moved",
      error: "office/task no longer applies cleanly on main on origin.",
      conflictedFiles: ["src/index.ts"],
    });
    pipelines.publishing.resolveEnds.push({ kind: "markers-left", files: ["src/index.ts"] });

    const taskId = await walkStages(pipelines, [implement, publish]);

    expect((await runsOf(pipelines, taskId)).at(-1)).toMatchObject({
      stageKey: RESOLVE_KEY,
      outcome: { status: "failed" },
    });
    const asked = pipelines.decisions.on(taskId).at(-1);
    expect(asked?.draft.options).toEqual(["I resolved it in the worktree", "Drop the Task"]);
    expect(asked?.putTo).toBeUndefined();

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 0 });

    const runs = await runsOf(pipelines, taskId);
    expect(runs.slice(2).map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      [RESOLVE_KEY, "failed"],
      [RESOLVE_KEY, "done"],
      [RESOLVE_TEST_KEY, "done"],
      [RESOLVE_GATE_KEY, "done"],
    ]);
    expect(pipelines.publishing.resolveCalls.map(({ call }) => call)).toEqual([
      "start",
      "finish",
      "finish",
    ]);
    expect(runs[3]?.headCommit).toBe(RESOLVED_COMMIT);
  });

  it("leaves the branch where a rebasing merge left it, for any Stage after it to expect", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const rebased = "r".repeat(40);
    pipelines.publishing.publications.push({
      kind: "merged",
      branch: "office/task",
      into: { remote: "origin", branch: "main" },
      commit: rebased,
      baseTakenIn: "by-rebase",
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
