import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  NO_MASK,
  ScriptedContainerRuntime,
} from "../adapters/scripted/scripted-container-runtime.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  DEVICE_HELPER_MOUNT,
  hostedProjectNameOf,
  TEST_BUILD_FILES_MOUNT,
} from "../domain/run-environment.js";
import type { TestInstallStart } from "./hosted-services.js";
import {
  runEnvironmentsTestbed,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "./run-environments.fixtures.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true, "remoteUser": "node" }`,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

const INSTANCE_ID = "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a";

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;
let projectName: string;

async function anInstall(extra: Partial<TestInstallStart> = {}): Promise<TestInstallStart> {
  const checkout = join(testbed.folder, "test-instances", INSTANCE_ID);
  await writeFiles(checkout, DEFINITION);
  return {
    instanceId: INSTANCE_ID,
    projectId: "shop",
    checkout,
    buildFiles: join(testbed.folder, "test-builds", "9f8e7d6c"),
    installCommand: undefined,
    installInputs: [],
    installVariables: [],
    logFile: join(testbed.folder, "logs", `${INSTANCE_ID}.log`),
    mask: NO_MASK,
    ...extra,
  };
}

function overrideFile(): string {
  return join(testbed.folders.testInstanceFolder(INSTANCE_ID), "office-override.yaml");
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS);
  projectName = hostedProjectNameOf(testbed.folders.instance, INSTANCE_ID);
});

afterEach(async () => {
  await rm(testbed.folder, { recursive: true, force: true });
});

describe("HostedServices.install", () => {
  it("starts the instance's own project with the helper's folder and the build's files read-only, and no checkout", async () => {
    runtime.userIds = "1000:1000";
    const start = await anInstall();

    const environment = await testbed.hostedServices.install(start);

    expect(environment.checksUser).toBe("1000:1000");
    expect(environment.filesMount).toBe(TEST_BUILD_FILES_MOUNT);
    expect(runtime.steps).toEqual([
      expect.stringMatching(/^build the-office\/shop:/),
      `up ${projectName}`,
      `ids ${projectName} app node`,
    ]);
    const override = parseYaml(await readFile(overrideFile(), "utf8")) as {
      services: Record<string, Record<string, unknown>>;
    };
    const app = override.services["app"];
    expect(app?.["volumes"]).toEqual([
      {
        type: "bind",
        source: testbed.folders.deviceHelper,
        target: DEVICE_HELPER_MOUNT,
        read_only: true,
      },
      { type: "bind", source: start.buildFiles, target: TEST_BUILD_FILES_MOUNT, read_only: true },
    ]);
    expect(app?.["labels"]).toMatchObject({ "office.test-instance": INSTANCE_ID });
    expect(app).not.toHaveProperty("ports");
    expect(app).not.toHaveProperty("working_dir");
    expect(await readFile(start.logFile, "utf8")).toContain(`Starting ${projectName}.`);
    await environment.remove();
  });

  it("attaches a program in the definition's service as its user, or as root", async () => {
    const environment = await testbed.hostedServices.install(await anInstall());

    const adb = await environment.attach({ arguments: ["adb", "devices"] });
    await environment.attach({ arguments: ["/office-device-helper/helper"], asRoot: true });

    expect(adb).toBe(runtime.attached[0]);
    expect(runtime.attached.map(({ attachment }) => attachment)).toEqual([
      expect.objectContaining({ service: "app", user: "node", arguments: ["adb", "devices"] }),
      expect.objectContaining({ service: "app", user: "0:0" }),
    ]);
    await environment.remove();
  });

  it("removes its project once removed, attaching nothing after", async () => {
    const environment = await testbed.hostedServices.install(await anInstall());

    await environment.remove();
    await environment.remove();

    expect(runtime.projects.has(projectName)).toBe(false);
    expect(runtime.steps.filter((step) => step.startsWith("down "))).toHaveLength(1);
    expect(await environment.attach({ arguments: ["adb", "devices"] })).toBeUndefined();
  });

  it("is removed by the instance's stop, and by the sweep", async () => {
    const stopped = await testbed.hostedServices.install(await anInstall());
    await testbed.hostedServices.stop(INSTANCE_ID);
    expect(runtime.projects.has(projectName)).toBe(false);
    expect(await stopped.attach({ arguments: ["adb", "devices"] })).toBeUndefined();
    await stopped.remove();

    await testbed.hostedServices.install(await anInstall());
    await testbed.hostedServices.sweep();
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("refuses a definition that isn't valid, with its problems, starting nothing", async () => {
    const start = await anInstall();
    await writeFiles(start.checkout, { ".devcontainer/devcontainer.json": "{ nope" });

    const refusal = await testbed.hostedServices.install(start).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(RunEnvironmentRefused);
    expect((refusal as RunEnvironmentRefused).reasons[0]).toBe(
      "The run environment definition on this branch isn't valid.",
    );
    expect(runtime.steps.some((step) => step.startsWith("up "))).toBe(false);
  });

  it("refuses a start that fails, removing what it made", async () => {
    runtime.failing.add("up");

    const refusal = await testbed.hostedServices
      .install(await anInstall())
      .catch((error: unknown) => error);

    expect((refusal as RunEnvironmentRefused).reasons[0]).toBe(
      "The run environment couldn't start.",
    );
    expect(runtime.steps).toContain(`down ${projectName} with built images`);
  });

  it("refuses as stopped when its signal is aborted", async () => {
    const aborted = new AbortController();
    aborted.abort();

    const refusal = await testbed.hostedServices
      .install(await anInstall({ signal: aborted.signal }))
      .catch((error: unknown) => error);

    expect((refusal as RunEnvironmentRefused).reasons).toEqual(["The Test instance was stopped."]);
    expect(runtime.steps.some((step) => step.startsWith("up "))).toBe(false);
  });
});
