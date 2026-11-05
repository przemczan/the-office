/** What a Task's Stages did, for the Brief of a person's Thread on it. */
export interface TaskStageResults {
  /** Each run's result as a line of a Brief, in the order they ran. */
  readonly lines: readonly string[];
  /** The Handover notes of the person's own runs, in the order they ran. */
  readonly handoverNotes: readonly string[];
}

/**
 * The Tasks' Stage results, which the Pipelines module keeps. A port rather than that module
 * itself, because Pipelines calls Work: the composition root binds it.
 */
export abstract class StageResults {
  abstract of(taskId: string, roleKey: string): Promise<TaskStageResults>;
}
