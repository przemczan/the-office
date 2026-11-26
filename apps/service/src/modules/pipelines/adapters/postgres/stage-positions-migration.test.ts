import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { builtInPipelines } from "../../domain/built-in-pipelines.js";
import { asFlow, isRouteBack } from "../../domain/flow.js";
import { positionsFromPlaces } from "../../domain/positions.js";
import { ENDED_FAILED, type StagePlace } from "../../domain/route.js";
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

const TABLES = ["pipelines", "project_pipelines", "task_stages"] as const;
type Table = (typeof TABLES)[number];

const implement = agentStage();
const tests = scriptStage();
const review = agentStage({ key: "review", name: "Review" });
const look = gate({ key: "look", name: "Look" });

/**
 * A flow from before positions, listed out of the Pipeline's order its places give: Implement,
 * Tests, Review under Tests, then Look. Tests lists its two routes, so row 0 is 82 + 2 × 22 tall,
 * and Review, on row 1, stands that and 22 below the top.
 */
const OUT_OF_ORDER: readonly Stage[] = [
  { ...look, routes: [{ to: null, condition: null, limit: null }], place: { column: 2, row: 0 } },
  {
    ...review,
    routes: [{ to: "look", condition: null, limit: null }],
    place: { column: 1, row: 1 },
  },
  {
    ...tests,
    routes: [
      { to: "implement", condition: ENDED_FAILED, limit: 3 },
      { to: "review", condition: null, limit: null },
    ],
    place: { column: 1, row: 0 },
  },
  {
    ...implement,
    routes: [{ to: "tests", condition: null, limit: null }],
    place: { column: 0, row: 0 },
  },
];

/**
 * A flow whose one route back was kept before routes had limits: it reads with the default limit
 * for a route back, so its card lists the route (82 + 22), and the row under it stands lower.
 */
const KEPT_WITHOUT_A_LIMIT: readonly Stage[] = [
  { ...implement, routes: [{ to: "tests", condition: null }], place: { column: 0, row: 0 } },
  { ...tests, routes: [{ to: "implement", condition: null }], place: { column: 1, row: 0 } },
  { ...look, routes: [{ to: null, condition: null }], place: { column: 0, row: 1 } },
] as unknown as readonly Stage[];

/** A list saved by this release: positions given, and places for the previous release. */
const POSITIONED: readonly Stage[] = [
  {
    ...tests,
    routes: [{ to: "implement", condition: null, limit: null }],
    position: { x: 900, y: -40 },
    place: { column: 0, row: 0 },
  },
  {
    ...implement,
    routes: [{ to: null, condition: null, limit: null }],
    position: { x: 0, y: 300 },
    place: { column: 1, row: 0 },
  },
];

async function aRow(transaction: Transaction, table: Table, stages: readonly Stage[]) {
  const id = randomUUID();
  const json = JSON.stringify(stages);
  if (table === "pipelines") {
    await transaction.execute(
      sql`INSERT INTO "pipelines" ("id", "name", "description", "stages")
        VALUES (${id}, ${`Mine ${id}`}, '', ${json}::jsonb)`,
    );
  } else if (table === "project_pipelines") {
    await transaction.execute(
      sql`INSERT INTO "project_pipelines" ("id", "project_id", "name", "description", "stages")
        VALUES (${id}, ${randomUUID()}, ${`Mine ${id}`}, '', ${json}::jsonb)`,
    );
  } else {
    await transaction.execute(
      sql`INSERT INTO "tasks" ("id", "title", "project_id", "state", "priority", "order_key", "plan", "pipeline_id", "created_by", "created_at")
        VALUES (${id}, 'Fix the export', 'admin-panel', 'ready', 'normal', ${`z${id}`}, '', 'full', '{"kind":"office"}'::jsonb, now())`,
    );
    await transaction.execute(
      sql`INSERT INTO "task_stages" ("task_id", "pipeline_id", "stages", "made_at")
        VALUES (${id}, 'full', ${json}::jsonb, now())`,
    );
  }
  return id;
}

async function stagesOf(transaction: Transaction, table: Table, id: string): Promise<Stage[]> {
  const { rows } = await transaction.execute<{ stages: Stage[] }>(
    table === "task_stages"
      ? sql`SELECT "stages" FROM "task_stages" WHERE "task_id" = ${id}`
      : sql`SELECT "stages" FROM ${sql.identifier(table)} WHERE "id" = ${id}`,
  );
  return rows[0]?.stages ?? [];
}

/** Migration 0225's updates; its columns are on the shared database already. */
async function applyMigration(transaction: Transaction): Promise<void> {
  const migration = await readFile(
    new URL("../../../../../drizzle/0225_stage_positions.sql", import.meta.url),
    "utf8",
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (!statement.includes("ALTER TABLE")) await transaction.execute(sql.raw(statement));
  }
}

/** Each list in every table, migrated, read back in the order given. */
async function migrated(lists: readonly (readonly Stage[])[]) {
  return rolledBackMigration(database, async (transaction) => {
    const made: { table: Table; id: string }[] = [];
    for (const stages of lists) {
      for (const table of TABLES) made.push({ table, id: await aRow(transaction, table, stages) });
    }
    await applyMigration(transaction);
    // Twice changes nothing more.
    await applyMigration(transaction);
    const read: { table: Table; stages: Stage[] }[] = [];
    for (const { table, id } of made) {
      read.push({ table, stages: await stagesOf(transaction, table, id) });
    }
    return lists.map((_, index) => read.slice(index * TABLES.length, (index + 1) * TABLES.length));
  });
}

function placeOf(stage: Stage): StagePlace {
  return stage.place ?? { column: 0, row: 0 };
}

function byPlace(stages: readonly Stage[]): Stage[] {
  return stages.toSorted(
    (one, other) =>
      placeOf(one).column - placeOf(other).column || placeOf(one).row - placeOf(other).row,
  );
}

/** Each route's Stage and where it leads, and whether it leads back, among `stages` in their order. */
function routesBack(stages: readonly Stage[]): string[] {
  return stages.flatMap(({ key, routes = [] }) =>
    routes.map(({ to }) => `${key} → ${to ?? "End"}: ${isRouteBack(stages, key, to)}`),
  );
}

describe("migration 0225", () => {
  it("sorts every Pipeline's, Project Pipeline's and Task's Stages by their places and gives each the position of its place, keeping the place", async () => {
    const [outOfOrder] = await migrated([OUT_OF_ORDER]);

    const expected = [
      { ...OUT_OF_ORDER[3], position: { x: 0, y: 0 } },
      { ...OUT_OF_ORDER[2], position: { x: 308, y: 0 } },
      { ...OUT_OF_ORDER[1], position: { x: 308, y: 126 + 22 } },
      { ...OUT_OF_ORDER[0], position: { x: 616, y: 0 } },
    ];
    expect(outOfOrder).toEqual(TABLES.map((table) => ({ table, stages: expected })));
  });

  it("agrees with positionsFromPlaces and with how asFlow reads the list before it", async () => {
    const [outOfOrder, keptWithoutALimit] = await migrated([OUT_OF_ORDER, KEPT_WITHOUT_A_LIMIT]);

    for (const [before, after] of [
      [OUT_OF_ORDER, outOfOrder],
      [KEPT_WITHOUT_A_LIMIT, keptWithoutALimit],
    ] as const) {
      const readBefore = asFlow(before);
      const sorted = byPlace(before);
      // Its routes as read, each with its limit, by which a card lists them.
      const limited = asFlow(sorted);
      const fromPlaces = positionsFromPlaces(
        sorted.map((stage, index) => ({
          place: stage.place ?? { column: index, row: 0 },
          routes: limited[index]?.routes ?? [],
        })),
      );
      for (const { table, stages } of after ?? []) {
        expect({ table, positions: stages.map(({ position }) => position) }).toEqual({
          table,
          positions: fromPlaces,
        });
        expect({ table, read: asFlow(stages) }).toEqual({ table, read: readBefore });
      }
    }
  });

  it("counts a route back kept without a limit as listed, as it reads with its default limit", async () => {
    const [keptWithoutALimit] = await migrated([KEPT_WITHOUT_A_LIMIT]);

    for (const { stages } of keptWithoutALimit ?? []) {
      expect(stages.map(({ key, position }) => [key, position])).toEqual([
        ["implement", { x: 0, y: 0 }],
        ["look", { x: 0, y: 82 + 22 + 22 }],
        ["tests", { x: 308, y: 0 }],
      ]);
    }
  });

  it("leaves which routes lead back as they were", async () => {
    const [outOfOrder] = await migrated([OUT_OF_ORDER]);

    for (const { stages } of outOfOrder ?? []) {
      expect(routesBack(stages)).toEqual(routesBack(byPlace(OUT_OF_ORDER)));
      expect(routesBack(stages)).toContain("tests → implement: true");
    }
  });

  it("leaves a list that has positions as it is", async () => {
    const [positioned] = await migrated([POSITIONED]);

    expect(positioned).toEqual(TABLES.map((table) => ({ table, stages: POSITIONED })));
  });

  it("leaves a list asFlow still reshapes to be converted as it is read: a kept Script publish Stage or on-failure setting", async () => {
    const keptPublish: readonly Stage[] = [
      { ...implement, routes: [{ to: "publish", condition: null }], place: { column: 0, row: 0 } },
      {
        kind: "script",
        key: "publish",
        name: "Publish",
        command: "publish",
        optional: false,
        routes: [{ to: null, condition: null }],
        place: { column: 1, row: 0 },
      },
    ] as unknown as readonly Stage[];
    const keptOnFailure: readonly Stage[] = [
      { ...implement, routes: [{ to: "tests", condition: null }], place: { column: 0, row: 0 } },
      {
        ...tests,
        onFailure: { goBackTo: "implement", rounds: 2 },
        routes: [{ to: null, condition: null }],
        place: { column: 1, row: 0 },
      },
    ] as unknown as readonly Stage[];

    const [publish, onFailure] = await migrated([keptPublish, keptOnFailure]);

    expect(publish).toEqual(TABLES.map((table) => ({ table, stages: keptPublish })));
    expect(onFailure).toEqual(TABLES.map((table) => ({ table, stages: keptOnFailure })));
  });

  it("leaves the built-in Pipelines as their seeds keep them, read as the built-ins are", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      await applyMigration(transaction);
      const read = [];
      for (const { id } of builtInPipelines) {
        read.push({ id, stages: asFlow(await stagesOf(transaction, "pipelines", id)) });
      }
      return read;
    });

    expect(after).toEqual(builtInPipelines.map(({ id, stages }) => ({ id, stages })));
  });

  it("leaves the Stage templates as they are: a template keeps no routes or position", async () => {
    const after = await rolledBackMigration(database, async (transaction) => {
      const { rows: before } = await transaction.execute(
        sql`SELECT "id", "stage" FROM "stage_templates" ORDER BY "id"`,
      );
      await applyMigration(transaction);
      const { rows } = await transaction.execute(
        sql`SELECT "id", "stage" FROM "stage_templates" ORDER BY "id"`,
      );
      return { before, rows };
    });

    expect(after.rows).toEqual(after.before);
    expect(after.rows.some(({ stage }) => JSON.stringify(stage).includes('"position"'))).toBe(
      false,
    );
  });
});
