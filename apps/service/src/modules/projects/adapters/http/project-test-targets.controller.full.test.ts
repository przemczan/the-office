import type { INestApplication } from "@nestjs/common";
import {
  MEMORY_PER_SERVICE_MEGABYTES,
  projectRefusalSchema,
  testTargetListSchema,
  type EditedTestTarget,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { DevcontainerServices } from "../../application/devcontainer-services.js";
import { TestTargets } from "../../application/test-targets.js";
import { FeatureSwitchedOff } from "../../domain/project-features.js";
import { ProjectRefused } from "../../domain/project-refused.js";
import { TEST_TARGET_MEMORY_MEGABYTES } from "../../domain/test-target.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";
import {
  createTemporaryRepository,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import {
  aBuildToInstallTarget,
  aHostedTarget,
  commitEntryPoints,
  commitGradleWrapper,
} from "./project-test-targets.controller.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
const published: DomainEvent[] = [];

beforeAll(async () => {
  repository = await createTemporaryRepository();
  await commitEntryPoints(repository);
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startProjectsApplication(repository));
  // Run environments' reader stood in for: the repository's .devcontainer/ has these services.
  app.get(DevcontainerServices).register(async () => ["app", "web"]);
});

afterEach(async () => {
  await app.close();
});

const { send, addProject } = projectsHttp(() => ({ app, url, published, repository }));

async function reasonsFor(targets: readonly EditedTestTarget[]): Promise<readonly string[]> {
  const project = await addProject();
  const response = await send("PUT", `/projects/${project.id}/test-targets`, { targets });
  expect(response.status).toBe(422);
  return projectRefusalSchema.parse(await response.json()).reasons;
}

describe("PUT /api/projects/:id/test-targets refuses", REAL_GIT_TEST, () => {
  it("a key given twice, a missing name and a name too long", async () => {
    expect(
      await reasonsFor([aHostedTarget({ name: " " }), aHostedTarget({ name: "x".repeat(61) })]),
    ).toEqual([
      `The key "web" is given to more than one test target.`,
      `Test target "web": Give it a name.`,
      `Test target "web": Its name may be at most 60 characters.`,
    ]);
  });

  it("Deployed elsewhere, as not built yet", async () => {
    expect(
      await reasonsFor([aHostedTarget({ key: "remote", kind: "deployed-elsewhere" })]),
    ).toEqual([`Test target "remote": Deployed elsewhere isn't built yet.`]);
  });

  it("output patterns leaving the repository, or none", async () => {
    expect(
      await reasonsFor([
        aBuildToInstallTarget({ outputPatterns: ["../out/*.apk", "/tmp/app.apk"] }),
        aBuildToInstallTarget({ key: "ios", outputPatterns: [" "] }),
      ]),
    ).toEqual([
      `Test target "android": The output file pattern ../out/*.apk must stay inside the repository: relative to its root, with no "..".`,
      `Test target "android": The output file pattern /tmp/app.apk must stay inside the repository: relative to its root, with no "..".`,
      `Test target "ios": Give at least one output file pattern, such as app/build/outputs/apk/debug/*.apk.`,
    ]);
  });

  it("a variable both plain and secret, and a Secret variable's value too short", async () => {
    expect(
      await reasonsFor([
        aHostedTarget({
          variables: [{ name: "API_KEY", value: "plain" }],
          secretVariables: [{ name: "API_KEY", value: "short" }],
        }),
      ]),
    ).toEqual([
      `Test target "web": The value of the Secret variable API_KEY is shorter than 6 characters, so hiding it in output could hide ordinary text.`,
      `Test target "web": API_KEY is both a plain and a Secret variable: make it one or the other.`,
    ]);
  });

  it("a script the manifest doesn't list, a manifest that isn't JSON and a file outside the repository", async () => {
    expect(
      await reasonsFor([
        aHostedTarget({
          entryPoint: {
            kind: "package-script",
            manifest: "package.json",
            script: "serve",
            arguments: [],
          },
        }),
        aHostedTarget({
          key: "broken",
          entryPoint: {
            kind: "package-script",
            manifest: "apps/broken/package.json",
            script: "start",
            arguments: [],
          },
        }),
        aBuildToInstallTarget({
          entryPoint: { kind: "repository-file", path: "../outside.sh", arguments: [] },
        }),
      ]),
    ).toEqual([
      `Test target "android": The path of the file, ../outside.sh, must be inside the repository, from its root.`,
    ]);
    expect(
      await reasonsFor([
        aHostedTarget({
          entryPoint: {
            kind: "package-script",
            manifest: "package.json",
            script: "serve",
            arguments: [],
          },
        }),
        aHostedTarget({
          key: "broken",
          entryPoint: {
            kind: "package-script",
            manifest: "apps/broken/package.json",
            script: "start",
            arguments: [],
          },
        }),
      ]),
    ).toEqual([
      `Test target "web": The package manifest package.json has no script serve in its "scripts".`,
      `Test target "broken": The package manifest apps/broken/package.json isn't valid JSON.`,
    ]);
  });

  it("a Gradle task with no wrapper at the root, then saves it once there is one", async () => {
    const gradle = aBuildToInstallTarget({
      entryPoint: { kind: "gradle-task", task: ":app:assembleDebug", arguments: [] },
    });
    expect(await reasonsFor([gradle])).toEqual([
      `Test target "android": The repository has no Gradle wrapper, gradlew, at its root, which a Gradle task runs through.`,
    ]);

    await commitGradleWrapper(repository);
    const project = await addProject();
    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [gradle],
    });
    expect(response.status).toBe(200);
  });

  it("a command before the entry point the Project hasn't, a port variable that can't be one, and memory out of bounds", async () => {
    expect(
      await reasonsFor([
        aHostedTarget({ commandsBefore: ["build", "seed"], portVariable: "1PORT" }),
        aHostedTarget({
          key: "admin",
          portVariable: "OFFICE_TEST_INSTANCE",
          memoryMegabytes: 700,
        }),
        aHostedTarget({ key: "api", portVariable: "MODE", memoryMegabytes: 131_072 }),
        aBuildToInstallTarget({ commandsBefore: ["lint"], memoryMegabytes: 256 }),
      ]),
    ).toEqual([
      `Test target "web": Its port variable must be a variable's name: letters, digits and _, not starting with a digit, such as PORT.`,
      `Test target "web": The command seed in its commands before the entry point isn't one of the Project's commands.`,
      `Test target "admin": Its port variable can't be OFFICE_TEST_INSTANCE: The Office sets it in every test instance.`,
      `Test target "admin": Its memory per service is between 0.5 GB and 64 GB, in steps of 0.5 GB.`,
      `Test target "api": Its port variable MODE is one of its own variables too: give the port its own name.`,
      `Test target "api": Its memory per service is between 0.5 GB and 64 GB, in steps of 0.5 GB.`,
      `Test target "android": Its memory per service is between 0.5 GB and 64 GB, in steps of 0.5 GB.`,
    ]);
  });

  it("a .devcontainer/ service the repository doesn't have, and one for Build to install", async () => {
    expect(
      await reasonsFor([
        aHostedTarget({ entryPoint: { kind: "devcontainer-service", service: "api" } }),
      ]),
    ).toEqual([
      `Test target "web": The repository's .devcontainer/ has no service api; it has app, web.`,
    ]);
    expect(
      await reasonsFor([
        aBuildToInstallTarget({ entryPoint: { kind: "devcontainer-service", service: "web" } }),
      ]),
    ).toEqual([
      `Test target "android": A .devcontainer/ service is an entry point for Hosted only.`,
    ]);

    const project = await addProject();
    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [aHostedTarget({ entryPoint: { kind: "devcontainer-service", service: "web" } })],
    });
    expect(response.status).toBe(200);
    expect(testTargetListSchema.parse(await response.json()).targets).toHaveLength(1);
  });
});

describe("PUT /api/projects/:id/test-targets saves", REAL_GIT_TEST, () => {
  it("the commands before the entry point, the port variable and the memory, each set by you, and a launch resolves them", async () => {
    const project = await addProject();
    const target = aHostedTarget({
      commandsBefore: ["install", "build", "lint"],
      portVariable: "WEB_PORT",
      memoryMegabytes: 2048,
    });
    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [target, aBuildToInstallTarget({ memoryMegabytes: 1536 })],
    });

    expect(response.status).toBe(200);
    const [saved, built] = testTargetListSchema.parse(await response.json()).targets;
    expect(saved).toMatchObject({
      commandsBefore: ["install", "build", "lint"],
      portVariable: "WEB_PORT",
      memoryMegabytes: 2048,
      setBy: {
        commandsBefore: { by: "user" },
        portVariable: { by: "user" },
        memoryMegabytes: { by: "user" },
      },
    });
    expect(built).toMatchObject({ commandsBefore: [], memoryMegabytes: 1536 });
    expect(built).not.toHaveProperty("portVariable");

    const launch = await app.get(TestTargets).launchSettingsOf(project.id, "web");
    expect(launch).toMatchObject({
      commandsBefore: [
        { key: "install", name: "Install", commandLine: project.installCommand },
        { key: "build", name: "Build", commandLine: "npm run build" },
        { key: "lint", name: "Lint", commandLine: "npm run lint" },
      ],
      missingCommands: [],
      portVariable: "WEB_PORT",
      memoryMegabytes: 2048,
    });
    expect(await app.get(TestTargets).launchSettingsOf(project.id, "android")).toMatchObject({
      portVariable: undefined,
      memoryMegabytes: 1536,
    });

    // A command removed from the Project later is the launch's to name, the target kept as saved.
    expect((await send("DELETE", `/projects/${project.id}/commands/lint`)).status).toBe(200);
    expect(await app.get(TestTargets).launchSettingsOf(project.id, "web")).toMatchObject({
      commandsBefore: [
        { key: "install", name: "Install", commandLine: project.installCommand },
        { key: "build", name: "Build", commandLine: "npm run build" },
      ],
      missingCommands: ["lint"],
    });
  });
});

describe("A test target's memory", () => {
  it("has the bounds of the Office-wide Memory per service", () => {
    expect(TEST_TARGET_MEMORY_MEGABYTES).toEqual(MEMORY_PER_SERVICE_MEGABYTES);
  });
});

describe("A Proposal of test targets", REAL_GIT_TEST, () => {
  const DEVOPS = { proposalId: "proposal-1", agent: { roleKey: "devops", name: "Dana" } };
  const APPLIED = { kind: "proposal", proposalId: "proposal-1", user: null } as const;

  it("applies all or nothing, keeping Secret values by name and marking what it changed", async () => {
    const project = await addProject();
    await send("PUT", `/projects/${project.id}/test-targets`, { targets: [aHostedTarget()] });
    const testTargets = app.get(TestTargets);

    const proposed = await testTargets.propose(project.id, {
      targets: [
        {
          ...aHostedTarget(),
          port: 3000,
          secretVariables: ["API_KEY", "MAPS_KEY"],
        } as Parameters<TestTargets["propose"]>[1]["targets"][number],
      ],
      changeUserSet: ["web.port", "web.secretVariables"],
    });
    expect(proposed.targets.map(({ key, userSet }) => ({ key, userSet }))).toEqual([
      { key: "web", userSet: ["port", "secretVariables"] },
    ]);
    expect(await testTargets.proposedProblems(project.id, proposed)).toEqual([]);

    await testTargets.changeAsProposed(project.id, proposed, DEVOPS, APPLIED);

    const [target] = await testTargets.list(project.id);
    expect(target).toMatchObject({
      port: 3000,
      secretVariables: [
        { name: "API_KEY", value: "api-s3cret-value" },
        { name: "MAPS_KEY", value: null },
      ],
      setBy: { port: { by: "proposal", ...DEVOPS }, name: { by: "user" } },
    });
    await expect(
      testTargets.changeAsProposed(project.id, proposed, DEVOPS, APPLIED),
    ).rejects.toThrow(new ProjectRefused([`Test target "web" changed since this was proposed.`]));
  });

  it("refuses a command before the entry point the Project hasn't, as the page does", async () => {
    const project = await addProject();
    const testTargets = app.get(TestTargets);

    await expect(
      testTargets.propose(project.id, {
        targets: [
          {
            ...aHostedTarget(),
            commandsBefore: ["seed"],
            secretVariables: [],
          } as Parameters<TestTargets["propose"]>[1]["targets"][number],
        ],
      }),
    ).rejects.toThrow(
      new ProjectRefused([
        `Test target "web": The command seed in its commands before the entry point isn't one of the Project's commands.`,
      ]),
    );
  });
});

describe("Test targets switched off", REAL_GIT_TEST, () => {
  const DEVOPS = { proposalId: "proposal-1", agent: { roleKey: "devops", name: "Dana" } };
  const APPLIED = { kind: "proposal", proposalId: "proposal-1", user: null } as const;

  it("refuse the page's save, a Proposal and a launch, naming the Project, and still list the targets", async () => {
    const project = await addProject();
    await send("PUT", `/projects/${project.id}/test-targets`, { targets: [aHostedTarget()] });
    const testTargets = app.get(TestTargets);
    const proposed = await testTargets.propose(project.id, {
      targets: [
        {
          ...aHostedTarget(),
          port: 3000,
          secretVariables: ["API_KEY"],
        } as Parameters<TestTargets["propose"]>[1]["targets"][number],
      ],
      changeUserSet: ["web.port"],
    });
    const off = await send("PUT", `/projects/${project.id}/features`, {
      features: { "test-targets": false },
    });
    expect(off.status).toBe(200);
    const words = `Test targets are switched off for «${project.name}».`;
    const refusal = new FeatureSwitchedOff("test-targets", project.name);

    const response = await send("PUT", `/projects/${project.id}/test-targets`, {
      targets: [aHostedTarget({ port: 4000 })],
    });
    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([words]);

    await expect(
      testTargets.propose(project.id, {
        targets: [
          {
            ...aHostedTarget(),
            secretVariables: [],
          } as Parameters<TestTargets["propose"]>[1]["targets"][number],
        ],
      }),
    ).rejects.toThrow(refusal);
    expect(await testTargets.proposedProblems(project.id, proposed)).toEqual([words]);
    await expect(
      testTargets.changeAsProposed(project.id, proposed, DEVOPS, APPLIED),
    ).rejects.toThrow(refusal);
    await expect(testTargets.launchSettingsOf(project.id, "web")).rejects.toThrow(refusal);

    const listed = await fetch(`${url}/api/projects/${project.id}/test-targets`);
    expect(listed.status).toBe(200);
    expect(testTargetListSchema.parse(await listed.json()).targets).toMatchObject([
      { key: "web", port: 5173 },
    ]);
  });
});
