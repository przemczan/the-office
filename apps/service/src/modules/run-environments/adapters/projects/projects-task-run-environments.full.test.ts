import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OutputMask,
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
import { ScriptedContainerRuntime } from "../scripted/scripted-container-runtime.js";
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
    testbed.setUpTasks,
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
    repositoryGitFolder: join(testbed.folder, "repository", ".git"),
    stageRunsFolder: join(testbed.folder, "stage-runs", taskId),
    installCommand: "npm ci",
    installInputs: ["package-lock.json"],
    installVariables: [],
  };
}

function aCommand(fields: Partial<TaskRunEnvironmentCommand> = {}): TaskRunEnvironmentCommand {
  return {
    commandLine: "npm test",
    environment: {
      set: [{ name: "CI", value: "1", secret: false }],
      unset: ["HOME"],
      prependPath: [],
    },
    mask: OutputMask.NONE,
    timeoutMs: 60_000,
    ...fields,
  };
}

describe("Projects' run environments", () => {
  it("streams the command's output to the file given, replacing what it held, and keeps it", async () => {
    const task = await aTask("task-1");
    const outputFile = join(testbed.folder, "sessions", "s-1", "office-tools", "command.log");
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, "an earlier run's\n");
    runtime.onExec = () => Promise.resolve({ output: "1 passed\n", exitCode: 0 });

    const finished = await registry.run(task, aCommand({ outputFile }));

    expect(finished).toMatchObject({ outcome: "passed", output: "1 passed\n" });
    await expect(readFile(outputFile, "utf8")).resolves.toBe("1 passed\n");
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
