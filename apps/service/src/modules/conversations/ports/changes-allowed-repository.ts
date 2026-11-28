/** Where Allow changes is kept, by Thread: each Caretaker Thread the user allowed changes in (spec §2.4). */
export abstract class ChangesAllowedRepository {
  /**
   * Allows changes in the Thread unless it is answering, checked and switched at once, so no answer
   * begins in between: true once they are allowed (also when they were already), false while the
   * Thread is answering, which allows nothing.
   */
  abstract allowUnlessAnswering(threadId: string, allowedAt: Date): Promise<boolean>;

  /** Switches changes off in the Thread; whether they were allowed. */
  abstract switchOff(threadId: string): Promise<boolean>;

  /** Whether changes are allowed in the Thread. */
  abstract isAllowed(threadId: string): Promise<boolean>;

  /** Those of the Threads changes are allowed in, by their ids. */
  abstract allowedAmong(threadIds: readonly string[]): Promise<ReadonlySet<string>>;
}
