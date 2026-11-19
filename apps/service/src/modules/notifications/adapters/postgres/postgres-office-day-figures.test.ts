import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { dayTokens } from "./notifications.schema.js";
import { PostgresOfficeDayFigures } from "./postgres-office-day-figures.js";

let app: INestApplication;
let figures: PostgresOfficeDayFigures;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, providers: [PostgresOfficeDayFigures] }));
  figures = app.get(PostgresOfficeDayFigures);
  database = app.get<Database>(DATABASE);
});

afterAll(async () => {
  await app.close();
});

function tokensOf(input: number) {
  return { input, output: 2, cacheRead: 3, cacheCreation: 4 };
}

describe("PostgresOfficeDayFigures.tokensBetween", () => {
  it("gives each day from the first to the last that has a count, both included", async () => {
    // Days are one row for every test file, so this test takes a year of its own.
    const year = 3000 + Math.floor(Math.random() * 6000);
    const day = (monthDay: string) => `${year}-${monthDay}`;
    for (const [monthDay, input] of [
      ["03-01", 1],
      ["03-02", 2],
      ["03-04", 4],
      ["03-05", 5],
    ] as const) {
      const row = { day: day(monthDay), ...tokensOf(input) };
      await database
        .insert(dayTokens)
        .values(row)
        .onConflictDoUpdate({ target: dayTokens.day, set: tokensOf(input) });
    }

    const counted = await figures.tokensBetween(day("03-02"), day("03-04"));

    expect([...counted]).toEqual([
      [day("03-02"), tokensOf(2)],
      [day("03-04"), tokensOf(4)],
    ]);
  });
});
