import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { straightLineFlow } from "../../domain/flow.js";
import type { Pipeline } from "../../domain/pipeline.js";
import {
  movedProjectPipeline,
  type LegacyProjectPipeline,
  type ProjectPipeline,
} from "../../domain/project-pipeline.js";
import type { StageChange } from "../../domain/stage-change.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import { PostgresPipelineRepository } from "./postgres-pipeline-repository.js";
import { PostgresProjectPipelineRepository } from "./postgres-project-pipeline-repository.js";
import { projectPipelines } from "./project-pipelines.schema.js";

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

const LINUX_AFTER_TESTS: StageChange = {
  kind: "insert-after",
  stageKey: "tests",
  stageName: "Tests",
  stage: scriptStage({ key: "linux", name: "Verify on Linux", command: "linux" }),
};

/** A row as the release before kept it: a base Pipeline and Stage changes, no flow of its own. */
async function aLegacyRow(
  basePipelineId: string,
  stageChanges: readonly StageChange[],
): Promise<LegacyProjectPipeline> {
  const legacy: LegacyProjectPipeline = {
    id: randomUUID(),
    projectId: randomUUID(),
    name: "Legacy",
    description: "Built on a base.",
    basePipelineId,
    stageChanges,
  };
  await database.insert(projectPipelines).values({ ...legacy, stageChanges: [...stageChanges] });
  return legacy;
}

async function legacyColumnsOf(id: string) {
  const [row] = await database
    .select({
      basePipelineId: projectPipelines.basePipelineId,
      stageChanges: projectPipelines.stageChanges,
    })
    .from(projectPipelines)
    .where(eq(projectPipelines.id, id));
  return row;
}

describe("PostgresProjectPipelineRepository", () => {
  it("keeps a Project Pipeline as added and saved, in the order added, until it is removed", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const first = aProjectPipeline(source);
    const second = aProjectPipeline(source, { projectId: first.projectId, name: "Second" });
    const elsewhere = aProjectPipeline(source);

    await repository.add(first, source.id);
    await repository.add(second, source.id);
    await repository.add(elsewhere, source.id);
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

  it("names the office-wide Pipeline at the root of a copy in the legacy columns, with no Stage changes", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const copy = aProjectPipeline(source);
    await repository.add(copy, source.id);
    const copyOfCopy = aProjectPipeline(source, { projectId: copy.projectId, name: "Again" });
    await repository.add(copyOfCopy, copy.id);

    expect(await legacyColumnsOf(copy.id)).toEqual({ basePipelineId: source.id, stageChanges: [] });
    expect(await legacyColumnsOf(copyOfCopy.id)).toEqual({
      basePipelineId: source.id,
      stageChanges: [],
    });
  });

  it("refuses a second name of the same Project in any case", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const first = aProjectPipeline(source);
    await repository.add(first, source.id);

    await expect(
      repository.add(
        aProjectPipeline(source, { projectId: first.projectId, name: "with LINUX check" }),
        source.id,
      ),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
  });

  it("lets the office-wide Pipeline a Project Pipeline was copied from be removed", async () => {
    const source = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const copy = aProjectPipeline(source);
    await repository.add(copy, source.id);

    await new PostgresPipelineRepository(database).remove(source.id);
    expect(await repository.find(copy.id)).toEqual(copy);
  });

  it("reads a row not yet moved as the move makes it, Broken when its base Pipeline is gone", async () => {
    const base = await anOfficeWidePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const legacy = await aLegacyRow(base.id, [LINUX_AFTER_TESTS]);
    const orphan = await aLegacyRow(randomUUID(), []);

    const read = movedProjectPipeline(legacy, base);
    expect(read.stages.map(({ key }) => key)).toEqual(["implement", "tests", "linux"]);
    expect(await repository.find(legacy.id)).toEqual(read);
    expect(await repository.listOf(legacy.projectId)).toEqual([read]);
    expect(await repository.find(orphan.id)).toEqual(movedProjectPipeline(orphan, undefined));
    expect((await repository.find(orphan.id))?.brokenBeforeUpdate).toHaveLength(1);
  });

  it("moves a legacy row over once, and a save writes its Broken flag as given", async () => {
    const repository = new PostgresProjectPipelineRepository(database);
    const legacy = await aLegacyRow(randomUUID(), []);
    expect(await repository.rowsToMoveOver()).toContainEqual(legacy);

    const moved = movedProjectPipeline(legacy, undefined);
    await repository.moveOver(moved);
    expect((await repository.rowsToMoveOver()).map(({ id }) => id)).not.toContain(legacy.id);
    expect(await repository.find(legacy.id)).toEqual(moved);

    // A second move, as from another start, changes nothing.
    await repository.moveOver({ ...moved, stages: straightLineFlow([agentStage()]) });
    expect(await repository.find(legacy.id)).toEqual(moved);

    // Ending it is the user's save (`savedProjectPipeline`); a template's edit applied keeps it.
    const kept = {
      ...moved,
      stages: straightLineFlow([agentStage()]),
      brokenBeforeUpdate: ["Still broken."],
    };
    await repository.save(kept);
    expect(await repository.find(legacy.id)).toEqual(kept);
    await repository.save({ ...kept, brokenBeforeUpdate: null });
    expect(await repository.find(legacy.id)).toEqual({ ...kept, brokenBeforeUpdate: null });
  });
});
