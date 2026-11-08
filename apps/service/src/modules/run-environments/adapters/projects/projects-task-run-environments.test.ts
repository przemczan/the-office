import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskRunEnvironments,
  type TaskInRunEnvironment,
  type TaskRunEnvironmentCommand,
} from "../../../projects/index.js";
import {
  runEnvironmentsTestbed,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "../../application/run-environments.fixtures.js";
import { DEFAULT_RUN_ENVIRONMENT_OPTIONS } from "../../domain/run-environment.js";
import { ScriptedContainerRuntime } from "../scripted/scripted-container-runtime.fixtures.js";
import { ProjectsTaskRunEnvironments } from "./projects-task-run-environments.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app" }`,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: node:22\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;
let registry: TaskRunEnvironments;

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  testbed = await runEnvironmentsTestbed(runtime, {
    ...DEFAULT_RUN_ENVIRONMENT_OPTIONS,
    runEnvironmentsAtOnce: 1,
  });
  registry = new TaskRunEnvironments();
  new ProjectsTaskRunEnvironments(
    registry,
    testbed.environments,
    testbed.knownTasks,
    testbed.folders,
  ).onModuleInit();
});

afterEach(async () => {
  await rm(testbed.folder, { recursive: true, force: true });
});

async function aTask(taskId: string): Promise<TaskInRunEnvironment> {
  testbed.knownTasks.tasks.push({ id: taskId, title: `Task ${taskId}`, state: "in-progress" });
  const worktree = join(testbed.folder, "worktrees", taskId);
  await writeFiles(worktree, DEFINITION);
  return {
    taskId,
    projectId: "shop",
    worktree,
    installCommand: "npm ci",
    installInputs: ["package-lock.json"],
  };
}

function aCommand(fields: Partial<TaskRunEnvironmentCommand> = {}): TaskRunEnvironmentCommand {
  return {
    commandLine: "npm test",
    environment: { set: [{ name: "CI", value: "1" }], unset: ["HOME"], prependPath: [] },
    timeoutMs: 60_000,
    ...fields,
  };
}

describe("Projects' run environments", () => {
  it("runs the command in the Task's run environment with only the Project's variables, its output read back", async () => {
    const task = await aTask("task-1");
    let script = "";
    runtime.onExec = (execution) => {
      script = execution.script;
      return Promise.resolve({ output: "FAIL renames a device\n", exitCode: 1 });
    };

    const finished = await registry.run(task, aCommand());

    expect(finished).toMatchObject({
      outcome: "failed",
      exitCode: 1,
      output: "FAIL renames a device\n",
      droppedOutputBytes: 0,
    });
    expect(script).toBe(`cd '${task.worktree}' || exit 125\nunset 'HOME'\nexport CI='1'\nnpm test`);
    // Its output folder goes with the run.
    expect(await readdir(testbed.folders.commandOutputs)).toEqual([]);
  });

  it("names the image the Task's commands run in by its key, a new one when an Install input changes", async () => {
    const task = await aTask("task-1");
    const first = await registry.imageOf(task);

    await writeFiles(task.worktree, { "package-lock.json": '{ "lockfileVersion": 4 }' });

    expect(first).toMatch(/^the-office\/shop:/);
    expect(await registry.imageOf(task)).not.toBe(first);
    expect(runtime.builds).toEqual([]);
  });

  it("gives a run environment that couldn't start as a command that couldn't run, with why", async () => {
    const task = await aTask("task-1");
    runtime.failing.add("build");

    const finished = await registry.run(task, aCommand());

    expect(finished.outcome).toBe("could-not-run");
    expect(finished.output).toContain("The run environment's image couldn't be built.");
    expect(runtime.steps.some((step) => step.startsWith("exec"))).toBe(false);
  });

  it("ends a wait stopped as stopped, telling the wait's start and end, with nothing run", async () => {
    const first = await aTask("task-1");
    const second = await aTask("task-2");
    await registry.run(first, aCommand());
    const stop = new AbortController();
    const wait = {
      started: vi.fn<() => Promise<void>>(() => {
        stop.abort();
        return Promise.resolve();
      }),
      ended: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };

    const finished = await registry.run(second, aCommand({ signal: stop.signal, wait }));

    expect(finished).toEqual({
      outcome: "stopped",
      exitCode: undefined,
      durationMs: 0,
      output: "",
      droppedOutputBytes: 0,
    });
    expect(wait.started).toHaveBeenCalledOnce();
    expect(wait.ended).toHaveBeenCalledOnce();
    expect(runtime.steps.filter((step) => step.startsWith("exec"))).toHaveLength(1);
  });
});
