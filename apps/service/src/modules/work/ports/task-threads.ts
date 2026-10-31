/** A Thread The Office opens on a Task. */
export interface TaskThreadOpening {
  readonly taskId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
  readonly title: string;
}

/** The Threads on Tasks, which the Conversations module keeps; the composition root binds it. */
export abstract class TaskThreads {
  /**
   * Opens the Thread, waiting for the user: the person starts on their first message, in a new
   * session with the Task's Brief.
   */
  abstract openOnTask(opening: TaskThreadOpening): Promise<{ readonly id: string }>;
}
