import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { DatabaseHealth } from "./database-health.js";
import { DATABASE, type Database } from "./database.js";

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("DatabaseModule", () => {
  it("runs on this run's migrated test database and reports it up", async () => {
    ({ app } = await startTestApplication({ database: true }));

    const { rows } = await app.get<Database>(DATABASE).execute<{
      name: string;
      migrated: boolean;
    }>(sql`select current_database() as name, to_regclass('drizzle.__drizzle_migrations') is not null as migrated`);

    expect(rows).toEqual([{ name: expect.stringMatching(/_test_[0-9a-f]{8}$/), migrated: true }]);
    expect(await app.get(DatabaseHealth).state()).toBe("up");
  });
});
