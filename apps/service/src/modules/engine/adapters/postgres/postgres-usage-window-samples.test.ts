import type { INestApplication } from "@nestjs/common";
import { gte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { PostgresUsageWindowSamples } from "./postgres-usage-window-samples.js";
import { usageWindowSamples } from "./usage-window-samples.schema.js";

let app: INestApplication;
let samples: PostgresUsageWindowSamples;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresUsageWindowSamples],
  }));
  samples = app.get(PostgresUsageWindowSamples);
});

// Left behind, they would stay the latest and stand in every later run's ratios.
afterAll(async () => {
  await app
    .get<Database>(DATABASE)
    .delete(usageWindowSamples)
    .where(gte(usageWindowSamples.readAt, new Date("2100-01-01T00:00:00Z")));
  await app.close();
});

// Every test file shares the database, and every scripted session's readings may add pairs: these
// are read later than any clock reaches, so they are the latest.
const sampleAt = (year: number, fiveHour: number | undefined) => ({
  readAt: new Date(`${year}-01-01T00:00:00Z`),
  tokens: 1_000 * (year - 2100),
  fiveHour,
  sevenDay: 0,
});

describe("PostgresUsageWindowSamples", () => {
  it("keeps the latest pairs of an engine id, newest first, a window left out as undefined", async () => {
    await samples.add("claude-code", sampleAt(2101, 1), 2);
    await samples.add("claude-code", sampleAt(2102, undefined), 2);
    await samples.add("claude-code", sampleAt(2103, 0), 2);

    expect(await samples.latest("claude-code", 2)).toEqual([
      sampleAt(2103, 0),
      sampleAt(2102, undefined),
    ]);
    const kept = await samples.latest("claude-code", 10);
    expect(kept.map(({ readAt }) => readAt)).not.toContainEqual(sampleAt(2101, 1).readAt);
  });
});
