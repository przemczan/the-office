import { Injectable } from "@nestjs/common";
import { officeDayOf } from "../../../platform/office-day.js";
import { NO_TOKENS, type TokenKinds } from "../domain/office-day.js";
import { OfficeDayFigures } from "../ports/office-day-figures.js";

/** One office day's tokens, Office-wide, each kind apart. */
export interface DayTokens {
  /** Its office day, `YYYY-MM-DD` (`officeDayOf`). */
  readonly day: string;
  readonly tokens: TokenKinds;
}

/** The tokens of past office days, as counted from events (`day_tokens`). */
@Injectable()
export class DayTokenHistory {
  constructor(private readonly figures: OfficeDayFigures) {}

  /**
   * The last `count` office days ending with `now`'s, oldest first; a day with no count is all zero.
   * The days step back by calendar day in local time, so a DST change neither skips nor repeats one.
   */
  async lastDays(count: number, now: Date): Promise<readonly DayTokens[]> {
    if (count <= 0) return [];
    const days = Array.from({ length: count }, (_, index) =>
      officeDayOf(
        new Date(now.getFullYear(), now.getMonth(), now.getDate() - (count - 1 - index), 12),
      ),
    );
    const counted = await this.figures.tokensBetween(days[0]!, days[days.length - 1]!);
    return days.map((day) => ({ day, tokens: counted.get(day) ?? NO_TOKENS }));
  }
}
