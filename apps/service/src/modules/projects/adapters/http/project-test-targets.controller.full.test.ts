import type { INestApplication } from "@nestjs/common";
import {
  projectRefusalSchema,
  testTargetListSchema,
  type EditedTestTarget,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { DevcontainerServices } from "../../application/devcontainer-services.js";
import { TestTargets } from "../../application/test-targets.js";
import { ProjectRefused } from "../../domain/project-refused.js";
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

  it("the outlined kinds, as not built yet", async () => {
    expect(
      await reasonsFor([
        aHostedTarget({ kind: "install-on-a-device" }),
        aHostedTarget({ key: "remote", kind: "deployed-elsewhere" }),
      ]),
    ).toEqual([
      `Test target "web": Install on a device isn't built yet.`,
      `Test target "remote": Deployed elsewhere isn't built yet.`,
    ]);
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

describe("A Proposal of test targets", REAL_GIT_TEST, () => {
  const DEVOPS = { proposalId: "proposal-1", agent: { roleKey: "devops", name: "Dana" } };

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

    await testTargets.changeAsProposed(project.id, proposed, DEVOPS);

    const [target] = await testTargets.list(project.id);
    expect(target).toMatchObject({
      port: 3000,
      secretVariables: [
        { name: "API_KEY", value: "api-s3cret-value" },
        { name: "MAPS_KEY", value: null },
      ],
      setBy: { port: { by: "proposal", ...DEVOPS }, name: { by: "user" } },
    });
    await expect(testTargets.changeAsProposed(project.id, proposed, DEVOPS)).rejects.toThrow(
      new ProjectRefused([`Test target "web" changed since this was proposed.`]),
    );
  });
});
