import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
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

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What `read` found, with its changes undone: every test file shares the database. */
async function rolledBack<Result>(read: (transaction: Transaction) => Promise<Result>) {
  let result: Result | undefined;
  await database
    .transaction(async (transaction) => {
      result = await read(transaction);
      transaction.rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof TransactionRollbackError)) throw error;
    });
  if (result === undefined) throw new Error("Nothing was read.");
  return result;
}

/** Capabilities as a card had them before the Run environment capability. */
const BEFORE = { sharedMemory: true, chat: true, consultant: false };

/** A version of the Role's card, far past any a test saves, holding only its capabilities. */
async function aCardVersionBefore(transaction: Transaction, roleKey: string): Promise<void> {
  await transaction.execute(
    sql`INSERT INTO "roles" ("key", "card_version", "hired_at") VALUES (${roleKey}, 1, now()) ON CONFLICT DO NOTHING`,
  );
  await transaction.execute(
    sql`INSERT INTO "role_card_versions" ("role_key", "version", "card", "changes", "saved_at")
      VALUES (${roleKey}, 9999, ${JSON.stringify({ capabilities: BEFORE })}::jsonb, '[]'::jsonb, now())`,
  );
}

async function aProposal(transaction: Transaction, threadId: string, change: object) {
  const id = randomUUID();
  await transaction.execute(
    sql`INSERT INTO "proposals" ("id", "thread_id", "drafted_by", "drafted_at", "change", "status")
      VALUES (${id}, ${threadId}, 'cto', now(), ${JSON.stringify(change)}::jsonb, 'open')`,
  );
  return id;
}

describe("migration 0111", () => {
  it("gives the developer and devops cards Run environment on, every other card off, in stored cards and Proposals", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0111_run_environment_capability.sql", import.meta.url),
      "utf8",
    );
    const other = `role-${randomUUID()}`;
    const threadId = randomUUID();

    const after = await rolledBack(async (transaction) => {
      for (const roleKey of ["developer", "devops", other]) {
        await aCardVersionBefore(transaction, roleKey);
      }
      await transaction.execute(
        sql`INSERT INTO "threads" ("id", "home_kind", "home_id", "role_key", "state", "tokens", "started_at")
          VALUES (${threadId}, 'office', 'office', 'cto', 'idle', '{}'::jsonb, now())`,
      );
      const hire = await aProposal(transaction, threadId, {
        kind: "hire",
        card: { capabilities: BEFORE },
        skills: [],
      });
      const changeDeveloper = await aProposal(transaction, threadId, {
        kind: "change",
        roleKey: "developer",
        from: { capabilities: BEFORE },
        to: { capabilities: { ...BEFORE, chat: false } },
      });
      const changeOther = await aProposal(transaction, threadId, {
        kind: "change",
        roleKey: other,
        from: { capabilities: BEFORE },
        to: { taskLimit: 2 },
      });
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const cards = await transaction.execute<{ role_key: string; card: object }>(
        sql`SELECT "role_key", "card" FROM "role_card_versions" WHERE "version" = 9999`,
      );
      const proposals = await transaction.execute<{ id: string; change: object }>(
        sql`SELECT "id", "change" FROM "proposals" WHERE "thread_id" = ${threadId}`,
      );
      const changeOf = (id: string) => proposals.rows.find((row) => row.id === id)?.change;
      return {
        cards: new Map(cards.rows.map((row) => [row.role_key, row.card])),
        hire: changeOf(hire),
        changeDeveloper: changeOf(changeDeveloper),
        changeOther: changeOf(changeOther),
      };
    });

    expect(after.cards.get("developer")).toEqual({
      capabilities: { ...BEFORE, runEnvironment: true },
    });
    expect(after.cards.get("devops")).toEqual({
      capabilities: { ...BEFORE, runEnvironment: true },
    });
    expect(after.cards.get(other)).toEqual({ capabilities: { ...BEFORE, runEnvironment: false } });
    expect(after.hire).toMatchObject({ card: { capabilities: { runEnvironment: false } } });
    expect(after.changeDeveloper).toMatchObject({
      from: { capabilities: { runEnvironment: true } },
      to: { capabilities: { chat: false, runEnvironment: true } },
    });
    expect(after.changeOther).toEqual({
      kind: "change",
      roleKey: other,
      from: { capabilities: { ...BEFORE, runEnvironment: false } },
      to: { taskLimit: 2 },
    });
  });
});
