import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { addCommand, asProjectChanges, changeCommand } from "../../domain/project-changes.js";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { aProject, startingCommands } from "../../domain/project.fixtures.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { projects } from "./projects.schema.js";

const E2E = {
  key: "test-e2e",
  name: "End to end",
  kind: "test",
  commandLine: "npm run e2e",
  rerunCommandLine: "",
} as const;

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

  it("reads a command saved before re-run commands as having none", async () => {
    const project = aProjectOfItsOwn();
    await repository.add(project);
    await app
      .get<Database>(DATABASE)
      .update(projects)
      .set({ commands: [{ key: "test", name: "Test", kind: "test", commandLine: "npm test" }] })
      .where(eq(projects.id, project.id));

    const stored = await repository.find(project.id);

    expect(stored?.commands).toEqual([
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ]);
  });

  describe("update", () => {
    it("loses neither of two changes made at once", async () => {
      const project = aProjectOfItsOwn();
      await repository.add(project);

      await Promise.all([
        repository.update(project.id, (stored) =>
          asProjectChanges(
            stored,
            changeCommand(stored, "test", {
              name: "Test",
              kind: "test",
              commandLine: "vitest run",
              rerunCommandLine: "",
            }),
          ),
        ),
        repository.update(project.id, (stored) =>
          asProjectChanges(stored, addCommand(stored, E2E)),
        ),
      ]);

      const stored = await repository.find(project.id);
      expect(stored?.commands).toEqual([...startingCommands({ test: "vitest run" }), E2E]);
    });
  });
});
