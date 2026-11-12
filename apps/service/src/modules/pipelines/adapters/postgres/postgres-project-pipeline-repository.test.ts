import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Pipeline } from "../../domain/pipeline.js";
import type { ProjectPipeline } from "../../domain/project-pipeline.js";
import { agentStage, scriptStage } from "../../domain/stage.fixtures.js";
import { PostgresPipelineRepository } from "./postgres-pipeline-repository.js";
import { PostgresProjectPipelineRepository } from "./postgres-project-pipeline-repository.js";

// The test database is shared by every test file: these Pipelines and Projects are this file's own.

/** Postgres' error codes. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const RESTRICT_VIOLATION = "23001";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

async function aBasePipeline(): Promise<Pipeline> {
  const pipeline: Pipeline = {
    id: randomUUID(),
    name: `Base ${randomUUID()}`,
    description: "To build on.",
    stages: [agentStage(), scriptStage()],
  };
  await new PostgresPipelineRepository(database).add(pipeline);
  return pipeline;
}

function aProjectPipeline(fields: Partial<ProjectPipeline>): ProjectPipeline {
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    name: "With Linux check",
    description: "Then Linux.",
    basePipelineId: "set by the test",
    stageChanges: [
      {
        kind: "insert-after",
        stageKey: "tests",
        stageName: "Tests",
        stage: scriptStage({ key: "linux", name: "Verify on Linux", command: "linux" }),
      },
      { kind: "change", stageKey: "implement", stageName: "Implement", fields: { effort: null } },
      { kind: "remove", stageKey: "tests", stageName: "Tests" },
    ],
    ...fields,
  };
}

describe("PostgresProjectPipelineRepository", () => {
  it("keeps a Project Pipeline as added and saved, in the order added, until it is removed", async () => {
    const base = await aBasePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const first = aProjectPipeline({ basePipelineId: base.id });
    const second = aProjectPipeline({
      basePipelineId: base.id,
      projectId: first.projectId,
      name: "Second",
    });
    const elsewhere = aProjectPipeline({ basePipelineId: base.id, name: "With Linux check" });

    await repository.add(first);
    await repository.add(second);
    await repository.add(elsewhere);
    const saved = { ...first, name: "Renamed", stageChanges: [], projectId: randomUUID() };
    await repository.save(saved);

    const kept = { ...saved, projectId: first.projectId };
    expect(await repository.find(first.id)).toEqual(kept);
    expect(await repository.listOf(first.projectId)).toEqual([kept, second]);
    expect(await repository.builtFrom(base.id)).toEqual([kept, second, elsewhere]);
    expect(await repository.list()).toEqual(expect.arrayContaining([kept, second, elsewhere]));

    await repository.remove(second.id);
    expect(await repository.find(second.id)).toBeUndefined();
  });

  it("refuses a second name of the same Project in any case, and a base Pipeline that isn't there", async () => {
    const base = await aBasePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const first = aProjectPipeline({ basePipelineId: base.id });
    await repository.add(first);

    await expect(
      repository.add(
        aProjectPipeline({
          basePipelineId: base.id,
          projectId: first.projectId,
          name: "with LINUX check",
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: UNIQUE_VIOLATION } });
    await expect(
      repository.add(aProjectPipeline({ basePipelineId: randomUUID() })),
    ).rejects.toMatchObject({ cause: { code: FOREIGN_KEY_VIOLATION } });
  });

  it("keeps a base Pipeline while a Project Pipeline is built from it", async () => {
    const base = await aBasePipeline();
    await new PostgresProjectPipelineRepository(database).add(
      aProjectPipeline({ basePipelineId: base.id }),
    );

    await expect(new PostgresPipelineRepository(database).remove(base.id)).rejects.toMatchObject({
      cause: { code: RESTRICT_VIOLATION },
    });
  });
});
