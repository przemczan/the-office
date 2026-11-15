import { randomUUID } from "node:crypto";
import {
  stageRunCommandOutputsSchema,
  stagesCheckSchema,
  taskStagesSchema,
  type StageRunCommandOutputs,
  type TaskStages,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { Stage } from "../../domain/stage.js";
import type { StageOutcome } from "../../domain/stage-run.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { aCommandRun } from "../../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../../ports/stage-run-repository.js";
import { tests } from "./task-stages.controller.fixtures.js";

const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
  onFailure: undefined,
};

let pipelines: PipelinesApplication | undefined;

afterEach(async () => {
  await pipelines?.app.close();
});

async function stagesOf(taskId: string): Promise<TaskStages> {
  if (!pipelines) throw new Error("The application isn't started.");
  const response = await fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/stages`);
  expect(response.status).toBe(200);
  return taskStagesSchema.parse(await response.json());
}

async function commandOutputsOf(taskId: string, runId: string): Promise<StageRunCommandOutputs> {
  if (!pipelines) throw new Error("The application isn't started.");
  const response = await fetch(
    `${await pipelines.app.getUrl()}/api/tasks/${taskId}/stage-runs/${runId}/command-outputs`,
  );
  expect(response.status).toBe(200);
  return stageRunCommandOutputsSchema.parse(await response.json());
}

async function check(taskId: string, stages: readonly Stage[]): Promise<Response> {
  return send("POST", `/api/tasks/${taskId}/stages/check`, stages);
}

async function send(method: string, path: string, stages: readonly Stage[]): Promise<Response> {
  if (!pipelines) throw new Error("The application isn't started.");
  return fetch(`${await pipelines.app.getUrl()}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stages }),
  });
}

describe("GET /api/tasks/:id/stages", () => {
  it("is null for a Task without Stages of its own: one not started yet", async () => {
    pipelines = await startPipelinesApplication();

    expect(await stagesOf(randomUUID())).toEqual({
      stages: null,
      editedForTask: false,
      lockedStages: 0,
      testResults: [],
      definitionOfDoneMet: [],
    });
  });

  it("gives a run's commands' whole outputs apart from the Stages", async () => {
    pipelines = await startPipelinesApplication();
    pipelines.commands.commandRuns.push([
      { ...aCommandRun("npm test", "passed", "filtered"), wholeOutput: "every line it printed" },
    ]);
    const taskId = await walkStages(pipelines, [tests]);
    const [run] = await runsOf(pipelines, taskId);

    expect(await commandOutputsOf(taskId, run?.id ?? "")).toEqual({
      outputs: ["every line it printed"],
    });
    expect(JSON.stringify(await stagesOf(taskId))).not.toContain("every line it printed");
  });

  it("gives what each run reported and what stands by the walk's rule: met once reported, until taken back", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Wrote it.", "Check it.", [1])),
      anAgentSession(aDoneResult("Looked at it.", "The second holds too.", [2])),
      anAgentSession({
        ...aDoneResult("Fixed it.", "The first broke again.", []),
        definitionOfDoneNoLongerMet: [1],
      }),
    ]);
    const taskId = await walkStages(pipelines, [
      anAgentStage("write"),
      anAgentStage("look"),
      anAgentStage("fix"),
      tests,
    ]);

    const { stages, definitionOfDoneMet } = await stagesOf(taskId);

    expect(stages?.map(({ runs }) => runs[0]?.outcome)).toMatchObject([
      { definitionOfDoneMet: [1] },
      { definitionOfDoneMet: [2] },
      { definitionOfDoneMet: [] },
      { definitionOfDoneMet: null },
    ]);
    expect(definitionOfDoneMet).toEqual([2]);
  });

  it("gives the pull request Publish opened on its outcome, from what Publish did", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = await walkStages(pipelines, [publish]);

    const { stages } = await stagesOf(taskId);

    expect(stages?.[0]?.runs[0]?.outcome).toMatchObject({
      status: "done",
      pullRequestUrl: "https://github.com/notnullsoft/admin/pull/7",
    });
  });

  it("reads a Publish run stored before the pull request was kept, as having none", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = await walkStages(pipelines, [publish]);
    const [run] = await runsOf(pipelines, taskId);
    if (!run) throw new Error("Publish didn't run.");
    const older: StageOutcome = {
      status: "done",
      summary: "Pushed it and opened the pull request.",
    };
    await pipelines.app
      .get(StageRunRepository, { strict: false })
      .saveEnded({ ...run, outcome: older });

    const { stages } = await stagesOf(taskId);

    expect(stages?.[0]?.runs[0]?.outcome).toMatchObject({ status: "done", pullRequestUrl: null });
  });
});

describe("POST /api/tasks/:id/stages/check", () => {
  it("answers what saving would be refused for, and saves nothing", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });

    const response = await check(taskId, [
      { ...tests, onFailure: { goBackTo: "tests", rounds: 1 } },
    ]);

    expect(response.status).toBe(200);
    expect(stagesCheckSchema.parse(await response.json()).problems).toEqual([
      {
        stageIndex: 0,
        text: "Stage 1 · Tests: on failure it can only go back to an earlier Stage.",
      },
    ]);
    expect((await stagesOf(taskId)).stages).toBeNull();
  });

  it("answers no problems for Stages that can be saved", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });

    const response = await check(taskId, [anAgentStage("implement"), tests]);

    expect(stagesCheckSchema.parse(await response.json())).toEqual({ problems: [] });
  });

  it("checks a Task with no Pipeline against the one the draft follows, and refuses it without one", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "backlog", pipelineId: undefined });
    const stages = [anAgentStage("implement"), tests];

    const withChosen = await fetch(
      `${await pipelines.app.getUrl()}/api/tasks/${taskId}/stages/check`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stages, pipelineId: "quick-fix" }),
      },
    );
    const withoutChosen = await check(taskId, stages);

    expect(stagesCheckSchema.parse(await withChosen.json())).toEqual({ problems: [] });
    expect(withoutChosen.status).toBe(422);
    expect(await withoutChosen.json()).toMatchObject({
      problems: [{ text: "The Task has no Pipeline yet: choose one first." }],
    });
    expect((await stagesOf(taskId)).stages).toBeNull();
  });
});
