import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { builtInPipelines } from "../../domain/built-in-pipelines.js";
import { straightLineFlow } from "../../domain/flow.js";
import type { Stage } from "../../domain/stage.js";
import { agentStage, gate, scriptStage } from "../../domain/stage.fixtures.js";

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

/** `stage` as kept before the migration: without routes or a place. */
function asAList({ routes: _routes, place: _place, ...stage }: Stage): Stage {
  return stage;
}

const implement = agentStage();
const review = agentStage({ key: "review", name: "Review", optional: true });
const tests = scriptStage();
const lint = scriptStage({ key: "lint", name: "Lint", command: "lint", optional: true });
const look = gate({ key: "look", name: "Look" });

/** The lists of Stages the migration converts, by what each shows. */
const LISTS: Readonly<Record<string, readonly Stage[]>> = {
  plain: [implement, tests, look],
  "an optional Stage in the middle": [implement, review, tests],
  "optional Stages one after another": [implement, review, lint, tests],
  "an optional last Stage": [implement, tests, review],
  "an optional first Stage": [review, implement, tests],
};

const ALREADY_A_FLOW: readonly Stage[] = [
  { ...implement, routes: [{ to: null, condition: null }], place: { column: 0, row: 1 } },
  { ...tests, routes: [{ to: "implement", condition: null }], place: { column: 3, row: 0 } },
];

async function stagesOf(transaction: Transaction, query: ReturnType<typeof sql>) {
  const { rows } = await transaction.execute<{ stages: Stage[] }>(query);
  return rows[0]?.stages;
}

async function aPipeline(transaction: Transaction, stages: readonly Stage[]): Promise<string> {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "pipelines" ("id", "name", "description", "stages")
      VALUES (${id}, ${`Mine ${id}`}, '', ${JSON.stringify(stages)}::jsonb)`,
  );
  return id;
}

async function aTask(transaction: Transaction, stages: readonly Stage[]): Promise<string> {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "tasks" ("id", "title", "project_id", "state", "priority", "order_key", "plan", "pipeline_id", "created_by", "created_at")
      VALUES (${id}, 'Fix the export', 'admin-panel', 'ready', 'normal', ${`z${id}`}, '', 'full', '{"kind":"office"}'::jsonb, now())`,
  );
  await transaction.execute(
    sql`INSERT INTO "task_stages" ("task_id", "pipeline_id", "stages", "made_at")
      VALUES (${id}, 'full', ${JSON.stringify(stages)}::jsonb, now())`,
  );
  return id;
}

async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0163_pipeline_flows.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    await transaction.execute(sql.raw(statement));
  }
}

describe("migration 0163", () => {
  it("draws every Pipeline's and Task's list of Stages as a straight line, keeping optional", async () => {
    const lists = Object.entries(LISTS);
    const after = await rolledBackMigration(database, async (transaction) => {
      for (const { id, stages } of builtInPipelines) {
        await transaction.execute(
          sql`UPDATE "pipelines" SET "stages" = ${JSON.stringify(stages.map(asAList))}::jsonb WHERE "id" = ${id}`,
        );
      }
      const made = [];
      for (const [, stages] of lists) {
        made.push({
          pipeline: await aPipeline(transaction, stages),
          task: await aTask(transaction, stages),
        });
      }
      await applyMigration(transaction);
      const builtIns = [];
      for (const { id } of builtInPipelines) {
        builtIns.push(
          await stagesOf(transaction, sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${id}`),
        );
      }
      const converted = [];
      for (const { pipeline, task } of made) {
        converted.push({
          pipeline: await stagesOf(
            transaction,
            sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${pipeline}`,
          ),
          task: await stagesOf(
            transaction,
            sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${task}`,
          ),
        });
      }
      return { builtIns, converted };
    });

    expect(after.builtIns).toEqual(
      builtInPipelines.map(({ stages }) => straightLineFlow(stages.map(asAList))),
    );
    lists.forEach(([shows, stages], index) => {
      const flow = straightLineFlow(stages);
      // Each paired with what it shows, so a failure names the list.
      expect({ shows, ...after.converted[index] }).toEqual({ shows, pipeline: flow, task: flow });
      expect({
        shows,
        optional: after.converted[index]?.pipeline?.map(({ optional }) => optional),
      }).toEqual({ shows, optional: stages.map(({ optional }) => optional) });
    });
  });

  it("leaves Stages that carry their routes already as they are", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      const pipeline = await aPipeline(transaction, ALREADY_A_FLOW);
      const task = await aTask(transaction, ALREADY_A_FLOW);
      await applyMigration(transaction);
      return {
        pipeline: await stagesOf(
          transaction,
          sql`SELECT "stages" FROM "pipelines" WHERE "id" = ${pipeline}`,
        ),
        task: await stagesOf(
          transaction,
          sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${task}`,
        ),
      };
    });

    expect(after).toEqual({ pipeline: ALREADY_A_FLOW, task: ALREADY_A_FLOW });
  });
});
