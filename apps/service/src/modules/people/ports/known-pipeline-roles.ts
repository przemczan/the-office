/**
 * The Roles the Pipelines name. A port rather than the Pipelines module itself, because Pipelines
 * reads Role cards from People: the composition root binds it to Pipelines' `PipelineLibrary`.
 */
export abstract class KnownPipelineRoles {
  abstract rolesNamed(): Promise<ReadonlySet<string>>;
}
