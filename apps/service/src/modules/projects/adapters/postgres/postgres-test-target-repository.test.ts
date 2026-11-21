import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { aProject } from "../../domain/project.fixtures.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import type { TestTarget } from "../../domain/test-target.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { PostgresTestTargetRepository } from "./postgres-test-target-repository.js";
import { projects } from "./projects.schema.js";
import { testTargets } from "./test-targets.schema.js";

let app: INestApplication;
let repository: PostgresTestTargetRepository;
let projectRepository: PostgresProjectRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresTestTargetRepository, PostgresProjectRepository],
  }));
  repository = app.get(PostgresTestTargetRepository);
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

const WEB: TestTarget = {
  key: "web",
  name: "Web app",
  kind: "hosted",
  entryPoint: { kind: "package-script", manifest: "package.json", script: "start", arguments: [] },
  port: 5173,
  portVariable: "WEB_PORT",
  variables: [{ name: "MODE", value: "test" }],
  secretVariables: [
    { name: "API_KEY", value: "api-s3cret" },
    { name: "MAPS_KEY", value: null },
  ],
  commandsBefore: ["build", "seed"],
  memoryMegabytes: 2048,
  setBy: { name: { by: "user", user: { userId: "user-ann", name: "Ann" } } },
};

const ANDROID: TestTarget = {
  key: "android",
  name: "Android",
  kind: "build-to-install",
  entryPoint: { kind: "gradle-task", task: ":app:assembleDebug", arguments: ["--offline"] },
  outputPatterns: ["app/build/outputs/apk/debug/*.apk"],
  variables: [],
  secretVariables: [],
  commandsBefore: [],
  memoryMegabytes: null,
  setBy: {
    kind: {
      by: "proposal",
      proposalId: "proposal-1",
      agent: { roleKey: "devops", name: "Dana" },
    },
  },
};

describe("PostgresTestTargetRepository", () => {
  it("keeps a Project's targets whole and in order, Secret variables with their values", async () => {
    const projectId = await aStoredProject();
    expect(await repository.listOf(projectId)).toEqual([]);

    expect(await repository.update(projectId, async () => [ANDROID, WEB])).toEqual([ANDROID, WEB]);
    expect(await repository.listOf(projectId)).toEqual([ANDROID, WEB]);

    await repository.update(projectId, async (stored) => {
      expect(stored).toEqual([ANDROID, WEB]);
      return [WEB];
    });
    expect(await repository.listOf(projectId)).toEqual([WEB]);

    expect(await repository.update(projectId, async () => undefined)).toBeUndefined();
    expect(await repository.listOf(projectId)).toEqual([WEB]);
  });

  it("saves nothing when the change throws, and refuses a Project that isn't there", async () => {
    const projectId = await aStoredProject();
    await repository.update(projectId, async () => [WEB]);

    await expect(
      repository.update(projectId, async () => {
        throw new Error("refused");
      }),
    ).rejects.toThrow("refused");
    expect(await repository.listOf(projectId)).toEqual([WEB]);
    await expect(repository.update(`gone-${randomUUID()}`, async () => [WEB])).rejects.toThrow(
      ProjectNotFound,
    );
  });

  it("reads a target saved before commands before, the port variable and memory as their defaults", async () => {
    const projectId = await aStoredProject();
    const database = app.get<Database>(DATABASE);
    await database.insert(testTargets).values({
      projectId,
      key: "web",
      name: "Web app",
      kind: "hosted",
      settings: { entryPoint: WEB.entryPoint, port: 5173, variables: [], secretVariables: [] },
      setBy: {},
      position: 0,
      updatedAt: new Date(),
    });

    expect(await repository.listOf(projectId)).toEqual([
      {
        ...WEB,
        portVariable: "PORT",
        variables: [],
        secretVariables: [],
        commandsBefore: [],
        memoryMegabytes: null,
        setBy: {},
      },
    ]);
  });

  it("removes a Project's targets with the Project", async () => {
    const projectId = await aStoredProject();
    await repository.update(projectId, async () => [WEB, ANDROID]);

    const database = app.get<Database>(DATABASE);
    await database.delete(projects).where(eq(projects.id, projectId));

    expect(
      await database.select().from(testTargets).where(eq(testTargets.projectId, projectId)),
    ).toEqual([]);
  });
});
