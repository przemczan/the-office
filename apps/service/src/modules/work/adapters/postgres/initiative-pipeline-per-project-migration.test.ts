import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { rolledBackMigration } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Initiative } from "../../domain/initiative.js";
import { anInitiative, aTask } from "../../domain/work.fixtures.js";
import { initiatives, tasks } from "./work.schema.js";
import { toInitiativeRow, toTaskRow, type Transaction } from "./work-rows.js";

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

/** The one column as it was before migration 0131, every Initiative's Pipelines forgotten. */
async function columnBefore(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`ALTER TABLE "initiatives" DROP COLUMN "pipelines"`);
  await transaction.execute(sql`ALTER TABLE "initiatives" ADD COLUMN "pipeline_id" text`);
}

/** An Initiative of its own, from no Idea, as the backfill reads only its state and Tasks. */
function initiative(state: Initiative["state"]): Initiative {
  return anInitiative({
    id: randomUUID(),
    name: `Sync ${randomUUID()}`,
    state,
    originIdeaId: undefined,
    pipelines: [],
  });
}

/** A Task of the Initiative in the Project, added at the minute given. */
function taskIn(owner: Initiative, projectId: string, minute: number) {
  return aTask({
    id: randomUUID(),
    projectId,
    initiativeId: owner.id,
    order: `zz${randomUUID()}`,
    createdAt: new Date(`2026-11-12T10:${String(minute).padStart(2, "0")}:00.000Z`),
  });
}

describe("migration 0131", () => {
  it("gives every Project an Initiative spans the Pipeline it had, in the order its Tasks came", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0131_initiative_pipeline_per_project.sql", import.meta.url),
      "utf8",
    );
    const [web, api] = [`project-${randomUUID()}`, `project-${randomUUID()}`];
    const onFull = initiative("active");
    const confirmedOnNone = initiative("active");
    const shapingOnFull = initiative("shaping");
    const shapingOnNone = initiative("shaping");
    const all = [onFull, confirmedOnNone, shapingOnFull, shapingOnNone];
    const spanningTwo = all.flatMap((owner) => [
      taskIn(owner, api, 1),
      taskIn(owner, web, 2),
      taskIn(owner, api, 3),
    ]);

    const after = await rolledBackMigration(database, async (transaction) => {
      await transaction.insert(initiatives).values(all.map(toInitiativeRow));
      await transaction.insert(tasks).values(spanningTwo.map(toTaskRow));
      await columnBefore(transaction);
      await transaction.execute(
        sql`UPDATE "initiatives" SET "pipeline_id" = 'full' WHERE "id" IN (${onFull.id}, ${shapingOnFull.id})`,
      );
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      return transaction
        .select({ id: initiatives.id, pipelines: initiatives.pipelines })
        .from(initiatives)
        .where(
          inArray(
            initiatives.id,
            all.map(({ id }) => id),
          ),
        );
    });

    const pipelinesOf = (owner: Initiative) => after.find(({ id }) => id === owner.id)?.pipelines;
    expect(pipelinesOf(onFull)).toEqual([
      { projectId: api, pipelineId: "full" },
      { projectId: web, pipelineId: "full" },
    ]);
    expect(pipelinesOf(confirmedOnNone)).toEqual([
      { projectId: api, pipelineId: null },
      { projectId: web, pipelineId: null },
    ]);
    expect(pipelinesOf(shapingOnFull)).toEqual([
      { projectId: api, pipelineId: "full" },
      { projectId: web, pipelineId: "full" },
    ]);
    expect(pipelinesOf(shapingOnNone)).toEqual([]);
  });
});
