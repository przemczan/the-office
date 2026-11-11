/** A Project as the library reads it: the Pipeline it names as its default, and its commands' keys. */
export interface ProjectDefault {
  readonly id: string;
  readonly name: string;
  readonly defaultPipeline: string;
  readonly commands: readonly { readonly key: string }[];
}

/**
 * The Projects, the default Pipeline each names and the commands each has, in Projects, for the
 * library to refuse removing a Pipeline, or saving one with a command a Project using it lacks.
 * Bound to Projects' ProjectService; the not-started Tasks come through `StartedTasks`.
 */
export abstract class ProjectDefaults {
  abstract list(): Promise<readonly ProjectDefault[]>;
}
