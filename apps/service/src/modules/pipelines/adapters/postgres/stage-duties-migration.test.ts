import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { builtInPipelinesBeforeFlows } from "../../domain/built-in-pipelines-before-flows.fixtures.js";
import { builtInStageTemplates as allBuiltInStageTemplates } from "../../domain/built-in-stage-templates.js";
import type { Stage } from "../../domain/stage.js";

/** The built-ins the migration knew: the later ones were seeded naming their duties already. */
const LATER_BUILT_INS: ReadonlySet<string> = new Set([
  "resolve-conflicts",
  "test",
  "set-up-test-targets",
  "resolve",
]);
/** The built-ins as kept when the migration ran: lists of Stages, a Script Stage publishing. */
const builtInPipelines = builtInPipelinesBeforeFlows.filter(({ id }) => !LATER_BUILT_INS.has(id));
const builtInStageTemplates = allBuiltInStageTemplates.filter(({ id }) => !LATER_BUILT_INS.has(id));

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** The Roles the built-in Agent Stages named before they named duties. */
const ROLE_OF_DUTY: Readonly<Record<string, string>> = {
  implements: "developer",
  "onboards-projects": "devops",
};

/** `stage` as kept before the migration: naming its duty's default Role instead. */
function namingItsRole(stage: Stage): Stage {
  if (stage.kind !== "agent" || stage.duty === undefined) return stage;
  const { duty, ...rest } = stage;
  return { ...rest, role: ROLE_OF_DUTY[duty] ?? duty };
}

const full = builtInPipelines.find(({ id }) => id === "full");
if (!full) throw new Error("The Full Pipeline is built in.");

/** The Full Pipeline's Stages as kept before, its Review & fix Stage given the Reviewer. */
const FULL_BEFORE = full.stages.map(namingItsRole);
const FULL_REVIEWED_BY_THE_REVIEWER = FULL_BEFORE.map((stage) =>
  stage.key === "review-and-fix" ? { ...stage, role: "reviewer" } : stage,
);

async function stagesOf(transaction: Transaction, query: ReturnType<typeof sql>) {
  const { rows } = await transaction.execute<{ stages: Stage[] }>(query);
  return rows[0]?.stages;
}

async function keepAsBefore(transaction: Transaction): Promise<void> {
  for (const { id, stages } of builtInPipelines) {
    await transaction.execute(
      sql`UPDATE "pipelines" SET "stages" = ${JSON.stringify(stages.map(namingItsRole))}::jsonb WHERE "id" = ${id}`,
    );
  }
  for (const { id, stage } of builtInStageTemplates) {
    await transaction.execute(
      sql`UPDATE "stage_templates" SET "stage" = ${JSON.stringify(namingItsRole(stage))}::jsonb WHERE "id" = ${id}`,
    );
  }
}

async function aUserPipeline(transaction: Transaction): Promise<string> {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "pipelines" ("id", "name", "description", "stages")
      VALUES (${id}, ${`Mine ${id}`}, '', ${JSON.stringify(FULL_BEFORE)}::jsonb)`,
  );
  return id;
}

async function aTaskOnFull(transaction: Transaction): Promise<string> {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "tasks" ("id", "title", "project_id", "state", "priority", "order_key", "plan", "pipeline_id", "created_by", "created_at")
      VALUES (${id}, 'Fix the export', 'admin-panel', 'ready', 'normal', ${`z${id}`}, '', 'full', '{"kind":"office"}'::jsonb, now())`,
  );
  await transaction.execute(
    sql`INSERT INTO "task_stages" ("task_id", "pipeline_id", "stages", "made_at")
      VALUES (${id}, 'full', ${JSON.stringify(FULL_BEFORE)}::jsonb, now())`,
  );
  return id;
}

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0151_stage_duties.sql", import.meta.url),
    "utf8",
  );
  // The column exists already: only the data statements run again.
  for (const statement of migration.split("--> statement-breakpoint").slice(1)) {
    await transaction.execute(sql.raw(statement));
  }
}

describe("migration 0151", () => {
  it("moves the built-in Pipelines and Stage templates from Roles to duties", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      await keepAsBefore(transaction);
      await applyMigration(transaction);
      const pipelines = await Promise.all(
        builtInPipelines.map(({ id }) =>
          stagesOf(transaction, sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${id}`),
        ),
      );
      const { rows: templates } = await transaction.execute<{ id: string; stage: Stage }>(
        sql`SELECT "id", "stage" FROM "stage_templates"`,
      );
      return { pipelines, templates: new Map(templates.map(({ id, stage }) => [id, stage])) };
    });

    expect(after.pipelines).toEqual(builtInPipelines.map(({ stages }) => stages));
    for (const { id, stage } of builtInStageTemplates) {
      expect(after.templates.get(id)).toEqual(stage);
    }
  });

  it("leaves a Stage the user gave another Role, the user's own Pipelines and Tasks' own Stages", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.execute(
        sql`UPDATE "pipelines" SET "stages" = ${JSON.stringify(FULL_REVIEWED_BY_THE_REVIEWER)}::jsonb WHERE "id" = 'full'`,
      );
      const mine = await aUserPipeline(transaction);
      const task = await aTaskOnFull(transaction);
      await applyMigration(transaction);
      const fullStages = await stagesOf(
        transaction,
        sql`SELECT "stages" FROM "pipelines" WHERE "id" = 'full'`,
      );
      return {
        reviewAndFix: fullStages?.find(({ key }) => key === "review-and-fix"),
        implement: fullStages?.find(({ key }) => key === "implement"),
        mine: await stagesOf(
          transaction,
          sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${mine}`,
        ),
        task: await stagesOf(
          transaction,
          sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${task}`,
        ),
      };
    });

    expect(after.reviewAndFix).toMatchObject({ role: "reviewer" });
    expect(after.reviewAndFix).not.toHaveProperty("duty");
    expect(after.implement).toMatchObject({ duty: "implements" });
    expect(after.implement).not.toHaveProperty("role");
    expect(after.mine).toEqual(FULL_BEFORE);
    expect(after.task).toEqual(FULL_BEFORE);
  });
});
