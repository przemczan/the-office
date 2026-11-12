import { randomUUID } from "node:crypto";
import type { INestApplicationContext } from "@nestjs/common";
import type { Pipeline } from "./domain/pipeline.js";
import type { ProjectPipeline } from "./domain/project-pipeline.js";
import { agentStage, scriptStage } from "./domain/stage.fixtures.js";
import { PipelineRepository } from "./ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "./ports/project-pipeline-repository.js";

/**
 * Office-wide base Pipelines and Project Pipelines written straight into the library of `app`, for
 * other modules' tests: each test makes its own, under names of its own, and never touches a
 * built-in.
 */
export function projectPipelinesForTests(app: INestApplicationContext) {
  const pipelines = app.get(PipelineRepository);
  const projectPipelines = app.get(ProjectPipelineRepository);
  return {
    /** An office-wide Pipeline of Implement, then Tests running the `test` command. */
    async aBasePipeline(): Promise<Pipeline> {
      const pipeline: Pipeline = {
        id: randomUUID(),
        name: `Base ${randomUUID()}`,
        description: "For a base Pipeline's tests.",
        stages: [agentStage(), scriptStage()],
      };
      await pipelines.add(pipeline);
      return pipeline;
    },

    /** A Project Pipeline of `projectId` that runs `command` in a Stage inserted after Tests. */
    async aProjectPipeline(
      projectId: string,
      basePipeline: Pipeline,
      command = "test",
    ): Promise<ProjectPipeline> {
      const projectPipeline: ProjectPipeline = {
        id: randomUUID(),
        projectId,
        name: `With Linux check ${randomUUID()}`,
        description: "Then Linux.",
        basePipelineId: basePipeline.id,
        stageChanges: [
          {
            kind: "insert-after",
            stageKey: "tests",
            stageName: "Tests",
            stage: scriptStage({ key: "linux", name: "Verify on Linux", command }),
          },
        ],
      };
      await projectPipelines.add(projectPipeline);
      return projectPipeline;
    },

    /**
     * Saves the base Pipeline without its Tests, which each Project Pipeline built from it inserts
     * after, so each is Broken.
     */
    async breakProjectPipelinesOf(basePipeline: Pipeline): Promise<void> {
      await pipelines.save({
        ...basePipeline,
        stages: basePipeline.stages.filter(({ key }) => key !== "tests"),
      });
    },
  };
}
