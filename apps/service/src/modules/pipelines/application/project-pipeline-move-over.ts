import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { movedProjectPipeline } from "../domain/project-pipeline.js";
import { PipelineRepository } from "../ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "../ports/project-pipeline-repository.js";
import { PipelineLibraryEditor } from "./pipeline-library-editor.js";

/**
 * Moves each Project Pipeline still kept as a base Pipeline and Stage changes to the flow they
 * build, once, as the service starts after the update that brings flows of their own (spec §2.3.5,
 * "The move to routes back and Publish Stages"). A row moved is never read as legacy again, so a
 * crash halfway is made good at the next start; until then a row not moved reads as it would move.
 */
@Injectable()
export class ProjectPipelineMoveOver implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectPipelineMoveOver.name);

  constructor(
    private readonly projectPipelines: ProjectPipelineRepository,
    private readonly pipelines: PipelineRepository,
    private readonly editor: PipelineLibraryEditor,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.moveOver();
    } catch (error) {
      this.logger.error(
        "Moving the Project Pipelines to flows of their own failed; the next start tries again.",
        error,
      );
    }
  }

  /**
   * Moves every row not moved yet under the library's lock, so no save of a base Pipeline lands
   * between reading it and storing what it built.
   */
  async moveOver(): Promise<void> {
    await this.editor.holdingLibrary(async () => {
      for (const row of await this.projectPipelines.rowsToMoveOver()) {
        const base = await this.pipelines.find(row.basePipelineId);
        await this.projectPipelines.moveOver(movedProjectPipeline(row, base));
      }
    });
  }
}
