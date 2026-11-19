import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
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
import { aTaskRecord, PLANNED_COMMIT, RESOLVED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { RESOLVE_GATE_KEY, RESOLVE_KEY, RESOLVE_TEST_KEY } from "../domain/resolve-stages.js";
import { SIGNED_IN_FOR_TESTS } from "../../../platform/http/signed-in-requests.fixtures.js";
import { userOf } from "../../../platform/http/signed-in-requests.js";
import { GateService } from "./gate-service.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { StageRunsFiles } from "./stage-runs-files.js";
import { implement, publish, reviewedPublish, PULL_REQUEST } from "../publish-stage.fixtures.js";

const ANN = userOf(SIGNED_IN_FOR_TESTS);

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

describe("A Publish Stage", () => {
  it("publishes the Task's branch with its commit message, marks the message published, then removes the worktree", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult("Added the dialog."))]);

    const taskId = await walkStages(pipelines, [implement, publish]);

    expect(pipelines.publishing.published).toEqual([
      {
        taskId,
        message: {
          subject: "Rename a device",
          body: "Adds a rename dialog to the device page.",
          whole: "Rename a device\n\nAdds a rename dialog to the device page.",
        },
        target: "publishing-mode",
      },
    ]);
    expect(pipelines.tasks.commitMessagesPublished).toEqual([taskId]);
    const [implemented, published] = await runsOf(pipelines, taskId);
    expect(published?.outcome).toEqual({
      status: "done",
      summary: `Pushed office/task and opened the pull request ${PULL_REQUEST}`,
      pullRequestUrl: PULL_REQUEST,
    });
    expect(published?.headCommit).toBe(implemented?.headCommit);
    expect(pipelines.commands.ran).toEqual([]);
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("removes the Task's folder of its earlier Stage runs with its worktree", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult("Added the dialog."))]);
    const taskId = randomUUID();
    const file = await pipelines.app.get(StageRunsFiles, { strict: false }).write(taskId, {
      version: 1,
      task: { id: taskId, title: "", project: "" },
      route: { from: "implement", to: null },
      definitionOfDone: [],
      stageRuns: [],
    });

    await walkStages(pipelines, [implement, publish], taskId);

    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
    expect(existsSync(dirname(file))).toBe(false);
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
    expect(pipelines.tasks.commitMessagesPublished).toEqual([]);
    expect((await runsOf(pipelines, taskId)).at(-1)?.outcome).toEqual({
      status: "done",
      summary:
        "Pushed office/task to origin, with no pull request and no merge, as this Publish pushes the branch only.",
    });
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
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
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/index.ts"]);

    await walkStages(pipelines, [implement, reviewedPublish], taskId);

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
    // The merge commit records only what its resolution changed.
    expect(runs[2]?.changedFiles).toEqual(["src/index.ts"]);
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

    const after = await pipelines.app.get(GateService).continue(taskId, ANN);
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

  it("publishes an Initiative's Task into its branch, resolving a conflict with the base after a clean merge of the Initiative's branch", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Kept both renames.")),
    ]);
    const taskId = randomUUID();
    const initiativeBranch = "initiative/usage-exports";
    pipelines.records.put(taskId, aTaskRecord({ initiativeBranch }));
    const initiativeMergedAtPublish = "b".repeat(40);
    // The Initiative's branch moved on again before Resolve fetched it.
    const initiativeMerged = "c".repeat(40);
    const published = "f".repeat(40);
    pipelines.publishing.publications.push(
      {
        kind: "base-moved",
        error:
          "office/task no longer applies cleanly on main on origin: it would conflict in\n- src/index.ts",
        conflictedFiles: ["src/index.ts"],
        commit: initiativeMergedAtPublish,
      },
      {
        kind: "merged",
        branch: "office/task",
        into: { remote: "origin", branch: initiativeBranch },
        commit: published,
        subject: "Rename a device",
        head: "e".repeat(40),
        baseTakenIn: "by-merge",
        basesTakenIn: [initiativeBranch, "main"],
      },
    );
    pipelines.publishing.resolveStarts.push({
      kind: "conflicted",
      base: { remote: "origin", branch: "main" },
      conflictedFiles: ["src/index.ts"],
      commit: initiativeMerged,
    });

    await walkStages(pipelines, [implement, reviewedPublish], taskId);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["implement", "done"],
      ["publish", "failed"],
      [RESOLVE_KEY, "done"],
      [RESOLVE_TEST_KEY, "done"],
      [RESOLVE_GATE_KEY, "done"],
    ]);
    expect(runs[1]?.headCommit).toBe(initiativeMergedAtPublish);
    expect(runs[2]?.headCommit).toBe(RESOLVED_COMMIT);
    expect(pipelines.stageThreads.requests.at(-1)?.work).toContain(
      "The Task's branch conflicts with main as it now is",
    );

    await pipelines.app.get(GateService).continue(taskId, ANN);
    await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);

    expect((await runsOf(pipelines, taskId)).at(-1)).toMatchObject({
      stageKey: "publish",
      outcome: {
        status: "done",
        summary: `Merged ${initiativeBranch} and main, which had moved on, into office/task, then landed office/task on ${initiativeBranch} on origin as one commit, ffffffff "Rename a device".`,
      },
    });
    expect(pipelines.publishing.published.map(({ target }) => target)).toEqual([
      "publishing-mode",
      "publishing-mode",
    ]);
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

    const taskId = await walkStages(pipelines, [implement, reviewedPublish]);

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

  it("publishes nothing from a worktree that isn't where The Office left it", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.git.move(taskId, { commit: PLANNED_COMMIT, branch: "main" });

    await walkStages(pipelines, [publish], taskId);

    expect((await runsOf(pipelines, taskId))[0]?.outcome).toEqual({
      status: "failed",
      error:
        "The Task's worktree isn't where The Office left it: the worktree is on the branch main, not the Task's branch office/task. The Stage didn't start.",
      branchMoved: true,
    });
    expect(pipelines.publishing.published).toEqual([]);
  });
});
