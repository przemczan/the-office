/** A Thread The Office opens on an Initiative. */
export interface InitiativeThreadWaiting {
  /**
   * The Thread's id, when the caller keeps it before the Thread opens, as Plan the Initiative does;
   * a new one otherwise.
   */
  readonly threadId?: string;
  readonly initiativeId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
  readonly title: string;
}

/** A Thread The Office opens on an Initiative, and what it asks the person first. */
export interface InitiativeThreadOpening extends InitiativeThreadWaiting {
  readonly opening: string;
}

/** The Threads on Initiatives, which the Conversations module keeps; the composition root binds it. */
export abstract class InitiativeThreads {
  /**
   * Opens the Thread, waiting for the user: the person starts on their first message, in a new
   * session with the Initiative's Brief.
   */
  abstract openOnInitiative(waiting: InitiativeThreadWaiting): Promise<{ readonly id: string }>;

  /** Opens the Thread; the person starts on `opening` at once, with the Initiative's Brief. */
  abstract startOnInitiative(opening: InitiativeThreadOpening): Promise<{ readonly id: string }>;

  /**
   * Has the person start again on `opening` in the Thread, its session continued or replaced under
   * the Context policy.
   */
  abstract askAgain(threadId: string, opening: string): Promise<{ readonly id: string }>;
}
