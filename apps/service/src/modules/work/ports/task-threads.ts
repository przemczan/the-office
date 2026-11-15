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

/** A person's own Thread on a Task: neither a Stage's nor a Consultation's. */
export interface PersonsTaskThread {
  readonly taskId: string;
  /** Whose it is, by the key of the Role they fill. */
  readonly roleKey: string;
}

/** A Thread on a Task with the person, by its title: their part in the Task. */
export interface TaskThreadTitle {
  readonly taskId: string;
  /** Undefined before its first message. */
  readonly title: string | undefined;
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

  /** The person's own Thread on a Task, by its id; undefined for any other Thread. */
  abstract personsThreadOnTask(threadId: string): Promise<PersonsTaskThread | undefined>;

  /** The title of each of the person's Threads on a Task, by the key of their Role. */
  abstract titlesOnTasksWith(roleKey: string): Promise<readonly TaskThreadTitle[]>;

  /**
   * Has the person start again on `opening` in the Thread, its session continued or replaced under
   * the Context policy.
   */
  abstract askAgain(threadId: string, opening: string): Promise<{ readonly id: string }>;
}
