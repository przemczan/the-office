import type { PipelineCommands } from "../domain/pipeline-commands.js";

/**
 * The Pipelines a Project may name as its default. A port rather than the Pipelines module itself,
 * because Pipelines' Stage interpreter calls Projects (git, commands): the composition root binds
 * it, and Projects never imports Pipelines.
 */
export abstract class KnownPipelines {
  /** The Pipeline's name and the command keys its Stages run; undefined for one the library lacks. */
  abstract commandsNamedBy(id: string): Promise<PipelineCommands | undefined>;
}
