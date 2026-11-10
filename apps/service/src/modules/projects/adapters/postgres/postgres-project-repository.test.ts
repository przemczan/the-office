import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { asProjectChanges, changeCommand } from "../../domain/project-changes.js";
import { aProject } from "../../domain/project.fixtures.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";

let app: INestApplication;
let repository: PostgresProjectRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresProjectRepository],
  }));
  repository = app.get(PostgresProjectRepository);
});

afterAll(async () => {
  await app.close();
});

/** A Project of this test's own: every test file shares the database. */
function aProjectOfItsOwn(): ReturnType<typeof aProject> {
  return aProject({ id: `project-${randomUUID()}` });
}

describe("PostgresProjectRepository", () => {
  it("keeps a Project as it was added", async () => {
    const project = aProjectOfItsOwn();

    await repository.add(project);

    await expect(repository.find(project.id)).resolves.toEqual(project);
  });

  describe("update", () => {
    it("loses neither of two changes made at once", async () => {
      const project = aProjectOfItsOwn();
      await repository.add(project);

      await Promise.all([
        repository.update(project.id, (stored) =>
          asProjectChanges(stored, changeCommand(stored, "test", "vitest run")),
        ),
        repository.update(project.id, (stored) =>
          asProjectChanges(stored, changeCommand(stored, "lint", "oxlint")),
        ),
      ]);

      const stored = await repository.find(project.id);
      expect(stored?.commands).toMatchObject({ test: "vitest run", lint: "oxlint" });
    });
  });
});
