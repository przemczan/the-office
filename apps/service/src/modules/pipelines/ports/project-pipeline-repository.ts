import type { LegacyProjectPipeline, ProjectPipeline } from "../domain/project-pipeline.js";

/** The Project Pipelines, stored by The Office beside the office-wide Pipelines. */
export abstract class ProjectPipelineRepository {
  /** Every Project's, in the order they were added in; a row not yet moved read as it moves. */
  abstract list(): Promise<readonly ProjectPipeline[]>;

  /** The Project's own, in the order they were added in. */
  abstract listOf(projectId: string): Promise<readonly ProjectPipeline[]>;

  abstract find(id: string): Promise<ProjectPipeline | undefined>;

  /**
   * Adds it as a copy of `copyOf`, an office-wide Pipeline or a Project Pipeline, by id, which the
   * legacy columns name for the previous release to read.
   */
  abstract add(projectPipeline: ProjectPipeline, copyOf: string): Promise<void>;

  /** Replaces the stored Project Pipeline's name, description and Stages; ends its Broken flag. */
  abstract save(projectPipeline: ProjectPipeline): Promise<void>;

  abstract remove(id: string): Promise<void>;

  /** The rows kept as a base Pipeline and Stage changes, which the move at start hasn't moved. */
  abstract rowsToMoveOver(): Promise<readonly LegacyProjectPipeline[]>;

  /** Stores the flow the move made of a legacy row, unless another start stored it first. */
  abstract moveOver(moved: ProjectPipeline): Promise<void>;
}
