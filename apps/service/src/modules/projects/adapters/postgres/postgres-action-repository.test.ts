import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Action } from "../../domain/action.js";
import { aProject } from "../../domain/project.fixtures.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import { actions } from "./actions.schema.js";
import { PostgresActionRepository } from "./postgres-action-repository.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { projects } from "./projects.schema.js";

let app: INestApplication;
let repository: PostgresActionRepository;
let projectRepository: PostgresProjectRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresActionRepository, PostgresProjectRepository],
  }));
  repository = app.get(PostgresActionRepository);
  projectRepository = app.get(PostgresProjectRepository);
});

afterAll(async () => {
  await app.close();
});

/** A Project of this file's own: every test file shares the database. */
async function aStoredProject(): Promise<string> {
  const id = `project-${randomUUID()}`;
  await projectRepository.add(aProject({ id, name: id }));
  return id;
}

const BUILD: Action = {
  key: "build-web",
  name: "Build web",
  kind: "project-command",
  settings: {
    commandKey: "build",
    commandsBefore: ["install"],
    timeLimitMinutes: 30,
    projectDeviceId: null,
  },
  leavesTheWorkstation: false,
  setBy: { name: { by: "user", user: { userId: "user-ann", name: "Ann" } } },
};

const PHONE: Action = {
  key: "phone",
  name: "Install on my phone",
  kind: "test-target",
  settings: { targetKey: "android" },
  leavesTheWorkstation: false,
  setBy: {},
};

const RELEASE: Action = {
  key: "release",
  name: "Release",
  kind: "workflow",
  settings: { file: "release.yml", inputs: { channel: "stable", "dry-run": "false" } },
  leavesTheWorkstation: true,
  setBy: {
    leavesTheWorkstation: {
      by: "proposal",
      proposalId: "proposal-1",
      agent: { roleKey: "devops", name: "Dana" },
    },
  },
};

describe("PostgresActionRepository", () => {
  it("keeps a Project's Actions whole and in order, each kind's settings as given", async () => {
    const projectId = await aStoredProject();
    expect(await repository.listOf(projectId)).toEqual([]);

    expect(await repository.update(projectId, async () => [RELEASE, BUILD, PHONE])).toEqual([
      RELEASE,
      BUILD,
      PHONE,
    ]);
    expect(await repository.listOf(projectId)).toEqual([RELEASE, BUILD, PHONE]);

    await repository.update(projectId, async (stored) => {
      expect(stored).toEqual([RELEASE, BUILD, PHONE]);
      return [PHONE];
    });
    expect(await repository.listOf(projectId)).toEqual([PHONE]);

    expect(await repository.update(projectId, async () => undefined)).toBeUndefined();
    expect(await repository.listOf(projectId)).toEqual([PHONE]);
  });

  it("saves nothing when the change throws, and refuses a Project that isn't there", async () => {
    const projectId = await aStoredProject();
    await repository.update(projectId, async () => [BUILD]);

    await expect(
      repository.update(projectId, async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(await repository.listOf(projectId)).toEqual([BUILD]);
    await expect(repository.update(`gone-${randomUUID()}`, async () => [BUILD])).rejects.toThrow(
      ProjectNotFound,
    );
  });

  it("reads a value its row lacks as its default, and goes with its Project", async () => {
    const projectId = await aStoredProject();
    const database = app.get<Database>(DATABASE);
    await database.insert(actions).values({
      projectId,
      key: "lint",
      position: 0,
      name: "Lint",
      kind: "project-command",
      settings: { commandKey: "lint" },
      leavesTheWorkstation: false,
      updatedAt: new Date(),
    });

    expect(await repository.listOf(projectId)).toEqual([
      {
        key: "lint",
        name: "Lint",
        kind: "project-command",
        settings: {
          commandKey: "lint",
          commandsBefore: [],
          timeLimitMinutes: null,
          projectDeviceId: null,
        },
        leavesTheWorkstation: false,
        setBy: {},
      },
    ]);

    await database.delete(projects).where(eq(projects.id, projectId));
    expect(await repository.listOf(projectId)).toEqual([]);
  });
});
