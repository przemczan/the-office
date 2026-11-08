/** A Task as the startup sweep weighs it. */
export interface KnownTask {
  readonly id: string;
  readonly state: string;
}

/**
 * Work's Tasks, for the startup sweep: a run environment is kept while its Task is neither Done nor
 * Dropped. Bound to Work's `TaskService` in app.module.ts, since Pipelines, which Work's Tasks walk
 * through, will call this module.
 */
export abstract class KnownTasks {
  abstract list(): Promise<readonly KnownTask[]>;
}
