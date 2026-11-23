import { expect, type Page } from "@playwright/test";
import {
  pipelineSchema,
  projectPipelineSchema,
  type NewProjectPipeline,
  type Pipeline,
  type PipelineEdit,
  type ProjectPipeline,
} from "@the-office/contracts";
import { queryOfficeDatabase } from "./office-database.ts";
import { asStageList } from "./stage-list.ts";

/**
 * An office-wide Pipeline of its own to copy, made through the API: Build, then Tests. Each test
 * makes its own and never touches a built-in.
 */
export async function addedBasePipeline(page: Page, name: string): Promise<Pipeline> {
  const edit: PipelineEdit = {
    name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
    description: "A Pipeline of its own to copy.",
    stages: [
      { kind: "script", key: "build", name: "Build", command: "build", optional: false },
      { kind: "script", key: "tests", name: "Tests", command: "test", optional: false },
    ],
  };
  const response = await page.request.post("/api/pipelines", { data: edit });
  expect(response.status()).toBe(201);
  return pipelineSchema.parse(await response.json());
}

/**
 * A Project Pipeline of the Project, copied from `base`, then saved with Verify on Linux after
 * Tests: Build → Tests → Verify on Linux.
 */
export async function addedProjectPipeline(
  page: Page,
  projectId: string,
  base: Pipeline,
  name: string,
): Promise<ProjectPipeline> {
  const newProjectPipeline: NewProjectPipeline = {
    projectId,
    copyOf: base.id,
    name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
    description: "Then Linux.",
  };
  const copied = await page.request.post("/api/project-pipelines", { data: newProjectPipeline });
  expect(copied.status()).toBe(201);
  const copy = projectPipelineSchema.parse(await copied.json());
  const edit: PipelineEdit = {
    name: copy.name,
    description: copy.description,
    // A plain list, which the service draws again as a straight line.
    stages: asStageList([
      ...copy.stages,
      { kind: "script", key: "linux", name: "Verify on Linux", command: "test", optional: false },
    ]),
  };
  const saved = await page.request.put(`/api/project-pipelines/${copy.id}`, { data: edit });
  expect(saved.status()).toBe(200);
  return projectPipelineSchema.parse(await saved.json());
}

/**
 * Flags the Project Pipeline as Broken before The Office updated with `reasons`, as the update to
 * flows leaves one that was Broken: no screen makes one, so it is seeded in the database.
 */
export async function flaggedBrokenBeforeUpdate(
  projectPipeline: ProjectPipeline,
  reasons: readonly string[],
): Promise<void> {
  await queryOfficeDatabase(
    "UPDATE project_pipelines SET broken_before_update = $1::jsonb WHERE id = $2",
    [JSON.stringify(reasons), projectPipeline.id],
  );
}
