import { afterEach, describe, expect, it } from "vitest";
import {
  aDoneResult,
  anAgentSession,
  answerLastDecision,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { RESOLVE_GATE_KEY, RESOLVE_KEY, RESOLVE_TEST_KEY } from "../domain/resolve-stages.js";
import { GateService } from "./gate-service.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { implement, publish, reviewedPublish, PULL_REQUEST } from "../publish-stage.fixtures.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

describe("A Publish Stage", () => {
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

  it("publishes automatically once a conflict is resolved and tested, when the Publish asks for no review", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Kept both renames.")),
    ]);
    pipelines.publishing.publications.push({
      kind: "base-moved",
      error: "office/task no longer applies cleanly on main on origin.",
      conflictedFiles: ["src/index.ts"],
    });

    const taskId = await walkStages(pipelines, [implement, publish]);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      [RESOLVE_KEY, "done"],
      [RESOLVE_TEST_KEY, "done"],
      ["publish", "done"],
    ]);
    expect(pipelines.publishing.published).toHaveLength(2);
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
  });

  it("runs Resolve's Agent on the merged branch with the feedback its Gate sent back, committing as any Stage", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Kept both renames.")),
      anAgentSession(aDoneResult("Kept the longer name.")),
    ]);
    pipelines.publishing.publications.push({
      kind: "base-moved",
      error: "office/task no longer applies cleanly on main on origin.",
      conflictedFiles: ["src/index.ts"],
    });
    const taskId = await walkStages(pipelines, [implement, reviewedPublish]);

    await pipelines.app
      .get(GateService)
      .sendBack(taskId, RESOLVE_KEY, "Keep the longer of the two names.");
    await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.slice(2).map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      [RESOLVE_KEY, "done"],
      [RESOLVE_TEST_KEY, "done"],
      [RESOLVE_GATE_KEY, "done"],
      [RESOLVE_KEY, "done"],
      [RESOLVE_TEST_KEY, "done"],
      [RESOLVE_GATE_KEY, "done"],
    ]);
    // No second merge: the Gate's round is the Agent's, committed as an ordinary Stage commit.
    expect(pipelines.publishing.resolveCalls.map(({ call }) => call)).toEqual(["start", "finish"]);
    expect(pipelines.git.commits).toHaveLength(2);
    const work = pipelines.stageThreads.requests.at(-1)?.work;
    expect(work).toContain("The merge is committed already");
    expect(work).toContain("Keep the longer of the two names.");
  });

  it("gives the worktree back from Resolve's merge when the user drops the Task", async () => {
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

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

    expect(pipelines.tasks.changes.at(-1)).toEqual({ taskId, state: "dropped" });
    expect(pipelines.publishing.resolveCalls.map(({ call }) => call)).toEqual([
      "start",
      "finish",
      "abandon",
    ]);
  });

  it("leaves git alone when a Task Resolve never ran on is dropped", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = await walkStages(pipelines, [implement, publish]);

    await pipelines.tasks.drop(taskId);

    expect(pipelines.publishing.resolveCalls).toEqual([]);
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
      pullRequestUrl: PULL_REQUEST,
    });
  });
});
