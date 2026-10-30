import type { TokenKinds } from "../domain/office-day.js";

/** A Thread's tokens by kind: of its ended turns, and so far with the running one. */
export interface ThreadTokens {
  readonly endedTurns: TokenKinds;
  readonly soFar: TokenKinds;
}

/**
 * Each day's figures, counted from events as they come (`officeDayOf`): no module keeps tokens or
 * Stage runs by day.
 */
export abstract class OfficeDayFigures {
  /**
   * Counts a Thread's tokens so far, each kind apart: the day gains what each grew by since the
   * Thread's last count, which shrinks when a turn's own count replaces its running one. A Thread
   * not counted before is measured from its ended turns, so a Thread older than the count adds
   * only its running turn, not its whole history.
   */
  abstract countThreadTokens(threadId: string, tokens: ThreadTokens, day: string): Promise<void>;
  /** Every kind; which of them a count shows is the web's (spec 2.7, "Today's figures"). */
  abstract tokensOn(day: string): Promise<TokenKinds>;
  /** Marks the Task touched on the day; marking it again changes nothing. */
  abstract touchTask(taskId: string, day: string): Promise<void>;
  abstract tasksTouchedOn(day: string): Promise<number>;
}
