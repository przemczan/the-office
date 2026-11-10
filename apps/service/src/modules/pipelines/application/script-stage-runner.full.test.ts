import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StageOutcome } from "../domain/stage-run.js";
import { StageRunWaiting } from "../domain/stage-run-events.js";
import {
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import {
  aCommandRun,
  aTaskRecord,
  PLANNED_COMMIT,
  recordedRun,
} from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { aScriptStage, tests, passing, failing } from "./script-stage-runner.fixtures.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

async function outcomesOf(taskId: string): Promise<(StageOutcome | undefined)[]> {
  return (await runsOf(pipelines, taskId)).map(({ outcome }) => outcome);
}

describe("ScriptStageRunner", () => {
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
    expect(run?.commandRuns).toEqual([recordedRun(passing, "command", { movedFiles })]);
  });

  it("keeps each command's whole output, apart from the run, in the order they ran", async () => {
    pipelines = await startPipelinesApplication();
    const install = { ...aCommandRun("npm ci", "passed"), wholeOutput: "added 12 packages" };
    pipelines.commands.installations.push({ kind: "ran", run: install });
    pipelines.commands.commandRuns.push([
      { ...failing, wholeOutput: "… 6 KB cut from the start\nfirst" },
      { ...failing, wholeOutput: "second" },
    ]);

    const taskId = await walkStages(pipelines, [tests]);

    const [run] = await runsOf(pipelines, taskId);
    const outputs = await pipelines.app
      .get(StageRunRepository)
      .commandOutputs(taskId, run?.id ?? "");
    expect(outputs).toEqual(["added 12 packages", "… 6 KB cut from the start\nfirst", "second"]);
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
        "Installing the Project's dependencies failed: `npm ci` couldn't be run, as when its program isn't installed or its run environment can't start.\n\nWhat it printed:\n\n```\n'npm' is not recognized\n```\n\nThe Stage's command didn't run.",
    });
    expect(run?.commandRuns).toEqual([recordedRun(install, "install")]);
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

  it("saves its wait for a free run environment on the run, told to the web, until its command starts", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    let letIn: (() => void) | undefined;
    pipelines.commands.waitsUntil = new Promise<void>((resolve) => {
      letIn = resolve;
    });

    const walked = walkStages(pipelines, [tests], taskId);
    await vi.waitFor(async () =>
      expect((await runsOf(pipelines, taskId))[0]?.waitingSince).toBeInstanceOf(Date),
    );
    expect(pipelines.commands.ran).toEqual([]);
    letIn?.();
    await walked;

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.waitingSince).toBeUndefined();
    expect(run?.outcome).toMatchObject({ status: "done" });
    expect(
      pipelines.published
        .filter((event) => event instanceof StageRunWaiting)
        .map(({ runId, stageKey, waiting }) => ({ runId, stageKey, waiting })),
    ).toEqual([
      { runId: run?.id, stageKey: "test", waiting: true },
      { runId: run?.id, stageKey: "test", waiting: false },
    ]);
  });
});
