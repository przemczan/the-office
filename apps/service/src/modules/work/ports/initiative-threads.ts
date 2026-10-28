/** A Thread The Office opens on an Initiative, and what it asks the person first. */
export interface InitiativeThreadOpening {
  readonly initiativeId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
  readonly title: string;
  readonly opening: string;
}

/** The Threads on Initiatives, which the Conversations module keeps; the composition root binds it. */
export abstract class InitiativeThreads {
  /** Opens the Thread; the person starts on `opening` at once, with the Initiative's Brief. */
  abstract startOnInitiative(opening: InitiativeThreadOpening): Promise<{ readonly id: string }>;
}
