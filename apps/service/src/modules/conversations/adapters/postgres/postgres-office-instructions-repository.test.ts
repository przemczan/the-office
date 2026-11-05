import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { versionAfter, type OfficeInstructionsVersion } from "../../domain/office-instructions.js";
import { PostgresOfficeInstructionsRepository } from "./postgres-office-instructions-repository.js";

const ROLLED_BACK = new Error("Rolled back");

let app: INestApplication;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true }));
  database = app.get<Database>(DATABASE);
});

afterAll(async () => {
  await app.close();
});

/** Every test file shares the table, which each session start reads, so nothing here is kept. */
async function rolledBack(
  work: (repository: PostgresOfficeInstructionsRepository) => Promise<void>,
): Promise<void> {
  await expect(
    database.transaction(async (transaction) => {
      await work(new PostgresOfficeInstructionsRepository(transaction as unknown as Database));
      throw ROLLED_BACK;
    }),
  ).rejects.toBe(ROLLED_BACK);
}

function save(
  repository: PostgresOfficeInstructionsRepository,
  text: string,
): Promise<OfficeInstructionsVersion> {
  return repository.update((current) => versionAfter(current, text), new Date());
}

describe("PostgresOfficeInstructionsRepository", () => {
  it("saves each changed text as the next version and keeps the ones before", async () => {
    await rolledBack(async (repository) => {
      const { version: before } = await repository.current();

      await save(repository, "Write in plain words.");
      await save(repository, "Keep it short.");

      expect(await repository.current()).toEqual({ version: before + 2, text: "Keep it short." });
      expect(await repository.version(before + 1)).toEqual({
        version: before + 1,
        text: "Write in plain words.",
      });
    });
  });

  it("saves nothing when the change makes no version, and answers the current one", async () => {
    await rolledBack(async (repository) => {
      const saved = await save(repository, "Write in plain words.");

      expect(await save(repository, "Write in plain words.")).toEqual(saved);
      expect(await repository.current()).toEqual(saved);
    });
  });

  it("answers nothing for a version never saved", async () => {
    await rolledBack(async (repository) => {
      const { version } = await repository.current();

      expect(await repository.version(version + 1)).toBeUndefined();
    });
  });
});
