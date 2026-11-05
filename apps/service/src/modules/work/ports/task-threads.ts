/** A Thread The Office opens on a Task. */
export interface TaskThreadOpening {
  readonly taskId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
  readonly title: string;
}

/** A Thread The Office opens on a Task with what it asks the person first. */
export interface TaskThreadStarting extends TaskThreadOpening {
  readonly opening: string;
}

/** The Threads on Tasks, which the Conversations module keeps; the composition root binds it. */
export abstract class TaskThreads {
  /**
   * Opens the Thread, waiting for the user: the person starts on their first message, in a new
   * session with the Task's Brief.
   */
  abstract openOnTask(opening: TaskThreadOpening): Promise<{ readonly id: string }>;

  /** Opens the Thread; the person starts on `opening` at once, with the Task's Brief. */
  abstract startOnTask(starting: TaskThreadStarting): Promise<{ readonly id: string }>;
}
