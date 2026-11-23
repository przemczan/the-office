import type { PipelineCommands } from "../domain/pipeline-commands.js";

/**
 * The Pipelines a Project may name as its default: office-wide ones and its own Project Pipelines.
 * A port rather than the Pipelines module itself, because Pipelines' Stage interpreter calls
 * Projects (git, commands): the composition root binds it, and Projects never imports Pipelines.
 */
export abstract class KnownPipelines {
  /**
   * The Pipeline's name and the command keys its Stages run, a Project Pipeline's with its Project
   * and why it was Broken before The Office updated; undefined for one neither the library nor a Project has.
   */
  abstract commandsNamedBy(id: string): Promise<PipelineCommands | undefined>;
}
