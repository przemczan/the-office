import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../platform/database/database.js";
import { PostgresPipelineRepository } from "../adapters/postgres/postgres-pipeline-repository.js";
import { PostgresProjectPipelineRepository } from "../adapters/postgres/postgres-project-pipeline-repository.js";
import { projectPipelines } from "../adapters/postgres/project-pipelines.schema.js";
import { straightLineFlow } from "../domain/flow.js";
import type { Pipeline } from "../domain/pipeline.js";
import type { LegacyProjectPipeline } from "../domain/project-pipeline.js";
import { buildStages, type StageChange } from "../domain/stage-change.js";
import { agentStage, gate, scriptStage } from "../domain/stage.fixtures.js";
import type { ProjectPipelineRepository } from "../ports/project-pipeline-repository.js";
import type { PipelineLibraryEditor } from "./pipeline-library-editor.js";
import { ProjectPipelineMoveOver } from "./project-pipeline-move-over.js";

// A database of its own: the move moves every legacy row, which other test files' would be.
let fresh: FreshTestDatabase;
let app: INestApplication;
let database: Database;

beforeAll(async () => {
  fresh = await freshTestDatabase();
  ({ app } = await startTestApplication({ database: { url: fresh.url } }));
  database = app.get(DATABASE);
}, 60_000);

afterAll(async () => {
  await app.close();
  await fresh.drop();
});

/** The library's lock is the editor's; here nothing else writes, so the work just runs. */
const editor = {
  holdingLibrary: <Result>(work: () => Promise<Result>) => work(),
} as unknown as PipelineLibraryEditor;

function moveOverOf(projectPipelineRepository: ProjectPipelineRepository): ProjectPipelineMoveOver {
  return new ProjectPipelineMoveOver(
    projectPipelineRepository,
    new PostgresPipelineRepository(database),
    editor,
  );
}

async function aBasePipeline(): Promise<Pipeline> {
  const pipeline: Pipeline = {
    id: randomUUID(),
    name: `Full ${randomUUID()}`,
    description: "To build on.",
    stages: straightLineFlow([
      agentStage(),
      scriptStage(),
      gate({ key: "review", name: "Review" }),
    ]),
  };
  await new PostgresPipelineRepository(database).add(pipeline);
  return pipeline;
}

async function aLegacyRow(
  base: Pipeline,
  stageChanges: readonly StageChange[],
): Promise<LegacyProjectPipeline> {
  const legacy: LegacyProjectPipeline = {
    id: randomUUID(),
    projectId: randomUUID(),
    name: `Legacy ${randomUUID()}`,
    description: "Built on a base.",
    basePipelineId: base.id,
    stageChanges,
  };
  await database.insert(projectPipelines).values({ ...legacy, stageChanges: [...stageChanges] });
  return legacy;
}

describe("ProjectPipelineMoveOver", () => {
  it("keeps each legacy Project Pipeline as the flow its base Pipeline and Stage changes build", async () => {
    const base = await aBasePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    const plainChanges: StageChange[] = [];
    const routeChanges: StageChange[] = [
      {
        kind: "change-routes",
        stageKey: "implement",
        stageName: "Implement",
        routes: [
          {
            to: "review",
            toName: "Review",
            condition: { combine: "all", tests: [{ kind: "definitionOfDone", is: "all-met" }] },
            limit: null,
          },
          { to: "tests", toName: "Tests", condition: null, limit: null },
        ],
      },
    ];
    const brokenChanges: StageChange[] = [
      {
        kind: "insert-after",
        stageKey: "tests",
        stageName: "Tests",
        stage: scriptStage({ key: "linux", name: "Verify on Linux", command: "linux" }),
      },
      { kind: "remove", stageKey: "deploy", stageName: "Deploy" },
    ];
    const plain = await aLegacyRow(base, plainChanges);
    const routes = await aLegacyRow(base, routeChanges);
    const broken = await aLegacyRow(base, brokenChanges);
    // Read before the move: the same converter, so the same Project Pipeline.
    const readBefore = await Promise.all(
      [plain, routes, broken].map(({ id }) => repository.find(id)),
    );

    await moveOverOf(repository).moveOver();

    expect(await repository.rowsToMoveOver()).toEqual([]);
    for (const [legacy, changes] of [
      [plain, plainChanges],
      [routes, routeChanges],
      [broken, brokenChanges],
    ] as const) {
      const moved = await repository.find(legacy.id);
      expect(moved).toMatchObject({
        id: legacy.id,
        projectId: legacy.projectId,
        name: legacy.name,
        description: legacy.description,
        copiedFrom: { name: base.name, at: null },
      });
      expect(moved?.stages).toEqual(buildStages(base, changes).stages);
    }
    expect((await repository.find(plain.id))?.brokenBeforeUpdate).toBeNull();
    expect((await repository.find(routes.id))?.brokenBeforeUpdate).toBeNull();
    const brokenNow = await repository.find(broken.id);
    expect(brokenNow?.stages.map(({ key }) => key)).toEqual([
      "implement",
      "tests",
      "linux",
      "review",
    ]);
    expect(brokenNow?.brokenBeforeUpdate).toEqual([expect.stringContaining("Deploy")]);
    expect(await Promise.all([plain, routes, broken].map(({ id }) => repository.find(id)))).toEqual(
      readBefore,
    );
  });

  it("changes nothing when it runs again", async () => {
    const base = await aBasePipeline();
    const repository = new PostgresProjectPipelineRepository(database);
    await aLegacyRow(base, []);
    const moveOver = moveOverOf(repository);
    await moveOver.moveOver();
    const once = await repository.list();

    await new PostgresPipelineRepository(database).save({
      ...base,
      stages: straightLineFlow([agentStage()]),
    });
    await moveOver.moveOver();

    expect(await repository.list()).toEqual(once);
  });

  it("logs a failure at start and leaves the next start to try again", async () => {
    const failing = {
      rowsToMoveOver: () => Promise.reject(new Error("The database went away.")),
    } as unknown as ProjectPipelineRepository;
    const moveOver = moveOverOf(failing);
    const logged = vi
      .spyOn((moveOver as unknown as { logger: { error: () => void } }).logger, "error")
      .mockImplementation(() => undefined);

    await expect(moveOver.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("the next start tries again"),
      expect.any(Error),
    );
  });
});
