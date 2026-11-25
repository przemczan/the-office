import { randomUUID } from "node:crypto";
import type { INestApplicationContext } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../platform/database/database.js";
import { projectPipelines as projectPipelineRows } from "./adapters/postgres/project-pipelines.schema.js";
import { straightLineFlow } from "./domain/flow.js";
import type { Pipeline } from "./domain/pipeline.js";
import type { ProjectPipeline } from "./domain/project-pipeline.js";
import { agentStage, scriptStage } from "./domain/stage.fixtures.js";
import { PipelineRepository } from "./ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "./ports/project-pipeline-repository.js";

/**
 * Office-wide Pipelines and Project Pipelines written straight into the library of `app`, for
 * other modules' tests: each test makes its own, under names of its own, and never touches a
 * built-in.
 */
export function projectPipelinesForTests(app: INestApplicationContext) {
  const pipelines = app.get(PipelineRepository);
  const projectPipelines = app.get(ProjectPipelineRepository);
  return {
    /** An office-wide Pipeline of Implement, then Tests running the `test` command. */
    async anOfficeWidePipeline(): Promise<Pipeline> {
      const pipeline: Pipeline = {
        id: randomUUID(),
        name: `Full ${randomUUID()}`,
        description: "For a Project Pipeline's tests.",
        stages: straightLineFlow([agentStage(), scriptStage()]),
      };
      await pipelines.add(pipeline);
      return pipeline;
    },

    /**
     * A Project Pipeline of `projectId` copied from `source`, an office-wide Pipeline of Implement
     * then Tests, with a Stage after Tests that runs `command`.
     */
    async aProjectPipeline(
      projectId: string,
      source: Pipeline,
      command = "test",
    ): Promise<ProjectPipeline> {
      const projectPipeline: ProjectPipeline = {
        id: randomUUID(),
        projectId,
        name: `With Linux check ${randomUUID()}`,
        description: "Then Linux.",
        stages: straightLineFlow([
          agentStage(),
          scriptStage(),
          scriptStage({ key: "linux", name: "Verify on Linux", command }),
        ]),
        copiedFrom: { name: source.name, at: new Date() },
        brokenBeforeUpdate: null,
      };
      await projectPipelines.add(projectPipeline);
      return projectPipeline;
    },

    /**
     * Flags the Project Pipeline Broken before the update, as the move flags one whose Stage
     * change no longer applied, with `reason` as its words, until it is saved.
     */
    async breakProjectPipeline(
      projectPipeline: { readonly id: string },
      reason = "Inserts Verify on Linux after Tests, which its base Pipeline no longer has.",
    ): Promise<void> {
      await app
        .get<Database>(DATABASE)
        .update(projectPipelineRows)
        .set({ brokenBeforeUpdate: [reason] })
        .where(eq(projectPipelineRows.id, projectPipeline.id));
    },
  };
}
