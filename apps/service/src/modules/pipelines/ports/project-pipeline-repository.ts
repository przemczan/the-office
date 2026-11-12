import type { ProjectPipeline } from "../domain/project-pipeline.js";

/** The Project Pipelines, stored by The Office beside the office-wide Pipelines. */
export abstract class ProjectPipelineRepository {
  /** Every Project's, in the order they were added in. */
  abstract list(): Promise<readonly ProjectPipeline[]>;

  /** The Project's own, in the order they were added in. */
  abstract listOf(projectId: string): Promise<readonly ProjectPipeline[]>;

  abstract find(id: string): Promise<ProjectPipeline | undefined>;

  /** Those built from the office-wide Pipeline, in the order they were added in. */
  abstract builtFrom(basePipelineId: string): Promise<readonly ProjectPipeline[]>;

  abstract add(projectPipeline: ProjectPipeline): Promise<void>;

  /** Replaces the stored Project Pipeline with this id; its Project stays. */
  abstract save(projectPipeline: ProjectPipeline): Promise<void>;

  abstract remove(id: string): Promise<void>;
}
