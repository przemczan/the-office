import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Stage } from "../../domain/stage.js";
import { agentStage, scriptStage, straightLine } from "../../domain/stage.fixtures.js";
import { pipelines } from "./pipelines.schema.js";
import { PostgresPipelineRepository } from "./postgres-pipeline-repository.js";
import { PostgresTaskStagesRepository } from "./postgres-task-stages-repository.js";
import { taskStages } from "./task-stages.schema.js";

// The test database is shared by every test file: these Pipelines and Tasks are this file's own.

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

const implement = agentStage();
const review = agentStage({ key: "review", name: "Review", optional: true });
const tests = scriptStage();

/** Stages as a rolled-back release writes them: a list, without routes. */
const A_LIST: readonly Stage[] = [implement, review, tests];

/** A flow from before positions, whose places put the Stages in another order than the array's. */
const OUT_OF_ORDER: readonly Stage[] = [
  { ...tests, routes: [{ to: null, condition: null, limit: null }], place: { column: 1, row: 0 } },
  {
    ...implement,
    routes: [{ to: "tests", condition: null, limit: null }],
    place: { column: 0, row: 0 },
  },
];

describe("The Stages of a Pipeline and of a Task, kept in Postgres", () => {
  it("read as a straight line when a row holds them as a list", async () => {
    const pipelineId = randomUUID();
    const taskId = randomUUID();
    await database
      .insert(pipelines)
      .values({ id: pipelineId, name: `Listed ${pipelineId}`, description: "", stages: A_LIST });
    await database
      .insert(taskStages)
      .values({ taskId, pipelineId, stages: A_LIST, madeAt: new Date() });

    const pipeline = await new PostgresPipelineRepository(database).find(pipelineId);
    const ownStages = await new PostgresTaskStagesRepository(database).find(taskId);

    expect(pipeline?.stages).toEqual(straightLine(A_LIST));
    expect(ownStages?.stages).toEqual(straightLine(A_LIST));
  });

  it("are written in the order their places gave, at the positions of those places, every field and place kept", async () => {
    const pipelineId = randomUUID();
    const taskId = randomUUID();
    await new PostgresPipelineRepository(database).add({
      id: pipelineId,
      name: `Out of order ${pipelineId}`,
      description: "",
      stages: OUT_OF_ORDER,
    });
    await new PostgresTaskStagesRepository(database).save({
      taskId,
      pipelineId,
      stages: OUT_OF_ORDER,
      madeAt: new Date(),
      editedForTask: false,
      trace: undefined,
    });

    const [pipelineRow] = await database
      .select({ stages: pipelines.stages })
      .from(pipelines)
      .where(eq(pipelines.id, pipelineId));
    const [taskRow] = await database
      .select({ stages: taskStages.stages })
      .from(taskStages)
      .where(eq(taskStages.taskId, taskId));
    const inOrder = [
      { ...OUT_OF_ORDER[1], position: { x: 0, y: 0 } },
      { ...OUT_OF_ORDER[0], position: { x: 308, y: 0 } },
    ];
    expect(pipelineRow?.stages).toEqual(inOrder);
    expect(taskRow?.stages).toEqual(inOrder);
  });

  it("are written in their list's order wherever they stand, each with its index's place for the previous release", async () => {
    const pipelineId = randomUUID();
    const taskId = randomUUID();
    const rightToLeft: readonly Stage[] = [
      {
        ...implement,
        routes: [{ to: "tests", condition: null, limit: null }],
        position: { x: 600, y: 40 },
      },
      {
        ...tests,
        routes: [{ to: null, condition: null, limit: null }],
        position: { x: -200, y: 0 },
      },
    ];
    const endPosition = { x: 900, y: 12 };
    const pipelineRepository = new PostgresPipelineRepository(database);
    const taskStagesRepository = new PostgresTaskStagesRepository(database);
    await pipelineRepository.add({
      id: pipelineId,
      name: `Right to left ${pipelineId}`,
      description: "",
      stages: rightToLeft,
      endPosition,
    });
    await taskStagesRepository.save({
      taskId,
      pipelineId,
      stages: rightToLeft,
      endPosition,
      madeAt: new Date(),
      editedForTask: false,
      trace: undefined,
    });

    const [pipelineRow] = await database
      .select({ stages: pipelines.stages, endPosition: pipelines.endPosition })
      .from(pipelines)
      .where(eq(pipelines.id, pipelineId));
    const [taskRow] = await database
      .select({ stages: taskStages.stages, endPosition: taskStages.endPosition })
      .from(taskStages)
      .where(eq(taskStages.taskId, taskId));
    const kept = {
      stages: [
        { ...rightToLeft[0], place: { column: 0, row: 0 } },
        { ...rightToLeft[1], place: { column: 1, row: 0 } },
      ],
      endPosition,
    };
    expect(pipelineRow).toEqual(kept);
    expect(taskRow).toEqual(kept);
    expect((await pipelineRepository.find(pipelineId))?.stages).toEqual(rightToLeft);
    expect(await taskStagesRepository.find(taskId)).toMatchObject({
      stages: rightToLeft,
      endPosition,
    });
  });
});
