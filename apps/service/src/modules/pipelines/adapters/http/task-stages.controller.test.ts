import { randomUUID } from "node:crypto";
import {
  stageRunCommandOutputsSchema,
  stagesEditRefusalSchema,
  taskStagesSchema,
  type StageRunCommandOutputs,
  type TaskStages,
} from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { straightLineFlow } from "../../domain/flow.js";
import { ENDED_FAILED, plainRoute } from "../../domain/route.js";
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
import { TaskStagesRepository } from "../../ports/task-stages-repository.js";
import { TaskStagesService } from "../../application/task-stages-service.js";
import { gate } from "../../domain/stage.fixtures.js";
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
        engine: {
          engineId: "claude-code",
          engineName: "Claude Code",
          model: "scripted",
          standInFor: null,
        },
        engineSwitches: [],
        tokens: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
        context: null,
        carriedFailure: null,
        route: { to: "tests", times: 1, limit: null },
        choice: null,
        sentBack: null,
        restart: null,
        restarted: null,
        startedOver: null,
        earlierStart: false,
        commandRuns: [],
        gateAction: null,
        outcome: {
          status: "done",
          summary: "Added the field.",
          skipped: false,
          definitionOfDoneMet: [1, 2],
          pullRequestUrl: null,
          publishResult: null,
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

  it("gives a run's engine with the engine it stood in for, and none for a run that kept no engine", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    const repository = pipelines.app.get(StageRunRepository);
    const standingIn = aStageRun({ id: randomUUID(), taskId, number: 1 });
    await repository.saveNew(standingIn);
    await repository.saveThread(standingIn.id, {
      threadId: randomUUID(),
      session: "fresh",
      engineId: "personal",
      engineName: "Personal",
      model: "claude-opus-5-5",
      standInFor: {
        engineId: "work",
        engineName: "Work",
        reason: "Work's window is near its cap.",
      },
    });
    await repository.saveNew(aStageRun({ id: randomUUID(), taskId, number: 2 }));
    await pipelines.app.get(TaskStagesRepository, { strict: false }).save({
      taskId,
      pipelineId: "for-tests",
      stages: [anAgentStage(standingIn.stageKey)],
      madeAt: new Date(),
      editedForTask: false,
      trace: undefined,
    });
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });

    const { stages } = await stagesOf(taskId);

    expect(stages?.[0]?.runs.map(({ engine }) => engine)).toEqual([
      {
        engineId: "personal",
        engineName: "Personal",
        model: "claude-opus-5-5",
        standInFor: {
          engineId: "work",
          engineName: "Work",
          reason: "Work's window is near its cap.",
        },
      },
      null,
    ]);
  });

  it("gives the route a run's Agent chose by its target's name, End for none", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    const repository = pipelines.app.get(StageRunRepository);
    const toReview = aStageRun({ id: randomUUID(), taskId, number: 1 });
    const toEnd = aStageRun({ id: randomUUID(), taskId, number: 2 });
    await repository.saveNew(toReview);
    await repository.saveRouteChoice(toReview.id, { to: "review", reason: "It touches the UI." });
    await repository.saveNew(toEnd);
    await repository.saveRouteChoice(toEnd.id, { to: null, reason: "Nothing to do." });
    await repository.saveNew(aStageRun({ id: randomUUID(), taskId, number: 3 }));
    await pipelines.app.get(TaskStagesRepository, { strict: false }).save({
      taskId,
      pipelineId: "for-tests",
      stages: [anAgentStage("implement"), anAgentStage("review", { name: "Review" })],
      madeAt: new Date(),
      editedForTask: false,
      trace: undefined,
    });
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });

    const { stages } = await stagesOf(taskId);

    expect(stages?.[0]?.runs.map(({ choice }) => choice)).toEqual([
      { to: "review", toName: "Review", reason: "It touches the UI." },
      { to: null, toName: "End", reason: "Nothing to do." },
      null,
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
    expect(saved.stages?.map(({ stage }) => stage)).toEqual(straightLineFlow(stages));
    expect(await stagesOf(taskId)).toEqual(saved);
  });

  it("refuses Stages that can't run with every problem, on its Stage", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });

    const response = await edit(taskId, [
      {
        ...tests,
        routes: [
          { to: "tests", condition: ENDED_FAILED, limit: null },
          { to: "implement", condition: null, limit: null },
        ],
      },
      anAgentStage("implement", { session: "continue", routes: [plainRoute(null)] }),
    ]);

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual([
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: "Stage 1 · Tests: the loop Tests → Tests has no route with a limit, so it could run for ever.",
      },
      {
        stageKey: "implement",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 2 · implement: continuing a session needs the same Role or the same duty in the Stage before.",
      },
    ]);
  });

  it("refuses a Stage inserted straight after a started one, on the started Stage's route, as its check does", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "quick-fix" });
    const own = await pipelines.app.get(TaskStagesService).make(taskId, "quick-fix");
    await pipelines.app
      .get(StageRunRepository)
      .saveNew(aStageRun({ id: randomUUID(), taskId, stageKey: "implement" }));
    const [implement, ...rest] = own.stages;
    if (!implement) throw new Error("Quick fix has Stages.");
    const inserted = straightLineFlow([implement, gate({ key: "look", name: "Look" }), ...rest]);
    const refused = [
      {
        stageKey: "implement",
        at: { kind: "route", routeIndex: 0 },
        level: "problem",
        text: "Stage 1 · Implement: it has started, so its routes out stay as they are. To change where the walk goes, change the routes of a Stage that hasn't started.",
      },
    ];

    const response = await edit(taskId, inserted);
    const check = await send("POST", `/api/tasks/${taskId}/stages/check`, inserted);

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual(refused);
    expect((await check.json()) as unknown).toMatchObject({ problems: refused });
  });
});
