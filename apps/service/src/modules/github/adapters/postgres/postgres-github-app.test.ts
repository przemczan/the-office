import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { githubApp } from "./github.schema.js";
import { PostgresGitHubApp } from "./postgres-github-app.js";

let app: INestApplication;
let apps: PostgresGitHubApp;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, providers: [PostgresGitHubApp] }));
  apps = app.get(PostgresGitHubApp);
});

afterAll(async () => {
  await app.close();
});

describe("PostgresGitHubApp", () => {
  // Every test file shares the database, so the App kept before is put back.
  it("keeps one App, a later registration replacing it", async () => {
    const before = await apps.read();
    try {
      await apps.replace({ clientId: "Iv23liFirst", slug: "office-first", owner: "przemczan" });
      await apps.replace({ clientId: "Iv23liSecond", slug: "office-second", owner: "notnullsoft" });

      expect(await apps.read()).toEqual({
        clientId: "Iv23liSecond",
        slug: "office-second",
        owner: "notnullsoft",
      });
    } finally {
      if (before === undefined) await app.get<Database>(DATABASE).delete(githubApp);
      else await apps.replace(before);
    }
  });
});
