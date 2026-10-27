/** A Thread's tokens, all four kinds: of its ended turns, and so far with the running one. */
export interface ThreadTokens {
  readonly endedTurns: number;
  readonly soFar: number;
}

/**
 * Each day's figures, counted from events as they come (`officeDayOf`): no module keeps tokens or
 * Stage runs by day.
 */
export abstract class OfficeDayFigures {
  /**
   * Counts a Thread's tokens so far, all four kinds: the day gains what they grew by since the
   * Thread's last count, which shrinks when a turn's own count replaces its running one. A Thread
   * not counted before is measured from its ended turns, so a Thread older than the count adds
   * only its running turn, not its whole history.
   */
  abstract countThreadTokens(threadId: string, tokens: ThreadTokens, day: string): Promise<void>;
  abstract tokensOn(day: string): Promise<number>;
  /** Marks the Task touched on the day; marking it again changes nothing. */
  abstract touchTask(taskId: string, day: string): Promise<void>;
  abstract tasksTouchedOn(day: string): Promise<number>;
}
