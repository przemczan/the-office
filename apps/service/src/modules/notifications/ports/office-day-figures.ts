/**
 * Each day's figures, counted from events as they come (`officeDayOf`): no module keeps tokens or
 * Stage runs by day.
 */
export abstract class OfficeDayFigures {
  /**
   * Counts a Thread's tokens so far, all four kinds: the day gains what they grew by since the
   * Thread's last count, which shrinks when a turn's own count replaces its running one.
   */
  abstract countThreadTokens(threadId: string, tokensSoFar: number, day: string): Promise<void>;
  abstract tokensOn(day: string): Promise<number>;
  /** Marks the Task touched on the day; marking it again changes nothing. */
  abstract touchTask(taskId: string, day: string): Promise<void>;
  abstract tasksTouchedOn(day: string): Promise<number>;
}
