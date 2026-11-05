import { randomUUID } from "node:crypto";
import {
  stageRunCommandOutputsSchema,
  stagesCheckSchema,
  stagesEditRefusalSchema,
  taskStagesSchema,
  type StageRunCommandOutputs,
  type TaskStages,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { Stage } from "../../domain/stage.js";
import type { StageOutcome } from "../../domain/stage-run.js";
import { aStageRun } from "../../domain/stage-run.fixtures.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { aCommandRun, recordedRun } from "../../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../../ports/stage-run-repository.js";

const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 2 },
};

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

async function edit(taskId: string, stages: readonly Stage[]): Promise<Response> {
  return send("PUT", `/api/tasks/${taskId}/stages`, stages);
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

  it("gives each of the Task's own Stages with where it stands, its tokens and its runs", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Added the field.", "The form is done; check the list.")),
    ]);
    const taskId = await walkStages(pipelines, [anAgentStage("implement"), tests]);
    const [run] = await runsOf(pipelines, taskId);

    const { stages, lockedStages, testResults } = await stagesOf(taskId);

    expect(stages?.map(({ stage, state, tokens }) => [stage.key, state, tokens])).toEqual([
      ["implement", "done", { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 }],
      ["tests", "done", { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }],
    ]);
    expect(lockedStages).toBe(2);
    expect(stages?.[0]?.runs).toEqual([
      {
        id: run?.id,
        number: 1,
        startedAt: run?.startedAt.toISOString(),
        endedAt: run?.endedAt?.toISOString(),
        threadId: run?.threadId,
        session: "fresh",
        tokens: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
        carriedFailure: null,
        sentBack: null,
        commandRuns: [],
        gateAction: null,
        outcome: {
          status: "done",
          summary: "Added the field.",
          skipped: false,
          definitionOfDoneMet: [1, 2],
          pullRequestUrl: null,
          handoverNote: "The form is done; check the list.",
        },
      },
    ]);
    expect(stages?.[1]?.runs[0]?.commandRuns).toMatchObject([
      { purpose: "command", outcome: "passed" },
    ]);
    expect(testResults).toEqual([
      { stageKey: tests.key, name: tests.name, state: "passed", detail: "`npm run test` passed." },
    ]);
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

  it("gives a run kept before whole outputs its filtered output, and refuses another Task's run", async () => {
    pipelines = await startPipelinesApplication();
    const id = randomUUID();
    const taskId = randomUUID();
    const commandRuns = [recordedRun(aCommandRun("npm test", "failed", "FAIL one"), "command")];
    await pipelines.app.get(StageRunRepository).saveNew(aStageRun({ id, taskId, commandRuns }));

    expect(await commandOutputsOf(taskId, id)).toEqual({ outputs: ["FAIL one"] });

    const url = `${await pipelines.app.getUrl()}/api/tasks/${randomUUID()}/stage-runs/${id}/command-outputs`;
    expect((await fetch(url)).status).toBe(404);
  });

  it("gives what each run reported and what stands by the walk's rule: a later report lowers it", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Wrote it.", "Check it.", [1, 2])),
      anAgentSession(aDoneResult("Looked at it.", "One still fails.", [2])),
    ]);
    const taskId = await walkStages(pipelines, [
      anAgentStage("write"),
      anAgentStage("look"),
      tests,
    ]);

    const { stages, definitionOfDoneMet } = await stagesOf(taskId);

    expect(stages?.map(({ runs }) => runs[0]?.outcome)).toMatchObject([
      { definitionOfDoneMet: [1, 2] },
      { definitionOfDoneMet: [2] },
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

describe("PUT /api/tasks/:id/stages", () => {
  it("saves the Stages for the Task and answers them, edited for the Task", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });
    const stages = [anAgentStage("implement", { effort: "low" }), tests];

    const response = await edit(taskId, stages);

    expect(response.status).toBe(200);
    const saved = taskStagesSchema.parse(await response.json());
    expect(saved.editedForTask).toBe(true);
    expect(saved.stages?.map(({ stage }) => stage)).toEqual(stages);
    expect(await stagesOf(taskId)).toEqual(saved);
  });

  it("refuses Stages that can't run with every problem, on its Stage", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });

    const response = await edit(taskId, [
      { ...tests, onFailure: { goBackTo: "implement", rounds: 1 } },
      anAgentStage("implement", { session: "continue" }),
    ]);

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual([
      {
        stageIndex: 0,
        text: "Stage 1 · Tests: on failure it can only go back to an earlier Stage.",
      },
      {
        stageIndex: 1,
        text: "Stage 2 · implement: continuing a session needs the same Role in the Stage before.",
      },
    ]);
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
});
