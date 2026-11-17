import type { StatsTokens } from "../domain/basic-stats.js";

/** One office day's tokens, Office-wide; `day` is its office day, `YYYY-MM-DD`. */
export interface StatsDay {
  readonly day: string;
  readonly tokens: StatsTokens;
}

/** The tokens of past office days, as Notifications counts them; the composition root binds it. */
export abstract class DayTokens {
  /** The last `count` office days ending with `now`'s, oldest first; a day with none is all zero. */
  abstract lastDays(count: number, now: Date): Promise<readonly StatsDay[]>;
}
