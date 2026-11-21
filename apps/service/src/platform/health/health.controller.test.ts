import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { DatabaseHealth, type DatabaseState } from "../database/database-health.js";
import { OfficeTestInstance } from "../test-instance/office-test-instance.js";
import { HealthController } from "./health.controller.js";

let app: INestApplication | undefined;

async function serveHealth(databaseState: DatabaseState, testInstance = false): Promise<string> {
  const started = await startTestApplication({
    controllers: [HealthController],
    providers: [
      { provide: DatabaseHealth, useValue: { state: async () => databaseState } },
      { provide: OfficeTestInstance, useValue: new OfficeTestInstance(testInstance) },
    ],
  });
  app = started.app;
  return started.url;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/health", () => {
  it.each<DatabaseState>(["up", "down"])("reports the database as %s", async (databaseState) => {
    const url = await serveHealth(databaseState);

    const response = await fetch(`${url}/api/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ database: databaseState, testInstance: false });
  });

  it("says when the service is a test instance of The Office (OFFICE_TEST_INSTANCE)", async () => {
    const url = await serveHealth("up", true);

    const response = await fetch(`${url}/api/health`);

    expect(await response.json()).toEqual({ database: "up", testInstance: true });
  });
});
