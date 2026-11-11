import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  asProjectChanges,
  changeCommandsAsProposed,
  changeImage,
} from "../../domain/project-changes.js";
import { aProject, startingCommands } from "../../domain/project.fixtures.js";
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

  it("keeps the Project limit", async () => {
    const project = { ...aProjectOfItsOwn(), projectLimit: 4 };

    await repository.add(project);

    await expect(repository.find(project.id)).resolves.toEqual(project);
  });

  it("reads a Project limit of 1 for a Project saved without one, as those added before it were", async () => {
    const id = `project-${randomUUID()}`;
    await app.get<Database>(DATABASE).execute(sql`
      insert into projects (id, name, path, base_branch, mark_label, mark_colour, install_command,
        publishing_mode, default_pipeline, use_project_skills, added_at)
      values (${id}, 'Older', '/work/older', 'main', 'OL', 'teal', 'npm ci', 'merge', 'full', true,
        now())`);

    expect((await repository.find(id))?.projectLimit).toBe(1);
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
        changeCommandsAsProposed(stored, {
          installCommand: { from: stored.installCommand, to: "npm install" },
          commands: [
            {
              key: "test",
              from: { name: "Test", kind: "test", commandLine: "npm test" },
              to: { name: "Test", kind: "test", commandLine: "npm test -- --run" },
            },
            {
              key: "lint",
              from: { name: "Lint", kind: "lint", commandLine: "npm run lint" },
              to: null,
            },
          ],
        }),
      );

      expect(changes.events).toHaveLength(3);
      await expect(repository.find(project.id)).resolves.toEqual(changes.project);
      expect(changes.project.installCommand).toBe("npm install");
      expect(changes.project.commands).toEqual(
        startingCommands({ test: "npm test -- --run" }).filter(({ key }) => key !== "lint"),
      );
    });

    it("returns the Project as stored when nothing changes", async () => {
      const project = aProjectOfItsOwn();
      await repository.add(project);

      await expect(
        repository.update(project.id, (stored) => ({ project: stored, events: [] })),
      ).resolves.toEqual({ project, events: [] });
    });

    it("refuses a Project it doesn't have", async () => {
      await expect(
        repository.update("nowhere", (stored) => ({ project: stored, events: [] })),
      ).rejects.toEqual(new ProjectNotFound("nowhere"));
    });
  });

  it("keeps each version of an image, and clears one again, leaving the other", async () => {
    const project = aProject({ id: randomUUID() });
    await repository.add(project);
    const light = { id: randomUUID(), mediaType: "image/webp" } as const;
    const dark = { id: randomUUID(), mediaType: "image/svg+xml" } as const;
    const none = { light: null, dark: null };

    await repository.update(project.id, (stored) =>
      asProjectChanges(stored, changeImage(stored, "icon", "light", light)),
    );
    await repository.update(project.id, (stored) =>
      asProjectChanges(stored, changeImage(stored, "icon", "dark", dark)),
    );
    expect(await repository.find(project.id)).toMatchObject({ icon: { light, dark }, logo: none });

    await repository.update(project.id, (stored) =>
      asProjectChanges(stored, changeImage(stored, "icon", "light", null)),
    );
    expect(await repository.find(project.id)).toMatchObject({
      icon: { light: null, dark },
      logo: none,
    });
  });
});
