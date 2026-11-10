import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DEFAULT_RUN_ENVIRONMENT_OPTIONS } from "../../domain/run-environment.js";
import { PostgresRunEnvironmentSettings } from "./postgres-run-environment-settings.js";
import { runEnvironmentSettings } from "./run-environment-settings.schema.js";

let app: INestApplication;
let settings: PostgresRunEnvironmentSettings;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresRunEnvironmentSettings],
  }));
  settings = app.get(PostgresRunEnvironmentSettings);
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

// Saves only the defaults: every test file shares the row.
describe("PostgresRunEnvironmentSettings", () => {
  it("saves the limits and Run environments at once in its one row, and again over it", async () => {
    await settings.change(DEFAULT_RUN_ENVIRONMENT_OPTIONS);
    await settings.change(DEFAULT_RUN_ENVIRONMENT_OPTIONS);

    expect(await settings.read()).toEqual(DEFAULT_RUN_ENVIRONMENT_OPTIONS);
  });

  it("reads Automatic from the column's default, as on a fresh database", async () => {
    const { limits, runEnvironmentsAtOnce } = DEFAULT_RUN_ENVIRONMENT_OPTIONS;
    const values = {
      cpus: limits.cpuLimit.fixedCpus,
      memoryMegabytes: limits.memoryMegabytes,
      processes: limits.processes,
      runEnvironmentsAtOnce,
    };
    await database
      .insert(runEnvironmentSettings)
      .values(values)
      .onConflictDoUpdate({
        target: runEnvironmentSettings.id,
        set: { ...values, cpuLimit: sql`default` },
      });

    expect((await settings.read()).limits.cpuLimit.choice).toBe("automatic");
  });
});
