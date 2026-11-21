/** A Task as the startup sweep weighs it, and as busy work names it. */
export interface KnownTask {
  readonly id: string;
  readonly title: string;
  readonly state: string;
}

/**
 * Work's Tasks, for the startup sweep: a run environment is kept while its Task is neither Done nor
 * Dropped. Bound to Work's `TaskService` in app.module.ts, since Pipelines, which Work's Tasks walk
 * through, will call this module.
 */
export abstract class KnownTasks {
  /** The Tasks neither Done nor Dropped. */
  abstract open(): Promise<readonly KnownTask[]>;

  /** The Task; throws when there is none. */
  abstract read(id: string): Promise<KnownTask>;
}
