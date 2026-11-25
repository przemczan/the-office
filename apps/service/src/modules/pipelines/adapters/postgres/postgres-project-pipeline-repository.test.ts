import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { straightLineFlow } from "../../domain/flow.js";
import type { Pipeline } from "../../domain/pipeline.js";
import type { ProjectPipeline } from "../../domain/project-pipeline.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import { PostgresPipelineRepository } from "./postgres-pipeline-repository.js";
import { PostgresProjectPipelineRepository } from "./postgres-project-pipeline-repository.js";

// The test database is shared by every test file: these Pipelines and Projects are this file's own.

/** Postgres' error code. */
const UNIQUE_VIOLATION = "23505";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

async function anOfficeWidePipeline(): Promise<Pipeline> {
  const pipeline: Pipeline = {
    id: randomUUID(),
    name: `Full ${randomUUID()}`,
    description: "To copy.",
    stages: straightLineFlow([agentStage(), scriptStage()]),
  };
  await new PostgresPipelineRepository(database).add(pipeline);
  return pipeline;
}

function aProjectPipeline(
  source: Pipeline,
  fields: Partial<ProjectPipeline> = {},
): ProjectPipeline {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    name: "With Linux check",
    description: "Then Linux.",
    stages: source.stages,
    copiedFrom: { name: source.name, at: new Date("2026-11-12T09:30:00.000Z") },
    brokenBeforeUpdate: null,
    ...fields,
  };
}

describe("PostgresProjectPipelineRepository", () => {
  it("keeps a Project Pipeline as added and saved, in the order added, until it is removed", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const first = aProjectPipeline(source);
    const second = aProjectPipeline(source, { projectId: first.projectId, name: "Second" });
    const elsewhere = aProjectPipeline(source);

    await repository.add(first);
    await repository.add(second);
    await repository.add(elsewhere);
    const saved = {
      ...first,
      name: "Renamed",
      stages: straightLineFlow([agentStage()]),
      projectId: randomUUID(),
    };
    await repository.save(saved);

    // A save keeps its Project.
    const kept = { ...saved, projectId: first.projectId };
    expect(await repository.find(first.id)).toEqual(kept);
    expect(await repository.listOf(first.projectId)).toEqual([kept, second]);
    expect(await repository.list()).toEqual(expect.arrayContaining([kept, second, elsewhere]));

    await repository.remove(second.id);
    expect(await repository.find(second.id)).toBeUndefined();
  });

  it("refuses a second name of the same Project in any case", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const first = aProjectPipeline(source);
    await repository.add(first);

    await expect(
      repository.add(
        aProjectPipeline(source, { projectId: first.projectId, name: "with LINUX check" }),
      ),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
  });

  it("lets the office-wide Pipeline a Project Pipeline was copied from be removed", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const copy = aProjectPipeline(source);
    await repository.add(copy);

    await new PostgresPipelineRepository(database).remove(source.id);
    expect(await repository.find(copy.id)).toEqual(copy);
  });

  it("writes its Broken flag as given by each save", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    // As The Office moved a Broken one: copied from its base Pipeline, at no time.
    const moved = aProjectPipeline(source, {
      copiedFrom: { name: source.name, at: null },
      brokenBeforeUpdate: ["Broken."],
    });
    await repository.add(moved);
    expect(await repository.find(moved.id)).toEqual(moved);

    // Ending it is the user's save (`savedProjectPipeline`); a template's edit applied keeps it.
    const kept = {
      ...moved,
      stages: straightLineFlow([agentStage()]),
      brokenBeforeUpdate: ["Still broken."],
    };
    await repository.save(kept);
    expect(await repository.find(moved.id)).toEqual(kept);
    await repository.save({ ...kept, brokenBeforeUpdate: null });
    expect(await repository.find(moved.id)).toEqual({ ...kept, brokenBeforeUpdate: null });
  });
});
