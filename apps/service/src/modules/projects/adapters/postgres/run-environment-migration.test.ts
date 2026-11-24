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

describe("migration 0218", () => {
  it("turns a Project Not decided yet Off, keeps On and Off, and adds new ones Off", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0218_run_environment_on_or_off.sql", import.meta.url),
      "utf8",
    );
    const ids = {
      notDecided: `project-${randomUUID()}`,
      on: `project-${randomUUID()}`,
      off: `project-${randomUUID()}`,
      added: `project-${randomUUID()}`,
    };

    const rows = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(
        sql`ALTER TABLE "projects" ALTER COLUMN "run_environment" SET DEFAULT 'not-decided'`,
      );
      const insert = (id: string, runEnvironment: string) =>
        transaction.execute(
          sql`INSERT INTO "projects" ("id", "name", "path", "base_branch", "mark_label",
              "mark_colour", "install_command", "publishing_mode", "default_pipeline",
              "use_project_skills", "run_environment", "added_at")
            VALUES (${id}, ${id}, ${`/work/${id}`}, 'main', 'MI', 'teal', 'npm ci',
              'push-and-pull-request', 'full', true, ${runEnvironment}, now())`,
        );
      await insert(ids.notDecided, "not-decided");
      await insert(ids.on, "on");
      await insert(ids.off, "off");
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      await transaction.execute(
        sql`INSERT INTO "projects" ("id", "name", "path", "base_branch", "mark_label",
            "mark_colour", "install_command", "publishing_mode", "default_pipeline",
            "use_project_skills", "added_at")
          VALUES (${ids.added}, ${ids.added}, ${`/work/${ids.added}`}, 'main', 'MI', 'teal',
            'npm ci', 'push-and-pull-request', 'full', true, now())`,
      );
      const { rows: found } = await transaction.execute<{ id: string; run_environment: string }>(
        sql`SELECT "id", "run_environment" FROM "projects"
          WHERE "id" IN (${ids.notDecided}, ${ids.on}, ${ids.off}, ${ids.added})`,
      );
      return new Map(found.map((row) => [row.id, row.run_environment]));
    });

    expect(rows.get(ids.notDecided)).toBe("off");
    expect(rows.get(ids.on)).toBe("on");
    expect(rows.get(ids.off)).toBe("off");
    expect(rows.get(ids.added)).toBe("off");
  });
});
