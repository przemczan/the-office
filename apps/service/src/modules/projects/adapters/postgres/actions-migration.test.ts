import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

describe("migration 0193", () => {
  it("adds the actions table only, leaving a Project added before it with none", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0195_actions.sql", import.meta.url),
      "utf8",
    );
    const id = `project-${randomUUID()}`;

    const counts = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(sql`DROP TABLE "actions"`);
      await transaction.execute(
        sql`INSERT INTO "projects" ("id", "name", "path", "base_branch", "mark_label",
            "mark_colour", "install_command", "publishing_mode", "default_pipeline",
            "use_project_skills", "run_environment", "added_at")
          VALUES (${id}, ${id}, ${`/work/${id}`}, 'main', 'MI', 'teal', 'npm ci',
            'push-and-pull-request', 'full', true, 'on', now())`,
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const before = await transaction.execute<{ count: string }>(
        sql`SELECT count(*) AS "count" FROM "actions" WHERE "project_id" = ${id}`,
      );
      await transaction.execute(
        sql`INSERT INTO "actions" ("project_id", "key", "position", "name", "kind", "settings",
            "leaves_the_workstation", "updated_at")
          VALUES (${id}, 'release', 0, 'Release', 'workflow', '{"file":"release.yml"}', true, now())`,
      );
      const { rows } = await transaction.execute<{ set_by: unknown }>(
        sql`SELECT "set_by" FROM "actions" WHERE "project_id" = ${id}`,
      );
      await transaction.execute(sql`DELETE FROM "projects" WHERE "id" = ${id}`);
      const after = await transaction.execute<{ count: string }>(
        sql`SELECT count(*) AS "count" FROM "actions" WHERE "project_id" = ${id}`,
      );
      return {
        before: Number(before.rows[0]?.count),
        setBy: rows[0]?.set_by,
        afterProjectGone: Number(after.rows[0]?.count),
      };
    });

    expect(counts).toEqual({ before: 0, setBy: {}, afterProjectGone: 0 });
  });
});
