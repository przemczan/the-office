import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { straightLineFlow } from "../../domain/flow.js";
import type { Stage } from "../../domain/stage.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
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

/** A flow whose places put the Stages in another order than the array's. */
const OUT_OF_ORDER: readonly Stage[] = [
  { ...tests, routes: [{ to: null, condition: null }], place: { column: 1, row: 0 } },
  { ...implement, routes: [{ to: "tests", condition: null }], place: { column: 0, row: 0 } },
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

    expect(pipeline?.stages).toEqual(straightLineFlow(A_LIST));
    expect(ownStages?.stages).toEqual(straightLineFlow(A_LIST));
  });

  it("are written in the Pipeline's order, every field kept", async () => {
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
    const inOrder = [OUT_OF_ORDER[1], OUT_OF_ORDER[0]];
    expect(pipelineRow?.stages).toEqual(inOrder);
    expect(taskRow?.stages).toEqual(inOrder);
  });
});
