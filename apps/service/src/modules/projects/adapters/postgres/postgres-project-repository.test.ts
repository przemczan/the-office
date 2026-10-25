import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { changeCommand } from "../../domain/project-changes.js";
import { aProject } from "../../domain/project.fixtures.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
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

  it("lists Projects in the order they were added", async () => {
    const earlier = aProjectOfItsOwn();
    const later = { ...aProjectOfItsOwn(), addedAt: new Date(earlier.addedAt.getTime() + 1000) };
    await repository.add(later);
    await repository.add(earlier);

    const ids = (await repository.list()).map((project) => project.id);

    expect(ids.filter((id) => id === earlier.id || id === later.id)).toEqual([
      earlier.id,
      later.id,
    ]);
  });

  it("finds nothing for an id it doesn't have", async () => {
    await expect(repository.find("nowhere")).resolves.toBeUndefined();
  });

  describe("update", () => {
    it("saves the change and returns it", async () => {
      const project = aProjectOfItsOwn();
      await repository.add(project);

      const change = await repository.update(project.id, (stored) =>
        changeCommand(stored, "test", "npm test -- --run"),
      );

      expect(change?.event.commandLine).toBe("npm test -- --run");
      await expect(repository.find(project.id)).resolves.toEqual(change?.project);
    });

    it("loses neither of two changes made at once", async () => {
      const project = aProjectOfItsOwn();
      await repository.add(project);

      await Promise.all([
        repository.update(project.id, (stored) => changeCommand(stored, "test", "vitest run")),
        repository.update(project.id, (stored) => changeCommand(stored, "lint", "oxlint")),
      ]);

      const stored = await repository.find(project.id);
      expect(stored?.commands).toMatchObject({ test: "vitest run", lint: "oxlint" });
    });

    it("refuses a Project it doesn't have", async () => {
      await expect(repository.update("nowhere", () => undefined)).rejects.toEqual(
        new ProjectNotFound("nowhere"),
      );
    });
  });
});
