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

/** A Project's engine levels as the release before kept them. */
interface EarlierLevels {
  readonly projectDefault: { readonly engineId: string; readonly model: string } | null;
  readonly useForEveryRole: boolean;
  readonly roleOverrides: readonly {
    readonly roleKey: string;
    readonly engineId: string;
    readonly model: string;
  }[];
}

type EngineRow = {
  readonly engine_default_type: string | null;
  readonly engine_default_engine_id: string | null;
  readonly engine_force: unknown;
  readonly engine_people: unknown;
};

/**
 * The Project's new engine columns after migration 0203 runs with two engines listed, Claude Code
 * (`claude-code`, on Sonnet) and Codex (`codex`, on gpt-5.5), and the people `developer`, `reviewer`
 * (with an Office-wide Role override on Codex), `cto` (with one on a removed engine) and `writer`
 * (let go); its people's settings are only theirs, leaving out every other person the database has.
 */
async function migrated(levels: EarlierLevels): Promise<EngineRow | undefined> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0203_project_engine.sql", import.meta.url),
    "utf8",
  );
  const id = `project-${randomUUID()}`;
  return rolledBackMigration(database, async (transaction) => {
    await transaction.execute(
      sql`ALTER TABLE "projects" DROP CONSTRAINT "projects_engine_default",
        DROP COLUMN "engine_default_type", DROP COLUMN "engine_default_engine_id",
        DROP COLUMN "engine_force", DROP COLUMN "engine_people"`,
    );
    await transaction.execute(sql`DELETE FROM "engine_settings"`);
    await transaction.execute(sql`DELETE FROM "engines"`);
    await transaction.execute(
      sql`INSERT INTO "engines" ("id", "position", "name", "kind", "default_model")
        VALUES ('claude-code', 0, 'Claude Code', 'claude-code', 'claude-sonnet-5-5'),
          ('codex', 1, 'Codex', 'codex', 'gpt-5.5')`,
    );
    const people = [
      { key: "developer", letGo: false, roleOverride: null },
      { key: "reviewer", letGo: false, roleOverride: { engineId: "codex", model: "gpt-5.5" } },
      { key: "cto", letGo: false, roleOverride: { engineId: "gone", model: "gone-model" } },
      { key: "writer", letGo: true, roleOverride: null },
    ];
    for (const { key, letGo, roleOverride } of people) {
      await transaction.execute(
        sql`INSERT INTO "roles" ("key", "card_version", "hired_at", "let_go_at")
          VALUES (${key}, 9999, now(), ${letGo ? new Date() : null})
          ON CONFLICT ("key") DO UPDATE SET "card_version" = 9999,
            "let_go_at" = ${letGo ? new Date() : null}`,
      );
      await transaction.execute(
        sql`INSERT INTO "role_card_versions" ("role_key", "version", "card", "changes", "saved_at")
          VALUES (${key}, 9999, ${JSON.stringify({ name: key, roleOverride })}::jsonb, '[]'::jsonb,
            now())`,
      );
    }
    await transaction.execute(
      sql`INSERT INTO "projects" ("id", "name", "path", "base_branch", "mark_label",
          "mark_colour", "install_command", "publishing_mode", "default_pipeline",
          "use_project_skills", "added_at", "project_default_engine_id", "project_default_model",
          "use_for_every_role", "role_overrides")
        VALUES (${id}, ${id}, ${`/work/${id}`}, 'main', 'MI', 'teal', 'npm ci',
          'push-and-pull-request', 'full', true, now(), ${levels.projectDefault?.engineId ?? null},
          ${levels.projectDefault?.model ?? null}, ${levels.useForEveryRole},
          ${JSON.stringify(levels.roleOverrides)}::jsonb)`,
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      await transaction.execute(sql.raw(statement));
    }
    const { rows } = await transaction.execute<EngineRow>(
      sql`SELECT "engine_default_type", "engine_default_engine_id", "engine_force",
          "engine_people", "project_default_model", "use_for_every_role", "role_overrides"
        FROM "projects" WHERE "id" = ${id}`,
    );
    const row = rows[0];
    const keys = new Set(people.map(({ key }) => key));
    return (
      row && {
        ...row,
        engine_people: (row.engine_people as { roleKey: string }[]).filter(({ roleKey }) =>
          keys.has(roleKey),
        ),
      }
    );
  });
}

const OPUS = { engineId: "claude-code", model: "claude-opus-5-5" };

describe("migration 0203", () => {
  it("moves the Project default to its engine's type and that engine, and 'Use for every Role' on to the force with its model", async () => {
    const row = await migrated({ projectDefault: OPUS, useForEveryRole: true, roleOverrides: [] });

    expect(row).toMatchObject({
      engine_default_type: "claude-code",
      engine_default_engine_id: "claude-code",
      engine_force: { model: "claude-opus-5-5", effort: null },
      engine_people: [],
      // The earlier levels stay for a rollback.
      project_default_model: "claude-opus-5-5",
      use_for_every_role: true,
    });
  });

  it("with the force off, gives the default's model to each person, let go or not, with no Role override on a listed engine", async () => {
    const row = await migrated({ projectDefault: OPUS, useForEveryRole: false, roleOverrides: [] });

    const opus = { "claude-code": { model: "claude-opus-5-5", effort: null } };
    expect(row).toMatchObject({ engine_default_type: "claude-code", engine_force: null });
    // The reviewer keeps their Office-wide Role override; the CTO's override named a removed
    // engine, so they ran on the Project default's model; the writer, let go, gets it too.
    expect(row?.engine_people).toEqual([
      { roleKey: "cto", engineSettings: opus },
      { roleKey: "developer", engineSettings: opus },
      { roleKey: "writer", engineSettings: opus },
    ]);
  });

  it("gives nobody the default's model when it is its engine's default model", async () => {
    const row = await migrated({
      projectDefault: { engineId: "claude-code", model: "claude-sonnet-5-5" },
      useForEveryRole: false,
      roleOverrides: [],
    });

    expect(row).toMatchObject({ engine_default_engine_id: "claude-code", engine_people: [] });
  });

  it("moves a Project's Role override on a listed engine to that person's setting on its type, and drops one on a removed engine", async () => {
    const row = await migrated({
      projectDefault: OPUS,
      useForEveryRole: true,
      roleOverrides: [
        { roleKey: "developer", engineId: "codex", model: "gpt-5.5-mini" },
        { roleKey: "cto", engineId: "gone", model: "gone-model" },
      ],
    });

    expect(row).toMatchObject({
      engine_force: { model: "claude-opus-5-5", effort: null },
      engine_people: [
        {
          roleKey: "developer",
          engineSettings: { codex: { model: "gpt-5.5-mini", effort: null } },
        },
      ],
    });
  });

  it("with the force off, keeps a Project's Role override in place of the default's model for that person", async () => {
    const row = await migrated({
      projectDefault: OPUS,
      useForEveryRole: false,
      roleOverrides: [{ roleKey: "developer", engineId: "codex", model: "gpt-5.5-mini" }],
    });

    expect(row?.engine_people).toEqual([
      { roleKey: "developer", engineSettings: { codex: { model: "gpt-5.5-mini", effort: null } } },
      {
        roleKey: "cto",
        engineSettings: { "claude-code": { model: "claude-opus-5-5", effort: null } },
      },
      {
        roleKey: "writer",
        engineSettings: { "claude-code": { model: "claude-opus-5-5", effort: null } },
      },
    ]);
  });

  it("drops a Project default on an engine no longer listed, with its force", async () => {
    const row = await migrated({
      projectDefault: { engineId: "gone", model: "gone-model" },
      useForEveryRole: true,
      roleOverrides: [],
    });

    expect(row).toMatchObject({
      engine_default_type: null,
      engine_default_engine_id: null,
      engine_force: null,
      engine_people: [],
    });
  });

  it("leaves a Project with no default with none", async () => {
    const row = await migrated({ projectDefault: null, useForEveryRole: false, roleOverrides: [] });

    expect(row).toMatchObject({
      engine_default_type: null,
      engine_default_engine_id: null,
      engine_force: null,
      engine_people: [],
    });
  });
});
