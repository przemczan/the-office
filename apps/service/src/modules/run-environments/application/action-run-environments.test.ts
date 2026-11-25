import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutputMask } from "../../projects/index.js";
import { ScriptedContainerRuntime } from "../adapters/scripted/scripted-container-runtime.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  actionRunProjectNameOf,
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  DEVICE_HELPER_MOUNT,
  handBackScript,
  hostedProjectNameOf,
} from "../domain/run-environment.js";
import type { ActionRunStart, RunningActionEnvironment } from "./action-run-environments.js";
import {
  runEnvironmentsTestbed,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "./run-environments.fixtures.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true }`,
  ".devcontainer/compose.yaml":
    "services:\n  app:\n    image: node:22\n  postgres:\n    image: postgres:17\n    volumes:\n      - data:/var/lib/postgresql/data\nvolumes:\n  data: {}\n",
};

const RUN_ID = "7a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
const SECRET = "s3cret-deploy-token";

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;
let projectName: string;

async function aRun(extra: Partial<ActionRunStart> = {}): Promise<ActionRunStart> {
  const checkout = join(testbed.folder, "action-runs", RUN_ID);
  await writeFiles(checkout, DEFINITION);
  return {
    runId: RUN_ID,
    projectId: "shop",
    checkout,
    commands: [
      { name: "Install", commandLine: "npm ci" },
      { name: "Build web", commandLine: "npm run build" },
    ],
    environment: {
      set: [
        { name: "DEPLOY_TOKEN", value: SECRET },
        { name: "OFFICE_ACTION", value: "build-web" },
      ],
      unset: ["NODE_OPTIONS"],
      prependPath: [],
    },
    installCommand: undefined,
    installInputs: [],
    installVariables: [],
    logFile: join(testbed.folder, "action-runs", `${RUN_ID}.log`),
    mask: new OutputMask([{ name: "DEPLOY_TOKEN", value: SECRET }]),
    timeoutMs: 60_000,
    ...extra,
  };
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS);
  projectName = actionRunProjectNameOf(testbed.folders.instance, RUN_ID);
});

afterEach(async () => {
  await rm(testbed.folder, { recursive: true, force: true });
});

describe("ActionRunEnvironments.run", () => {
  it("runs the commands one after another in the run's own compose project, each named, then removes it", async () => {
    runtime.onExec = () => Promise.resolve({ exitCode: 0, output: `using ${SECRET}\n` });
    const start = await aRun();

    const ended = await testbed.actionRunEnvironments.run(start);

    expect(ended).toEqual({ name: "Build web", exitCode: 0 });
    expect(projectName).toBe(`office-${testbed.folders.instance}-action-${RUN_ID}`);
    expect(runtime.steps).toEqual([
      expect.stringMatching(/^build the-office\/shop:/),
      `up ${projectName}`,
      `ids ${projectName} app`,
      `exec ${projectName}`,
      `exec ${projectName}`,
      `down ${projectName} with built images`,
      expect.stringMatching(/^remove /),
    ]);
    const [install, build] = runtime.executions;
    expect(install).toMatchObject({
      service: "app",
      variables: { OFFICE_VARIABLE_0: SECRET, OFFICE_VARIABLE_1: "build-web" },
    });
    expect(install?.script).toMatch(/\nnpm ci$/);
    expect(install?.script).toContain('export OFFICE_ACTION="$OFFICE_VARIABLE_1"');
    expect(install?.script).not.toContain(SECRET);
    expect(build?.script).toMatch(/\nnpm run build$/);
    const log = await readFile(start.logFile, "utf8");
    expect(log).toContain("Running Install.");
    expect(log).toContain("Running Build web.");
    expect(log).toContain("using [secret DEPLOY_TOKEN]");
    expect(log).not.toContain(SECRET);
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("mounts the checkout alone, publishes nothing, labels it as the run's and puts the limits on every service", async () => {
    let override = "";
    runtime.onExec = async () => {
      override = await readFile(
        join(testbed.folders.actionRunFolder(RUN_ID), "office-override.yaml"),
        "utf8",
      );
      return { exitCode: 0 };
    };
    const start = await aRun();

    await testbed.actionRunEnvironments.run(start);

    expect(override).toContain(`office.action-run: ${RUN_ID}`);
    expect(override).toContain(`source: ${start.checkout}`);
    expect(override).not.toContain("ports:");
    expect(override).not.toContain(DEVICE_HELPER_MOUNT);
    expect(override).not.toContain("office.test-instance");
    expect(override).not.toContain("office.task");
    expect(override).not.toContain(SECRET);
    expect(override.match(/mem_limit: 4096m/g)).toHaveLength(2);
    expect(override).toContain("pids_limit:");
  });

  it("mounts the Office device helper's folder for an Action that names a device", async () => {
    let override = "";
    runtime.onExec = async () => {
      override = await readFile(
        join(testbed.folders.actionRunFolder(RUN_ID), "office-override.yaml"),
        "utf8",
      );
      return { exitCode: 0 };
    };

    await testbed.actionRunEnvironments.run(await aRun({ withDeviceHelper: true }));

    expect(override).toContain(`target: ${DEVICE_HELPER_MOUNT}`);
  });

  it("ends on the first command that doesn't end with 0, never running the next", async () => {
    runtime.onExec = () => Promise.resolve({ exitCode: 2 });

    const ended = await testbed.actionRunEnvironments.run(await aRun());

    expect(ended).toEqual({ name: "Install", exitCode: 2 });
    expect(runtime.executions).toHaveLength(1);
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("ends as timed out when a command runs past the run's time", async () => {
    runtime.onExec = () => Promise.resolve({ exitCode: undefined, endedBy: "timeout" });

    const ended = await testbed.actionRunEnvironments.run(await aRun());

    expect(ended).toEqual({ name: "Install", exitCode: undefined, endedBy: "timeout" });
  });

  it("ends as stopped when stopped meanwhile, removing its project", async () => {
    runtime.onExec = (execution) =>
      new Promise((resolve) => {
        execution.signal?.addEventListener("abort", () =>
          resolve({ exitCode: undefined, endedBy: "stop" }),
        );
        void testbed.actionRunEnvironments.stop(RUN_ID);
      });

    const ended = await testbed.actionRunEnvironments.run(await aRun());

    expect(ended).toEqual({ name: "Install", exitCode: undefined, endedBy: "stop" });
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("refuses a definition that isn't valid, with its problems, running nothing", async () => {
    const start = await aRun();
    await writeFiles(start.checkout, { ".devcontainer/devcontainer.json": "{ nope" });

    const refusal = await testbed.actionRunEnvironments.run(start).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(RunEnvironmentRefused);
    expect((refusal as RunEnvironmentRefused).reasons[0]).toBe(
      "The run environment definition on this branch isn't valid.",
    );
    expect(runtime.executions).toEqual([]);
  });

  it("gives a non-root Office's checkout to the checks' user, and back before it is removed", async () => {
    runtime = new ScriptedContainerRuntime();
    testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS, {
      userId: 1001,
      groupId: 1001,
    });
    runtime.userIds = "1000:1000";
    const start = await aRun();

    await testbed.actionRunEnvironments.run(start);

    const [toChecksUser, , , back] = runtime.executions;
    expect(toChecksUser).toMatchObject({ user: "0:0" });
    expect(toChecksUser?.script).toBe(
      handBackScript(start.checkout, { userId: 1000, groupId: 1000 }),
    );
    expect(back).toMatchObject({ user: "0:0" });
    expect(back?.script).toBe(handBackScript(start.checkout, { userId: 1001, groupId: 1001 }));
  });
});

/** A hook that answers ANDROID_SERIAL and records each step as it comes. */
function holding(
  seen: string[],
  told: RunningActionEnvironment[] = [],
): ActionRunStart["onEnvironment"] {
  return (environment) => {
    told.push(environment);
    seen.push(`held as ${environment.checksUser}`);
    return Promise.resolve({
      variables: [{ name: "ANDROID_SERIAL", value: "R58M123" }],
      release: () => {
        seen.push(`released while ${runtime.projects.has(projectName) ? "up" : "down"}`);
        return Promise.resolve();
      },
    });
  };
}

describe("ActionRunEnvironments.run's onEnvironment", () => {
  it("is told of the running environment before the commands, whose every one gets its variables", async () => {
    const seen: string[] = [];
    const told: RunningActionEnvironment[] = [];
    runtime.userIds = "1000:1000";
    runtime.onExec = (execution) => {
      // The checkout's hand-over runs as root first.
      if (execution.user !== "0:0") seen.push("command");
      return Promise.resolve({ exitCode: 0 });
    };

    await testbed.actionRunEnvironments.run(
      await aRun({ withDeviceHelper: true, onEnvironment: holding(seen, told) }),
    );

    expect(seen).toEqual(["held as 1000:1000", "command", "command", "released while up"]);
    for (const execution of runtime.executions.slice(-2)) {
      expect(execution.variables).toMatchObject({ OFFICE_VARIABLE_2: "R58M123" });
      expect(execution.script).toContain('export ANDROID_SERIAL="$OFFICE_VARIABLE_2"');
      expect(execution.script).not.toContain("R58M123");
    }
    expect(told[0]?.signal.aborted).toBe(true);
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("attaches a program in the definition's service while the run runs, and nothing after", async () => {
    const told: RunningActionEnvironment[] = [];
    let attached: unknown;
    runtime.onExec = async () => {
      attached = await told[0]?.attach({ arguments: ["/office-device-helper/helper", "adb"] });
      return { exitCode: 0 };
    };

    await testbed.actionRunEnvironments.run(
      await aRun({
        commands: [{ name: "Install", commandLine: "npm ci" }],
        onEnvironment: holding([], told),
      }),
    );

    expect(attached).toBe(runtime.attached[0]);
    expect(runtime.attached[0]?.attachment).toMatchObject({
      service: "app",
      arguments: ["/office-device-helper/helper", "adb"],
    });
    expect(await told[0]?.attach({ arguments: ["true"] })).toBeUndefined();
  });

  it("releases before the removal when a command fails", async () => {
    const seen: string[] = [];
    runtime.onExec = () => Promise.resolve({ exitCode: 1 });

    const ended = await testbed.actionRunEnvironments.run(
      await aRun({ onEnvironment: holding(seen) }),
    );

    expect(ended).toEqual({ name: "Install", exitCode: 1 });
    expect(seen).toEqual(["held as 0:0", "released while up"]);
  });

  it("releases before the removal when the run is stopped", async () => {
    const seen: string[] = [];
    const told: RunningActionEnvironment[] = [];
    runtime.onExec = (execution) =>
      new Promise((resolve) => {
        execution.signal?.addEventListener("abort", () =>
          resolve({ exitCode: undefined, endedBy: "stop" }),
        );
        void testbed.actionRunEnvironments.stop(RUN_ID);
      });

    const ended = await testbed.actionRunEnvironments.run(
      await aRun({ onEnvironment: holding(seen, told) }),
    );

    expect(ended).toEqual({ name: "Install", exitCode: undefined, endedBy: "stop" });
    expect(seen).toEqual(["held as 0:0", "released while up"]);
    expect(told[0]?.signal.aborted).toBe(true);
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("ends the run refused in the hook's words, running no command and releasing nothing", async () => {
    const start = await aRun({
      onEnvironment: () =>
        Promise.reject(new RunEnvironmentRefused(["Pixel 8 is in use by the Task Fix login."])),
    });

    const refusal = await testbed.actionRunEnvironments.run(start).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(RunEnvironmentRefused);
    expect((refusal as RunEnvironmentRefused).reasons).toEqual([
      "Pixel 8 is in use by the Task Fix login.",
    ]);
    expect(runtime.executions.filter(({ user }) => user !== "0:0")).toEqual([]);
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("reads the checks' user only for a run with a hook", async () => {
    await testbed.actionRunEnvironments.run(await aRun());

    expect(runtime.steps.filter((step) => step.startsWith("ids "))).toHaveLength(1);
  });
});

describe("ActionRunEnvironments.sweep", () => {
  it("removes every Action run's compose project this Office left, and no Test instance's or run's started since", async () => {
    runtime.keepExecsRunning();
    const running = testbed.actionRunEnvironments.run(await aRun());
    await expect.poll(() => runtime.executions.length).toBe(1);
    const leftId = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";
    const left = actionRunProjectNameOf(testbed.folders.instance, leftId);
    runtime.projects.set(left, {
      project: { name: left, files: [], projectDirectory: "", services: [], variables: {} },
      state: "running",
    });
    runtime.resources.push({
      kind: "container",
      id: `${left}_app`,
      labels: {
        "office.managed": "true",
        "office.instance": testbed.folders.instance,
        "office.action-run": leftId,
      },
    });
    await writeFiles(testbed.folders.actionRunFolder(leftId), { "office-override.yaml": "" });
    const testInstance = hostedProjectNameOf(testbed.folders.instance, "a-test-instance");
    runtime.projects.set(testInstance, {
      project: { name: testInstance, files: [], projectDirectory: "", services: [], variables: {} },
      state: "running",
    });
    runtime.resources.push({
      kind: "container",
      id: `${testInstance}_app`,
      labels: {
        "office.managed": "true",
        "office.instance": testbed.folders.instance,
        "office.test-instance": "a-test-instance",
      },
    });

    await testbed.actionRunEnvironments.sweep();

    expect(runtime.projects.has(left)).toBe(false);
    expect(runtime.resources.some(({ id }) => id === `${left}_app`)).toBe(false);
    await expect(
      readFile(join(testbed.folders.actionRunFolder(leftId), "office-override.yaml")),
    ).rejects.toThrow(/ENOENT/);
    expect(runtime.projects.has(projectName)).toBe(true);
    expect(runtime.projects.has(testInstance)).toBe(true);
    await testbed.actionRunEnvironments.stop(RUN_ID);
    await running;
    expect(runtime.projects.has(projectName)).toBe(false);
  });
});
