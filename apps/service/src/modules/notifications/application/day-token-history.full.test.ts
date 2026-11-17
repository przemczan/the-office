import { afterEach, describe, expect, it } from "vitest";
import { NO_TOKENS, type TokenKinds } from "../domain/office-day.js";
import { OfficeDayFigures } from "../ports/office-day-figures.js";
import { DayTokenHistory } from "./day-token-history.js";

const zoneAtStart = process.env.TZ;

afterEach(() => {
  if (zoneAtStart === undefined) delete process.env.TZ;
  else process.env.TZ = zoneAtStart;
});

class CountedDays extends OfficeDayFigures {
  readonly asked: [string, string][] = [];

  constructor(private readonly days: ReadonlyMap<string, TokenKinds>) {
    super();
  }

  async countThreadTokens(): Promise<void> {}

  async tokensOn(day: string): Promise<TokenKinds> {
    return this.days.get(day) ?? NO_TOKENS;
  }

  async tokensBetween(firstDay: string, lastDay: string): Promise<ReadonlyMap<string, TokenKinds>> {
    this.asked.push([firstDay, lastDay]);
    return new Map([...this.days].filter(([day]) => day >= firstDay && day <= lastDay));
  }
}

function inputTokens(input: number): TokenKinds {
  return { ...NO_TOKENS, input };
}

describe("DayTokenHistory.lastDays", () => {
  it("gives the last days ending today, oldest first, each day with no count all zero", async () => {
    const figures = new CountedDays(
      new Map([
        ["2026-11-14", inputTokens(14)],
        ["2026-11-17", inputTokens(17)],
        ["2026-11-18", inputTokens(18)],
      ]),
    );
    const history = new DayTokenHistory(figures);

    const days = await history.lastDays(4, new Date(2026, 10, 17, 23, 59));

    expect(figures.asked).toEqual([["2026-11-14", "2026-11-17"]]);
    expect(days).toEqual([
      { day: "2026-11-14", tokens: inputTokens(14) },
      { day: "2026-11-15", tokens: NO_TOKENS },
      { day: "2026-11-16", tokens: NO_TOKENS },
      { day: "2026-11-17", tokens: inputTokens(17) },
    ]);
  });

  it("neither skips nor repeats a day across a change of clock", async () => {
    process.env.TZ = "Europe/Warsaw";
    const history = new DayTokenHistory(new CountedDays(new Map()));

    // Warsaw's clocks go forward on 2026-03-29 and back on 2026-10-25.
    const spring = await history.lastDays(3, new Date(2026, 2, 30, 0, 30));
    const autumn = await history.lastDays(3, new Date(2026, 9, 26, 0, 30));

    expect(spring.map(({ day }) => day)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    expect(autumn.map(({ day }) => day)).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
  });
});
