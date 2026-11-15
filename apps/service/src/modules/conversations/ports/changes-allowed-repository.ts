/** Where Allow changes is kept, by Thread: each Caretaker Thread the user allowed changes in (spec §2.4). */
export abstract class ChangesAllowedRepository {
  /** Allows changes in the Thread; nothing when they are allowed already. */
  abstract allow(threadId: string, allowedAt: Date): Promise<void>;

  /** Switches changes off in the Thread; whether they were allowed. */
  abstract switchOff(threadId: string): Promise<boolean>;

  /** Whether changes are allowed in the Thread. */
  abstract isAllowed(threadId: string): Promise<boolean>;

  /** Those of the Threads changes are allowed in, by their ids. */
  abstract allowedAmong(threadIds: readonly string[]): Promise<ReadonlySet<string>>;
}
