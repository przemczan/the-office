import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseHealth, type DatabaseState } from "../database/database-health.js";
import { configureHttp } from "../http/configure-http.js";
import { HealthController } from "./health.controller.js";

let app: INestApplication | undefined;

async function serveHealth(databaseState: DatabaseState): Promise<string> {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DatabaseHealth, useValue: { state: async () => databaseState } }],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  return app.getUrl();
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
    expect(await response.json()).toEqual({ database: databaseState });
  });
});
