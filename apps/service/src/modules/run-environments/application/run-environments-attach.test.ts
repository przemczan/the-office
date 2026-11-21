import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  NO_MASK,
  ScriptedContainerRuntime,
  type ScriptedAttachedProcess,
} from "../adapters/scripted/scripted-container-runtime.js";
import { RunEnvironmentStarted, RunEnvironmentStopped } from "../domain/run-environment-events.js";
import {
  composeProjectNameOf,
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  IDLE_STOP_MS,
  type TaskInWorktree,
} from "../domain/run-environment.js";
import type { RunEnvironmentCommand } from "./run-environments.js";
import {
  runEnvironmentsTestbed,
  taskIn,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "./run-environments.fixtures.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "remoteUser": "node" }`,
  ".devcontainer/compose.yaml":
    "services:\n  app:\n    image: node:22\n    command: sleep infinity\n  postgres:\n    image: postgres:17\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;
let task: TaskInWorktree;
let events: string[];

function command(extra: Partial<RunEnvironmentCommand> = {}): RunEnvironmentCommand {
  return {
    commandLine: "npm test",
    environment: { set: [{ name: "CI", value: "1" }], unset: [], prependPath: [] },
    mask: NO_MASK,
    timeoutMs: 60_000,
    outputFile: join(testbed.folder, "output", "check"),
    ...extra,
  };
}

function projectName(): string {
  return composeProjectNameOf(testbed.folders.instance, task.taskId);
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS);
  task = taskIn(testbed, "task-1");
  await writeFiles(task.worktree, DEFINITION);
  events = [];
  testbed.events.subscribe(RunEnvironmentStarted, ({ taskId, projectId }) => {
    events.push(`started ${taskId} ${projectId}`);
  });
  testbed.events.subscribe(RunEnvironmentStopped, ({ taskId }) => {
    events.push(`stopped ${taskId}`);
  });
});

afterEach(async () => {
  await rm(testbed.folder, { recursive: true, force: true });
});

describe("RunEnvironmentStarted and RunEnvironmentStopped", () => {
  it("is published at the first start, at the idle stop, and at the start after it", async () => {
    await testbed.environments.run(task, command());
    expect(events).toEqual(["started task-1 shop"]);

    await testbed.schedule.advanceBy(IDLE_STOP_MS);
    expect(events).toEqual(["started task-1 shop", "stopped task-1"]);

    await testbed.environments.run(task, command());
    expect(events).toEqual(["started task-1 shop", "stopped task-1", "started task-1 shop"]);
  });

  it("runs a Started handler before the check, and it can attach while the start holds the step", async () => {
    let attached: ScriptedAttachedProcess | undefined;
    runtime.onAttach = (process) => {
      attached = process;
    };
    testbed.events.subscribe(RunEnvironmentStarted, async ({ taskId }) => {
      await testbed.environments.attach(taskId, { arguments: ["office-device-helper", "relay"] });
      events.push("attached");
    });
    runtime.onExec = () => {
      events.push("check");
      return Promise.resolve({ exitCode: 0 });
    };

    await testbed.environments.run(task, command());

    expect(events).toEqual(["started task-1 shop", "attached", "check"]);
    expect(attached).toBeDefined();
  });

  it("is published as the startup sweep stops an open Task's run environment", async () => {
    await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));
    testbed.knownTasks.tasks = [{ id: "task-1", title: "Task task-1", state: "in-progress" }];
    events = [];

    await testbed.environments.sweep();

    expect(events).toEqual(["stopped task-1"]);
  });
});

describe("RunEnvironments.attach", () => {
  it("answers nothing while the Task's run environment isn't running, starting none", async () => {
    expect(await testbed.environments.attach("task-1", { arguments: ["true"] })).toBeUndefined();
    expect(runtime.steps).toEqual([]);
  });

  it("pipes the program's input and output in the checks' service as its user, and a stop restarts nothing", async () => {
    await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));
    const steps = runtime.steps.length;

    const attached = await testbed.environments.attach("task-1", {
      arguments: ["/office-device-helper/office-device-helper-x86_64", "relay"],
    });
    const [scripted] = runtime.attached;
    const output: Buffer[] = [];
    attached?.stdout.on("data", (chunk: Buffer) => void output.push(chunk));
    attached?.stdin.write("to the helper");
    scripted?.print("from the helper");
    attached?.stop();

    expect(await attached?.ended).toEqual({ exitCode: undefined, endedBy: "stop" });
    expect(scripted?.attachment).toEqual({
      service: "app",
      user: "node",
      arguments: ["/office-device-helper/office-device-helper-x86_64", "relay"],
      errorFile: join(testbed.folders.taskFolder("task-1"), "attached.log"),
    });
    expect(scripted?.written().toString()).toBe("to the helper");
    expect(Buffer.concat(output).toString()).toBe("from the helper");
    expect(runtime.steps.slice(steps)).toEqual([`attach ${projectName()}`]);
    expect(runtime.projects.get(projectName())?.state).toBe("running");
  });

  it("runs as root when asked, and its program ends as the run environment stops", async () => {
    await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));
    const attached = await testbed.environments.attach("task-1", {
      arguments: ["helper", "serial"],
      asRoot: true,
    });

    await testbed.schedule.advanceBy(IDLE_STOP_MS);

    expect(runtime.attached[0]?.attachment.user).toBe("0:0");
    expect(await attached?.ended).toEqual({ exitCode: 137 });
  });

  it("never holds off the idle stop: an attached program isn't a check", async () => {
    await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));
    await testbed.environments.attach("task-1", { arguments: ["helper"] });

    await testbed.schedule.advanceBy(IDLE_STOP_MS);

    expect(runtime.projects.get(projectName())?.state).toBe("stopped");
  });
});

describe("RunEnvironmentCommandVariables", () => {
  it("gives a check each registered variable by its carrier, read again at every check", async () => {
    let devices = "phone-1";
    testbed.commandVariables.register((taskId) =>
      Promise.resolve([{ name: "OFFICE_CONNECTED_DEVICES", value: `${taskId}:${devices}` }]),
    );

    await testbed.environments.run(task, command());
    devices = "phone-2";
    await testbed.environments.run(task, command());

    const [first, second] = runtime.executions;
    expect(first?.variables).toEqual({
      OFFICE_VARIABLE_0: "1",
      OFFICE_VARIABLE_1: "task-1:phone-1",
    });
    expect(first?.script).toContain('export OFFICE_CONNECTED_DEVICES="$OFFICE_VARIABLE_1"');
    expect(first?.script).not.toContain("phone-1");
    expect(second?.variables).toHaveProperty("OFFICE_VARIABLE_1", "task-1:phone-2");
  });

  it("runs the check without a source that fails", async () => {
    testbed.commandVariables.register(() => Promise.reject(new Error("Devices is down.")));

    const end = await testbed.environments.run(task, command());

    expect(end).toMatchObject({ exitCode: 0 });
    expect(runtime.executions[0]?.variables).toEqual({ OFFICE_VARIABLE_0: "1" });
  });

  it("isn't given to the non-root Office's hand-back", async () => {
    await rm(testbed.folder, { recursive: true, force: true });
    testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS, {
      userId: 1000,
      groupId: 1000,
    });
    task = taskIn(testbed, "task-1");
    await writeFiles(task.worktree, DEFINITION);
    testbed.commandVariables.register(() => Promise.resolve([{ name: "DEVICES", value: "x" }]));

    await testbed.environments.run(task, command());

    expect(runtime.executions[1]).toMatchObject({ user: "0:0", variables: {} });
  });
});

describe("The device helper's mount", () => {
  it("mounts the helper's folder read-only at /office-device-helper on the checks' service alone, made before up", async () => {
    const up = runtime.up.bind(runtime);
    let madeBeforeUp = false;
    runtime.up = async (project, outputFile) => {
      madeBeforeUp = (await stat(testbed.folders.deviceHelper)).isDirectory();
      return up(project, outputFile);
    };

    await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));

    const override = parseYaml(
      await readFile(join(testbed.folders.taskFolder("task-1"), "office-override.yaml"), "utf8"),
    ) as { services: Record<string, { volumes?: unknown[]; ports?: unknown }> };
    expect(madeBeforeUp).toBe(true);
    expect(override.services.app?.volumes).toContainEqual({
      type: "bind",
      source: testbed.folders.deviceHelper,
      target: "/office-device-helper",
      read_only: true,
    });
    expect(override.services.postgres?.volumes).toBeUndefined();
    expect(override.services.app?.ports).toBeUndefined();
  });
});
