import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DEFAULT_RUN_ENVIRONMENT_OPTIONS } from "../../domain/run-environment.js";
import { PostgresRunEnvironmentSettings } from "./postgres-run-environment-settings.js";

let app: INestApplication;
let settings: PostgresRunEnvironmentSettings;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresRunEnvironmentSettings],
  }));
  settings = app.get(PostgresRunEnvironmentSettings);
});

afterAll(async () => {
  await app.close();
});

describe("PostgresRunEnvironmentSettings", () => {
  // Saves only the defaults: every test file shares the row.
  it("saves the limits and Run environments at once in its one row, and again over it", async () => {
    await settings.change(DEFAULT_RUN_ENVIRONMENT_OPTIONS);
    await settings.change(DEFAULT_RUN_ENVIRONMENT_OPTIONS);

    expect(await settings.read()).toEqual(DEFAULT_RUN_ENVIRONMENT_OPTIONS);
  });
});
