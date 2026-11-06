import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  asProjectChanges,
  changeCommand,
  changeCommandsAsProposed,
} from "../../domain/project-changes.js";
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

  it("keeps the Project's engine levels", async () => {
    const project = {
      ...aProjectOfItsOwn(),
      projectDefault: { engineId: "claude-code", model: "claude-sonnet-5-5" },
      useForEveryRole: true,
      roleOverrides: [
        { roleKey: "cto", engineId: "claude-code", model: "claude-opus-5-5" },
        { roleKey: "reviewer", engineId: "strata", model: "qwen3-coder" },
      ],
    };

    await repository.add(project);

    await expect(repository.find(project.id)).resolves.toEqual(project);
  });

  it("keeps the skills the Project turned off", async () => {
    const project = { ...aProjectOfItsOwn(), projectSkillsOff: ["deploy", "frontend:notes"] };

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
    it("saves the changes kept together whole and returns them", async () => {
      const project = aProjectOfItsOwn();
      await repository.add(project);

      const changes = await repository.update(project.id, (stored) =>
        changeCommandsAsProposed(
          stored,
          { test: stored.commands.test, lint: stored.commands.lint },
          { test: "npm test -- --run", lint: "oxlint" },
        ),
      );

      expect(changes.events).toHaveLength(2);
      await expect(repository.find(project.id)).resolves.toEqual(changes.project);
      expect(changes.project.commands).toMatchObject({ test: "npm test -- --run", lint: "oxlint" });
    });

    it("returns the Project as stored when nothing changes", async () => {
      const project = aProjectOfItsOwn();
      await repository.add(project);

      await expect(
        repository.update(project.id, (stored) => ({ project: stored, events: [] })),
      ).resolves.toEqual({ project, events: [] });
    });

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

    it("refuses a Project it doesn't have", async () => {
      await expect(
        repository.update("nowhere", (stored) => ({ project: stored, events: [] })),
      ).rejects.toEqual(new ProjectNotFound("nowhere"));
    });
  });
});
