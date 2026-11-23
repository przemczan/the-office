import { goingBackOnFailure } from "../domain/stage.fixtures.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { StageOutcome } from "../domain/stage-run.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord, PLANNED_COMMIT, recordedRun } from "../ports/pipelines-ports.fixtures.js";
import { aScriptStage, tests, passing, failing } from "./script-stage-runner.fixtures.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function outcomesOf(taskId: string): Promise<(StageOutcome | undefined)[]> {
  return (await runsOf(pipelines, taskId)).map(({ outcome }) => outcome);
}

describe("ScriptStageRunner", () => {
  it("installs, then runs the Stage's command in the Task's worktree with no session, and records its run", async () => {
    pipelines = await startPipelinesApplication();
    const calls: string[] = [];
    pipelines.commands.observe = (call) => void calls.push(call);
    pipelines.commands.commandRuns.push([passing]);

    const taskId = await walkStages(pipelines, [tests]);

    expect(calls).toEqual(["install", "runCommand"]);
    const [run] = await runsOf(pipelines, taskId);
    expect(pipelines.commands.ran).toEqual([{ taskId, key: "test", stageRunId: run?.id }]);
    expect(pipelines.stageThreads.requests).toEqual([]);
    expect(run?.outcome).toEqual({ status: "done", summary: "`npm test` passed." });
    expect(run?.commandRuns).toEqual([recordedRun(passing, "command")]);
    // A Script Stage reports no Definition of Done met, so the user is asked at the end.
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("fails when the test command's re-run command fails too, handing what it printed to the Agent that fixes it", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const failingRerun = { ...failing, commandLine: "npm test -- --last-failed" };
    pipelines.commands.commandRuns.push([failing, failingRerun], [passing]);

    const taskId = await walkStages(pipelines, [
      anAgentStage("implement"),
      goingBackOnFailure(aScriptStage("test"), "implement", 1),
    ]);

    const error =
      "`npm test` failed, and its re-run command `npm test -- --last-failed` failed with exit code 1 too.\n\nWhat it printed:\n\n```\nFAIL renames a device: expected 'Hall' to be 'Kitchen'\n```";
    expect((await outcomesOf(taskId))[1]).toEqual({ status: "failed", error });
    expect(pipelines.stageThreads.requests[1]?.work).toContain(error);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("commits what a build or lint changed, with the Task in the subject and the result below", async () => {
    pipelines = await startPipelinesApplication();
    const build = aScriptStage("build", { name: "Build" });

    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["dist/app.js"]);

    await walkStages(pipelines, [build], taskId);

    expect(pipelines.git.commits).toEqual([
      {
        taskId,
        message: "Build: Rename a device\n\n`npm run build` passed.",
        commit: expect.any(String),
        paths: ["dist/app.js"],
      },
    ]);
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.headCommit).toBe(pipelines.git.commits[0]?.commit);
    expect(run?.changedFiles).toEqual(["dist/app.js"]);
  });

  it("records no changed files when a build changed nothing", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.git.unchanged.add(taskId);

    await walkStages(pipelines, [aScriptStage("build", { name: "Build" })], taskId);

    expect(pipelines.git.commits).toEqual([]);
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.headCommit).toBe(PLANNED_COMMIT);
    expect(run?.changedFiles).toEqual([]);
  });

  it("fails, committing nothing, when its command moved HEAD", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.commands.observe = (call) => {
      if (call !== "runCommand") return;
      pipelines.git.move(taskId, { commit: "e".repeat(40), branch: aTaskRecord().worktree.branch });
    };

    await walkStages(pipelines, [aScriptStage("build", { name: "Build" })], taskId);

    expect((await outcomesOf(taskId))[0]).toEqual({
      status: "failed",
      error: `The Stage's command changed git itself: HEAD moved from ${PLANNED_COMMIT.slice(0, 8)} to eeeeeeee. The Office stopped here without committing.`,
    });
    expect(pipelines.git.commits).toEqual([]);
    expect((await runsOf(pipelines, taskId))[0]?.headCommit).toBe(PLANNED_COMMIT);
  });
});
