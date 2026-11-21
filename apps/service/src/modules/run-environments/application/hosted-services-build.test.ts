import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { OutputMask } from "../../projects/index.js";
import { ScriptedContainerRuntime } from "../adapters/scripted/scripted-container-runtime.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  BUILD_CACHE_FOLDER,
  buildCacheVolumeOf,
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  hostedProjectNameOf,
} from "../domain/run-environment.js";
import type { TestBuildStart } from "./hosted-services.js";
import {
  runEnvironmentsTestbed,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "./run-environments.fixtures.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true }`,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
};

const INSTANCE_ID = "0b3e2d1c-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const SECRET = "s3cret-signing";

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;
let projectName: string;

async function build(extra: Partial<TestBuildStart> = {}): Promise<TestBuildStart> {
  const checkout = join(testbed.folder, "test-instances", INSTANCE_ID);
  await writeFiles(checkout, DEFINITION);
  return {
    instanceId: INSTANCE_ID,
    projectId: "shop",
    checkout,
    entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: ["--offline"] },
    variables: [
      { name: "FLAVOUR", value: "debug" },
      { name: "SIGNING_TOKEN", value: SECRET },
    ],
    commandsBefore: [],
    memoryMegabytes: undefined,
    installCommand: undefined,
    installInputs: [],
    installVariables: [],
    logFile: join(testbed.folder, "logs", `${INSTANCE_ID}.log`),
    mask: new OutputMask([{ name: "SIGNING_TOKEN", value: SECRET }]),
    timeoutMs: 60_000,
    ...extra,
  };
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS);
  projectName = hostedProjectNameOf(testbed.folders.instance, INSTANCE_ID);
});

afterEach(async () => {
  await rm(testbed.folder, { recursive: true, force: true });
});

describe("HostedServices.build", () => {
  it("runs the entry point in its own project with the cache volume, answers its exit code and removes the project", async () => {
    runtime.onExec = () => Promise.resolve({ exitCode: 0, output: `signed with ${SECRET}\n` });
    const start = await build();

    const ended = await testbed.hostedServices.build(start);

    expect(ended).toEqual({ exitCode: 0 });
    const volume = buildCacheVolumeOf(testbed.folders.instance, "shop");
    expect(runtime.steps).toEqual([
      expect.stringMatching(/^build the-office\/shop:/),
      `volume ${volume}`,
      `up ${projectName}`,
      `exec ${projectName}`,
      `down ${projectName} with built images`,
      expect.stringMatching(/^remove /),
    ]);
    const [execution] = runtime.executions;
    expect(execution?.arguments).toEqual(["./gradlew", "assembleDebug", "--offline"]);
    // The build's time, less what the steps before the entry point took.
    expect(execution?.timeoutMs).toBeLessThanOrEqual(60_000);
    expect(execution?.timeoutMs).toBeGreaterThan(50_000);
    const log = await readFile(start.logFile, "utf8");
    expect(log).toContain("signed with [secret SIGNING_TOKEN]");
    expect(log).not.toContain(SECRET);
  });

  it("gives the cache's folders to the devcontainer's user as root before building as that user", async () => {
    const start = await build();
    await writeFiles(start.checkout, {
      ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true, "remoteUser": "vscode" }`,
    });

    await testbed.hostedServices.build(start);

    const [ownership, entryPoint] = runtime.executions;
    expect(ownership?.user).toBe("root");
    expect(ownership?.arguments).toEqual([
      "vscode",
      BUILD_CACHE_FOLDER,
      `${BUILD_CACHE_FOLDER}/gradle`,
      `${BUILD_CACHE_FOLDER}/npm`,
      `${BUILD_CACHE_FOLDER}/android`,
    ]);
    expect(entryPoint?.user).toBe("vscode");
    expect(entryPoint?.arguments).toEqual(["./gradlew", "assembleDebug", "--offline"]);
  });

  it("refuses the build when the cache's folders can't be given to the user", async () => {
    runtime.onExec = (execution) =>
      Promise.resolve({ exitCode: execution.user === "root" ? 1 : 0 });
    const start = await build();
    await writeFiles(start.checkout, {
      ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true, "remoteUser": "vscode" }`,
    });

    await expect(testbed.hostedServices.build(start)).rejects.toThrow(
      "The build cache volume couldn't be given to the user vscode.",
    );
    expect(runtime.executions).toHaveLength(1);
  });

  it("mounts only the checkout and the Project's cache volume, publishes no port and passes variables by carrier", async () => {
    let override: Record<string, unknown> = {};
    runtime.onExec = async () => {
      const file = join(testbed.folders.testInstanceFolder(INSTANCE_ID), "office-override.yaml");
      override = parseYaml(await readFile(file, "utf8")) as Record<string, unknown>;
      return { exitCode: 0 };
    };
    const start = await build();

    await testbed.hostedServices.build(start);

    expect(override).toMatchObject({
      services: {
        app: {
          volumes: [
            { type: "bind", source: start.checkout, target: start.checkout },
            { type: "volume", source: "office-build-cache", target: BUILD_CACHE_FOLDER },
          ],
          environment: {
            ANDROID_USER_HOME: `${BUILD_CACHE_FOLDER}/android`,
            FLAVOUR: "${OFFICE_VARIABLE_0}",
            SIGNING_TOKEN: "${OFFICE_VARIABLE_1}",
            OFFICE_TEST_INSTANCE: "true",
          },
        },
      },
      volumes: {
        "office-build-cache": {
          name: buildCacheVolumeOf(testbed.folders.instance, "shop"),
          external: true,
        },
      },
    });
    expect(JSON.stringify(override)).not.toContain(SECRET);
    expect(JSON.stringify(override)).not.toContain('"ports"');
    expect(runtime.upped[0]?.variables).toEqual({
      OFFICE_VARIABLE_0: "debug",
      OFFICE_VARIABLE_1: SECRET,
    });
  });

  it("runs the commands before the entry point in order after the cache is given, as the build's user", async () => {
    const start = await build({
      commandsBefore: [
        { name: "Install", commandLine: "npm ci" },
        { name: "Generate", commandLine: "npm run generate" },
      ],
    });
    await writeFiles(start.checkout, {
      ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true, "remoteUser": "vscode" }`,
    });

    expect(await testbed.hostedServices.build(start)).toEqual({ exitCode: 0 });

    const [ownership, install, generate, entryPoint] = runtime.executions;
    expect(ownership?.user).toBe("root");
    expect(install).toMatchObject({
      service: "app",
      user: "vscode",
      variables: {
        OFFICE_VARIABLE_0: "debug",
        OFFICE_VARIABLE_1: SECRET,
        OFFICE_VARIABLE_2: "true",
      },
    });
    expect(install?.script).toMatch(/\nnpm ci$/);
    expect(install?.script).toContain('export OFFICE_TEST_INSTANCE="$OFFICE_VARIABLE_2"');
    expect(install?.script).not.toContain(SECRET);
    expect(install?.timeoutMs).toBeLessThanOrEqual(60_000);
    expect(generate?.script).toMatch(/\nnpm run generate$/);
    expect(entryPoint?.arguments).toEqual(["./gradlew", "assembleDebug", "--offline"]);
    const log = await readFile(start.logFile, "utf8");
    expect(log).toContain("Running the Project's command Install.");
    expect(log).toContain("Running the Project's command Generate.");
  });

  it("refuses the build naming the command that fails, never running the entry point", async () => {
    runtime.onExec = (execution) =>
      Promise.resolve({ exitCode: execution.arguments === undefined ? 2 : 0 });
    const start = await build({ commandsBefore: [{ name: "Install", commandLine: "npm ci" }] });

    await expect(testbed.hostedServices.build(start)).rejects.toMatchObject({
      reasons: ["The Project's command Install ended with exit code 2."],
    });
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("ends the build as timed out when a command before the entry point runs past its time", async () => {
    runtime.onExec = () => Promise.resolve({ exitCode: undefined, endedBy: "timeout" });
    const start = await build({ commandsBefore: [{ name: "Install", commandLine: "npm ci" }] });

    expect(await testbed.hostedServices.build(start)).toEqual({
      exitCode: undefined,
      endedBy: "timeout",
    });
    expect(runtime.executions).toHaveLength(1);
  });

  it("puts the target's own Memory per service on every service of the build", async () => {
    let override = "";
    runtime.onExec = async () => {
      const file = join(testbed.folders.testInstanceFolder(INSTANCE_ID), "office-override.yaml");
      override = await readFile(file, "utf8");
      return { exitCode: 0 };
    };

    await testbed.hostedServices.build(await build({ memoryMegabytes: 2048 }));

    expect(override).toContain("mem_limit: 2048m");
    expect(override).toContain("memswap_limit: 2048m");
  });

  it("keeps the cache volume after the build and through the sweep, for the next build", async () => {
    runtime.onExec = () => Promise.resolve({ exitCode: 3 });

    expect(await testbed.hostedServices.build(await build())).toEqual({ exitCode: 3 });
    await testbed.hostedServices.build(await build());
    await testbed.hostedServices.sweep();

    const volume = buildCacheVolumeOf(testbed.folders.instance, "shop");
    expect(runtime.resources.map(({ id }) => id)).toEqual([volume]);
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("refuses a definition that isn't valid, with its problems, building nothing", async () => {
    const start = await build();
    await writeFiles(start.checkout, { ".devcontainer/devcontainer.json": "{ nope" });

    const refusal = await testbed.hostedServices.build(start).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(RunEnvironmentRefused);
    expect((refusal as RunEnvironmentRefused).reasons[0]).toBe(
      "The run environment definition on this branch isn't valid.",
    );
    expect(runtime.executions).toEqual([]);
  });

  it("ends the build when its signal aborts", async () => {
    const building = new AbortController();
    runtime.onExec = (execution) =>
      new Promise((resolve) => {
        execution.signal?.addEventListener("abort", () =>
          resolve({ exitCode: undefined, endedBy: "stop" }),
        );
        building.abort();
      });

    const ended = await testbed.hostedServices.build(await build({ signal: building.signal }));

    expect(ended).toEqual({ exitCode: undefined, endedBy: "stop" });
    expect(runtime.projects.has(projectName)).toBe(false);
  });
});
