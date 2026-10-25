/** A Thread The Office opens on a Task, and what it asks the person first. */
export interface TaskThreadOpening {
  readonly taskId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
  readonly title: string;
  readonly opening: string;
}

/** The Threads on Tasks, which the Conversations module keeps; the composition root binds it. */
export abstract class TaskThreads {
  /** Opens the Thread; the person starts on `opening` at once, with the Task's Brief. */
  abstract startOnTask(opening: TaskThreadOpening): Promise<{ readonly id: string }>;
}
