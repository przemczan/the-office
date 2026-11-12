import { expect, type Page } from "@playwright/test";
import {
  pipelineSchema,
  projectPipelineSchema,
  type NewProjectPipeline,
  type Pipeline,
  type PipelineEdit,
  type ProjectPipeline,
} from "@the-office/contracts";

/**
 * An office-wide base Pipeline of its own, made through the API: Build, then Tests. Each test makes
 * its own and never touches a built-in.
 */
export async function addedBasePipeline(page: Page, name: string): Promise<Pipeline> {
  const edit: PipelineEdit = {
    name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
    description: "A base Pipeline of its own.",
    stages: [
      { kind: "script", key: "build", name: "Build", command: "build", optional: false },
      { kind: "script", key: "tests", name: "Tests", command: "test", optional: false },
    ],
  };
  const response = await page.request.post("/api/pipelines", { data: edit });
  expect(response.status()).toBe(201);
  return pipelineSchema.parse(await response.json());
}

/** A Project Pipeline of the Project, built from `base` with Verify on Linux inserted after Tests. */
export async function addedProjectPipeline(
  page: Page,
  projectId: string,
  base: Pipeline,
  name: string,
): Promise<ProjectPipeline> {
  const newProjectPipeline: NewProjectPipeline = {
    projectId,
    name: `${name} ${crypto.randomUUID().slice(0, 8)}`,
    description: "Then Linux.",
    basePipelineId: base.id,
    stageChanges: [
      {
        kind: "insert-after",
        stageKey: "tests",
        stage: {
          kind: "script",
          key: "linux",
          name: "Verify on Linux",
          command: "test",
          optional: false,
        },
      },
    ],
  };
  const response = await page.request.post("/api/project-pipelines", { data: newProjectPipeline });
  expect(response.status()).toBe(201);
  return projectPipelineSchema.parse(await response.json());
}

/**
 * Saves `base` without Tests, which each Project Pipeline built from it inserts after, so each is
 * Broken: an office-wide save warns of it but is never refused for it.
 */
export async function breakProjectPipelinesOf(page: Page, base: Pipeline): Promise<void> {
  const edit: PipelineEdit = {
    name: base.name,
    description: base.description,
    stages: base.stages.filter(({ key }) => key !== "tests"),
  };
  const response = await page.request.put(`/api/pipelines/${base.id}`, { data: edit });
  expect(response.status()).toBe(200);
}
