import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { ScriptStage, ScriptStageCommand, Stage } from "../domain/stage.js";
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
import { aCommandRun, aTaskRecord, PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

function aScriptStage(command: ScriptStageCommand, fields: Partial<ScriptStage> = {}): Stage {
  return { kind: "script", key: command, name: "Tests", optional: false, command, ...fields };
}

const tests = aScriptStage("test");
const passing = aCommandRun("npm test", "passed", "All 12 tests passed.");
const failing = aCommandRun(
  "npm test",
  "failed",
  "FAIL renames a device: expected 'Hall' to be 'Kitchen'",
);

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
    expect(run?.commandRuns).toEqual([{ ...passing, purpose: "command" }]);
    // A Script Stage reports no Definition of Done met, so the user is asked at the end.
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "waiting-on-you" }]);
  });

  it("is done when a flaky test command passes on its re-run, with the flake recorded", async () => {
    pipelines = await startPipelinesApplication();
    pipelines.commands.commandRuns.push([failing, passing]);

    const taskId = await walkStages(pipelines, [tests]);

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toEqual({
      status: "done",
      summary: "`npm test` failed, then passed when The Office ran it once more: a flake.",
    });
    expect(run?.commandRuns.map(({ purpose, outcome }) => [purpose, outcome])).toEqual([
      ["command", "failed"],
      ["re-run", "passed"],
    ]);
  });

  it("records the files each test run wrote, moved out of the worktree, for the user to see", async () => {
    pipelines = await startPipelinesApplication();
    const movedFiles = { folder: "/office/test-output/run/1", paths: ["screenshots/dialog.png"] };
    pipelines.commands.commandRuns.push([{ ...passing, movedFiles }]);

    const taskId = await walkStages(pipelines, [tests]);

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.commandRuns).toEqual([{ ...passing, purpose: "command", movedFiles }]);
  });

  it("fails when the test command fails on its re-run too, handing what it printed to the Agent that fixes it", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    pipelines.commands.commandRuns.push([failing, failing], [passing]);

    const taskId = await walkStages(pipelines, [
      anAgentStage("implement"),
      aScriptStage("test", { onFailure: { goBackTo: "implement", rounds: 1 } }),
    ]);

    const error =
      "`npm test` failed with exit code 1 on its re-run too.\n\nWhat it printed:\n\n```\nFAIL renames a device: expected 'Hall' to be 'Kitchen'\n```";
    expect((await outcomesOf(taskId))[1]).toEqual({ status: "failed", error });
    expect(pipelines.stageThreads.requests[1]?.work).toContain(error);
    expect(pipelines.tasks.changes).toEqual([{ taskId, state: "done" }]);
  });

  it("fails without running the command when the install fails, with what the install printed", async () => {
    pipelines = await startPipelinesApplication();
    const install = aCommandRun("npm ci", "could-not-run", "'npm' is not recognized");
    pipelines.commands.installations.push({ kind: "ran", run: install });

    const taskId = await walkStages(pipelines, [tests]);

    expect(pipelines.commands.ran).toEqual([]);
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toEqual({
      status: "failed",
      error:
        "Installing the Project's dependencies failed: `npm ci` couldn't be run: the shell couldn't start it, as when its program isn't installed.\n\nWhat it printed:\n\n```\n'npm' is not recognized\n```\n\nThe Stage's command didn't run.",
    });
    expect(run?.commandRuns).toEqual([{ ...install, purpose: "install" }]);
  });

  it("commits nothing after a test run, which leaves the worktree restored, and expects HEAD where it was", async () => {
    pipelines = await startPipelinesApplication();

    const taskId = await walkStages(pipelines, [tests, aScriptStage("lint", { name: "Lint" })]);

    expect(pipelines.git.commits).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/^Lint: Rename a device\n/) }),
    ]);
    const runs = await runsOf(pipelines, taskId);
    expect(runs[0]?.headCommit).toBe(PLANNED_COMMIT);
  });

  it("commits what a build or lint changed, with the Task in the subject and the result below", async () => {
    pipelines = await startPipelinesApplication();
    const build = aScriptStage("build", { name: "Build" });

    const taskId = await walkStages(pipelines, [build]);

    expect(pipelines.git.commits).toEqual([
      {
        taskId,
        message: "Build: Rename a device\n\n`npm run build` passed.",
        commit: expect.any(String),
      },
    ]);
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.headCommit).toBe(pipelines.git.commits[0]?.commit);
  });

  it("doesn't run its command when HEAD isn't where The Office left it", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    let committed = false;
    // Someone moves HEAD between the build's commit and the tests' check of it.
    pipelines.git.observe = (call) => {
      if (call === "commit") committed = true;
      else if (call === "head" && committed) {
        pipelines.git.move(taskId, {
          commit: "f".repeat(40),
          branch: aTaskRecord().worktree.branch,
        });
      }
    };

    await walkStages(pipelines, [aScriptStage("build", { name: "Build" }), tests], taskId);

    expect(pipelines.commands.ran).toEqual([expect.objectContaining({ taskId, key: "build" })]);
    expect((await outcomesOf(taskId))[1]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("The Task's worktree isn't where The Office left it"),
    });
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
