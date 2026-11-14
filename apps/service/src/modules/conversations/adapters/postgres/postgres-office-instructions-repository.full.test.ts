import { describe, expect, it } from "vitest";
import {
  rolledBack,
  save,
  setUpEachTest,
} from "./postgres-office-instructions-repository.fixtures.js";
import { ANN_LEE } from "../../domain/user.fixtures.js";

setUpEachTest();

describe("PostgresOfficeInstructionsRepository", () => {
  it("saves nothing when the change makes no version, and answers the current one", async () => {
    await rolledBack(async (repository) => {
      const saved = await save(repository, "Write in plain words.");

      expect(await save(repository, "Write in plain words.")).toEqual(saved);
      expect(await repository.current()).toEqual(saved);
    });
  });

  it("saves nothing when the change refuses, and lets the refusal through", async () => {
    const refusal = new Error("Refused");
    await rolledBack(async (repository) => {
      const saved = await save(repository, "Write in plain words.");

      await expect(
        repository.update(
          () => {
            throw refusal;
          },
          new Date(),
          ANN_LEE,
        ),
      ).rejects.toBe(refusal);

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
