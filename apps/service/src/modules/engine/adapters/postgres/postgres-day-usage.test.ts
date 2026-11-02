import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { PostgresDayUsage } from "./postgres-day-usage.js";

let app: INestApplication;
let dayUsage: PostgresDayUsage;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, providers: [PostgresDayUsage] }));
  dayUsage = app.get(PostgresDayUsage);
});

afterAll(async () => {
  await app.close();
});

// Every test file shares the database, and every scripted session adds to today's use: these tests
// keep to a day no clock reaches and to models of their own.
const DAY = "2001-03-04";

describe("PostgresDayUsage", () => {
  it("adds each model's tokens up, kind by kind, apart by engine and by day", async () => {
    const model = `model-${randomUUID()}`;
    const other = `model-${randomUUID()}`;
    const turn = { input: 4, output: 12, cacheRead: 24_000, cacheCreation: 200 };

    await dayUsage.add(DAY, "claude-code", model, turn);
    await dayUsage.add(DAY, "claude-code", model, { ...turn, output: 3_000_000_000 });
    await dayUsage.add(DAY, "claude-code", other, turn);
    await dayUsage.add(DAY, "openai-compatible-api", model, turn);
    await dayUsage.add("2001-03-05", "claude-code", model, turn);

    const used = await dayUsage.on(DAY, "claude-code");
    expect(used.filter((usage) => usage.model === model)).toEqual([
      {
        model,
        tokens: { input: 8, output: 3_000_000_012, cacheRead: 48_000, cacheCreation: 400 },
      },
    ]);
    expect(used.filter((usage) => usage.model === other)).toEqual([{ model: other, tokens: turn }]);
    expect(
      (await dayUsage.on(DAY, "openai-compatible-api")).filter((usage) => usage.model === model),
    ).toEqual([{ model, tokens: turn }]);
  });

  it("forgets every day's use on one engine, and no other's", async () => {
    const removed = `removed-${randomUUID()}`;
    const kept = `kept-${randomUUID()}`;
    const turn = { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 };
    await dayUsage.add(DAY, removed, "model", turn);
    await dayUsage.add("2001-03-05", removed, "model", turn);
    await dayUsage.add(DAY, kept, "model", turn);

    await dayUsage.forget(removed);

    expect(await dayUsage.on(DAY, removed)).toEqual([]);
    expect(await dayUsage.on("2001-03-05", removed)).toEqual([]);
    expect(await dayUsage.on(DAY, kept)).toEqual([{ model: "model", tokens: turn }]);
    await dayUsage.forget(kept);
  });
});
