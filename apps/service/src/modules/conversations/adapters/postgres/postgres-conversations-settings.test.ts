import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../../domain/context-policy.js";
import { PostgresConversationsSettings } from "./postgres-conversations-settings.js";

let app: INestApplication;
let settings: PostgresConversationsSettings;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresConversationsSettings],
  }));
  settings = app.get(PostgresConversationsSettings);
});

afterAll(async () => {
  await app.close();
});

describe("PostgresConversationsSettings", () => {
  // Saves only the default: every test file shares the row, which each Context policy decision on
  // a Stage reads.
  it("saves the size threshold in its one row, and saves it again over it", async () => {
    const { sizeThreshold } = DEFAULT_CONTEXT_POLICY_SETTINGS;

    await settings.changeSizeThreshold(sizeThreshold);
    await settings.changeSizeThreshold(sizeThreshold);

    expect(await settings.sizeThreshold()).toBe(sizeThreshold);
  });
});
