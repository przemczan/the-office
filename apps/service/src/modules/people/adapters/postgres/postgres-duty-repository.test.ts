import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DutyAssignments } from "../../domain/duties.js";
import { PostgresDutyRepository } from "./postgres-duty-repository.js";

let app: INestApplication;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
});

afterAll(async () => {
  await app.close();
});

/** Rolled back: the stored duties decide who every file's sessions consult, so none stays set. */
class RolledBack extends Error {}

/** Runs `use` on a repository inside a transaction that is rolled back after it. */
async function rolledBack(
  use: (duties: PostgresDutyRepository, database: Database) => Promise<void>,
): Promise<void> {
  await app
    .get<Database>(DATABASE)
    .transaction(async (transaction) => {
      // The transaction offers every query the repository makes.
      const database = transaction as unknown as Database;
      await use(new PostgresDutyRepository(database), database);
      throw new RolledBack();
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error;
    });
}

describe("PostgresDutyRepository", () => {
  const at = new Date("2026-11-14T09:00:00.000Z");

  it("has no duty set as migrated, then keeps a Role, none, and a change over either", async () => {
    const seen: DutyAssignments[] = [];

    await rolledBack(async (duties) => {
      seen.push(await duties.assignments());
      await duties.assign("plans", "lead", at);
      await duties.assign("reviews", null, at);
      seen.push(await duties.assignments());
      await duties.assign("plans", null, at);
      await duties.assign("reviews", "lead", at);
      seen.push(await duties.assignments());
    });

    expect(seen).toEqual([{}, { plans: "lead", reviews: null }, { plans: null, reviews: "lead" }]);
  });

  it("saves several duties at once, or none of them when one can't be saved", async () => {
    const seen: DutyAssignments[] = [];
    let failed = false;

    await rolledBack(async (duties, database) => {
      await duties.assignAll(
        [
          { duty: "implements", roleKey: "builder" },
          { duty: "reviews", roleKey: "checker" },
        ],
        at,
      );
      seen.push(await duties.assignments());
      // Naming one duty twice fails the one statement, in a savepoint so the test goes on.
      await database
        .transaction((savepoint) =>
          new PostgresDutyRepository(savepoint as unknown as Database).assignAll(
            [
              { duty: "plans", roleKey: "lead" },
              { duty: "implements", roleKey: null },
              { duty: "implements", roleKey: "lead" },
            ],
            at,
          ),
        )
        .catch(() => {
          failed = true;
        });
      seen.push(await duties.assignments());
    });

    expect(failed).toBe(true);
    expect(seen).toEqual([
      { implements: "builder", reviews: "checker" },
      { implements: "builder", reviews: "checker" },
    ]);
  });
});
