import { randomUUID } from "node:crypto";
import {
  stageRunCommandOutputsSchema,
  stagesEditRefusalSchema,
  taskStagesSchema,
  type StageRunCommandOutputs,
  type TaskStages,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { Stage } from "../../domain/stage.js";
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
import { tests } from "./task-stages.controller.fixtures.js";

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

async function send(method: string, path: string, stages: readonly Stage[]): Promise<Response> {
  if (!pipelines) throw new Error("The application isn't started.");
  return fetch(`${await pipelines.app.getUrl()}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stages }),
  });
}

describe("GET /api/tasks/:id/stages", () => {
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
        waitingSince: null,
        threadId: run?.threadId,
        session: "fresh",
        tokens: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
        context: null,
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
});

describe("PUT /api/tasks/:id/stages", () => {
  it("saves the Stages for the Task and answers them, edited for the Task", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });
    const stages = [
      anAgentStage("implement", { effort: "low", permissions: { commands: ["test"] } }),
      tests,
    ];

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
