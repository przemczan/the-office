/**
 * The Pipelines a Project may name as its default. A port rather than the Pipelines module itself,
 * because Pipelines' Stage interpreter calls Projects (git, commands): the composition root binds
 * it, and Projects never imports Pipelines.
 */
export abstract class KnownPipelines {
  abstract has(id: string): Promise<boolean>;
}
