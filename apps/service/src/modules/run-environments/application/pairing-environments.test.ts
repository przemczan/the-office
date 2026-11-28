import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { ScriptedContainerRuntime } from "../adapters/scripted/scripted-container-runtime.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  DEVICE_HELPER_MOUNT,
  hostedProjectNameOf,
  LABEL,
  pairingProjectNameOf,
  ROOT_USER,
} from "../domain/run-environment.js";
import type { PairingEnvironmentStart } from "./pairing-environments.js";
import {
  restartedTestbed,
  runEnvironmentsTestbed,
  taskIn,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "./run-environments.fixtures.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true, "remoteUser": "node" }`,
  ".devcontainer/compose.yaml":
    "services:\n  app:\n    image: node:22\n  emulator:\n    image: busybox:1.37.0\n",
};

const DEVICE_ID = "3a9d1c2b-7e4f-4a6b-8c5d-9e0f1a2b3c4d";

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;
let projectName: string;

async function pairing(
  extra: Partial<PairingEnvironmentStart> = {},
): Promise<PairingEnvironmentStart> {
  const definitionFolder = join(testbed.folder, "exported", DEVICE_ID);
  await writeFiles(definitionFolder, DEFINITION);
  return {
    projectId: "shop",
    deviceId: DEVICE_ID,
    definitionFolder,
    logFile: join(testbed.folder, "logs", `${DEVICE_ID}.log`),
    ...extra,
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function overrideFile(): string {
  return join(testbed.folders.pairingFolder(DEVICE_ID), "office-override.yaml");
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  testbed = await runEnvironmentsTestbed(runtime);
  projectName = pairingProjectNameOf(testbed.folders.instance, DEVICE_ID);
});

afterEach(async () => {
  await rm(testbed.folder, { recursive: true, force: true });
});

describe("PairingEnvironments.start", () => {
  it("ups its own compose project over the definition, with the helper mounted and no checkout or port", async () => {
    const start = await pairing();

    await testbed.pairingEnvironments.start(start);

    expect(projectName).toBe(`office-${testbed.folders.instance}-pairing-${DEVICE_ID}`);
    expect(runtime.steps).toEqual([
      expect.stringMatching(/^build the-office\/shop:/),
      `up ${projectName}`,
    ]);
    expect(runtime.upped[0]).toMatchObject({
      name: projectName,
      files: [join(start.definitionFolder, ".devcontainer/compose.yaml"), overrideFile()],
      projectDirectory: join(start.definitionFolder, ".devcontainer"),
      services: ["app", "emulator"],
    });
    const override = parseYaml(await readFile(overrideFile(), "utf8")) as {
      services: Record<string, Record<string, unknown>>;
    };
    const app = override.services.app ?? {};
    expect(app.volumes).toEqual([
      {
        type: "bind",
        source: testbed.folders.deviceHelper,
        target: DEVICE_HELPER_MOUNT,
        read_only: true,
      },
    ]);
    expect(app.working_dir).toBeUndefined();
    expect(app.labels).toEqual({
      [LABEL.managed]: "true",
      [LABEL.instance]: testbed.folders.instance,
      [LABEL.pairing]: DEVICE_ID,
      [LABEL.project]: "shop",
    });
    expect(override.services.emulator?.labels).toEqual(app.labels);
    expect(override.services.emulator?.volumes).toBeUndefined();
    for (const service of Object.values(override.services)) {
      expect(service.ports).toBeUndefined();
      expect(service.mem_limit).toBe("4096m");
    }
    expect(await exists(testbed.folders.deviceHelper)).toBe(true);
  });

  it("builds the definition's image without the Project's install command", async () => {
    await testbed.pairingEnvironments.start(await pairing());

    const install = runtime.builds.at(-1);
    expect(install?.image).toMatch(/^the-office\/shop:/);
    expect(install?.secrets).toEqual({});
  });

  it("refuses a definition that isn't valid in words, leaving nothing behind", async () => {
    const start = await pairing();
    await writeFiles(start.definitionFolder, { ".devcontainer/devcontainer.json": "{" });

    const refused = await testbed.pairingEnvironments.start(start).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(RunEnvironmentRefused);
    expect((refused as RunEnvironmentRefused).reasons[0]).toBe(
      "The run environment definition on the base branch isn't valid.",
    );
    expect(runtime.upped).toEqual([]);
    expect(await exists(testbed.folders.pairingFolder(DEVICE_ID))).toBe(false);
  });

  it("removes what it made when the compose project can't start", async () => {
    runtime.failing.add("up");

    const refused = await testbed.pairingEnvironments
      .start(await pairing())
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(RunEnvironmentRefused);
    expect((refused as RunEnvironmentRefused).reasons[0]).toBe(
      "The pairing environment couldn't start.",
    );
    expect(runtime.steps).toContain(`down ${projectName} with built images`);
    expect(await exists(testbed.folders.pairingFolder(DEVICE_ID))).toBe(false);
    // Removed, so the device can pair again.
    await expect(testbed.pairingEnvironments.start(await pairing())).resolves.toBeDefined();
  });

  it("refuses as stopped once its signal aborts, removing what it made", async () => {
    const stopping = new AbortController();
    stopping.abort();

    await expect(
      testbed.pairingEnvironments.start(await pairing({ signal: stopping.signal })),
    ).rejects.toThrow("The pairing was stopped.");
    expect(runtime.upped).toEqual([]);
  });

  it("refuses a second start for the same device while the first runs", async () => {
    await testbed.pairingEnvironments.start(await pairing());

    await expect(testbed.pairingEnvironments.start(await pairing())).rejects.toBeInstanceOf(
      RunEnvironmentRefused,
    );
  });
});

describe("PairingEnvironment.attach", () => {
  it("runs the program in the definition's service as its user, through the runtime's onAttach", async () => {
    const start = await pairing();
    const seen: string[][] = [];
    runtime.onAttach = (process) => void seen.push([...process.attachment.arguments]);
    const environment = await testbed.pairingEnvironments.start(start);

    const attached = await environment.attach({ arguments: ["/office-device-helper/x", "adb"] });

    expect(seen).toEqual([["/office-device-helper/x", "adb"]]);
    expect(runtime.attached[0]).toMatchObject({
      projectName,
      attachment: {
        service: "app",
        user: "node",
        arguments: ["/office-device-helper/x", "adb"],
        errorFile: start.logFile,
      },
    });
    expect(attached).toBe(runtime.attached[0]);
  });

  it("runs as root with asRoot, its standard error where the caller says", async () => {
    const environment = await testbed.pairingEnvironments.start(await pairing());
    const logFile = join(testbed.folder, "adb-key.log");

    await environment.attach({ arguments: ["true"], asRoot: true, logFile });

    expect(runtime.attached[0]?.attachment).toMatchObject({ user: ROOT_USER, errorFile: logFile });
  });

  it("refuses once the environment is removed", async () => {
    const environment = await testbed.pairingEnvironments.start(await pairing());
    await environment.remove();

    await expect(environment.attach({ arguments: ["true"] })).rejects.toBeInstanceOf(
      RunEnvironmentRefused,
    );
  });
});

describe("PairingEnvironment.remove", () => {
  it("takes the project down, removes by its label and its files, and ends what is attached", async () => {
    const environment = await testbed.pairingEnvironments.start(await pairing());
    const attached = await environment.attach({ arguments: ["true"] });

    await environment.remove();

    expect(runtime.steps.slice(-2)).toEqual([
      `down ${projectName} with built images`,
      `remove ${JSON.stringify({
        "office.managed": "true",
        "office.instance": testbed.folders.instance,
        [LABEL.pairing]: DEVICE_ID,
      })}`,
    ]);
    expect(runtime.projects.has(projectName)).toBe(false);
    expect(runtime.resources).toEqual([]);
    expect(await exists(testbed.folders.pairingFolder(DEVICE_ID))).toBe(false);
    await expect(attached.ended).resolves.toMatchObject({ exitCode: 137 });
  });

  it("never throws, even when the runtime's down fails, and is done once", async () => {
    const environment = await testbed.pairingEnvironments.start(await pairing());
    runtime.down = () => Promise.reject(new Error("down failed"));

    await expect(environment.remove()).resolves.toBeUndefined();
    await expect(environment.remove()).resolves.toBeUndefined();
    expect(runtime.steps.filter((step) => step.startsWith("remove "))).toHaveLength(1);
  });
});

describe("PairingEnvironments.sweep", () => {
  it("removes this Office's pairing environments left behind and leaves Task environments and Test instances alone", async () => {
    const instance = testbed.folders.instance;
    await testbed.pairingEnvironments.start(await pairing());
    const task = taskIn(testbed, "task-1");
    await writeFiles(task.worktree, { ...DEFINITION, "package-lock.json": "{}" });
    await testbed.environments.prepare(task, join(testbed.folder, "task.log"));
    const hosted = hostedProjectNameOf(instance, "6f1d2c3b");
    runtime.leave({
      kind: "container",
      id: `${hosted}_app`,
      labels: {
        "office.managed": "true",
        "office.instance": instance,
        [LABEL.testInstance]: "6f1d2c3b",
      },
    });
    runtime.leave({
      kind: "volume",
      id: "another-office-pairing",
      labels: {
        "office.managed": "true",
        "office.instance": "another",
        [LABEL.pairing]: DEVICE_ID,
      },
    });

    await (await restartedTestbed(testbed, runtime)).pairingEnvironments.sweep();

    expect(runtime.projects.has(projectName)).toBe(false);
    expect(runtime.resources.map(({ id }) => id).toSorted()).toEqual(
      [
        `${hosted}_app`,
        "another-office-pairing",
        ...runtime.resources
          .filter(({ labels }) => labels[LABEL.task] === "task-1")
          .map(({ id }) => id),
      ].toSorted(),
    );
    expect(runtime.resources.some(({ labels }) => labels[LABEL.task] === "task-1")).toBe(true);
    expect(await exists(testbed.folders.pairingFolder(DEVICE_ID))).toBe(false);
    expect(await exists(testbed.folders.taskFolder("task-1"))).toBe(true);
  });

  it("leaves a pairing started since the service started running", async () => {
    const environment = await testbed.pairingEnvironments.start(await pairing());

    await testbed.pairingEnvironments.sweep();

    expect(runtime.projects.get(projectName)?.state).toBe("running");
    await expect(environment.attach({ arguments: ["true"] })).resolves.toBeDefined();
  });

  it("removes one the down of which fails by its labels, and the files of one with no resource left", async () => {
    await testbed.pairingEnvironments.start(await pairing());
    const restarted = await restartedTestbed(testbed, runtime);
    const filesOnly = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
    await mkdir(testbed.folders.pairingFolder(filesOnly), { recursive: true });
    runtime.failing.add("down");

    await restarted.pairingEnvironments.sweep();

    expect(runtime.steps).toContain(
      `remove ${JSON.stringify({
        "office.managed": "true",
        "office.instance": testbed.folders.instance,
        [LABEL.pairing]: DEVICE_ID,
      })}`,
    );
    expect(runtime.resources).toEqual([]);
    expect(await exists(testbed.folders.pairingFolder(DEVICE_ID))).toBe(false);
    expect(await exists(testbed.folders.pairingFolder(filesOnly))).toBe(false);
  });
});
