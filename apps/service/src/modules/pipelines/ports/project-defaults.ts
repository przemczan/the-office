/** A Project as the library reads it: the Pipeline it names as its default. */
export interface ProjectDefault {
  readonly id: string;
  readonly name: string;
  readonly defaultPipeline: string;
}

/**
 * The Projects and the default Pipeline each names, in Projects, for the library to refuse removing
 * one. Bound to Projects' ProjectService; the not-started Tasks come through `StartedTasks`.
 */
export abstract class ProjectDefaults {
  abstract list(): Promise<readonly ProjectDefault[]>;
}
