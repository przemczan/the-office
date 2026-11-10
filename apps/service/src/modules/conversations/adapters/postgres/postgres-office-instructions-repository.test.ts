import { describe, expect, it } from "vitest";
import {
  rolledBack,
  save,
  setUpEachTest,
} from "./postgres-office-instructions-repository.fixtures.js";

setUpEachTest();

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
});
