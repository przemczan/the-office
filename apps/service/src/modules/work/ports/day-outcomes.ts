/** Tokens by kind, as the engine reports them. */
export interface DayTokens {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

/** A Task whose Stage failed for good in the day, by its id; the Stage when one is named. */
export interface FailedTask {
  readonly taskId: string;
  readonly stageName: string | undefined;
  readonly at: Date;
}

/**
 * What Notifications counted of a day from events, as ids and figures, never Task details: Work
 * joins the ids to its own Tasks. The composition root binds it.
 */
export abstract class DayOutcomes {
  /** The day's tokens, Office-wide. `day` is its office day, `YYYY-MM-DD`. */
  abstract tokens(day: string): Promise<DayTokens>;
  /** The Tasks that failed in the office day `day`, each at its latest failure. */
  abstract failedTasks(day: string): Promise<readonly FailedTask[]>;
}
