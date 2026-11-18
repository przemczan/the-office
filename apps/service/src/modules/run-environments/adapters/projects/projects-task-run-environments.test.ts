import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
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
  it("runs the command in the Task's run environment with only the Project's variables, its output read back", async () => {
    const task = await aTask("task-1");
    let script = "";
    let variables = {};
    runtime.onExec = (execution) => {
      script = execution.script;
      variables = execution.variables;
      return Promise.resolve({ output: "FAIL renames a device\n", exitCode: 1 });
    };

    const finished = await registry.run(task, aCommand());

    expect(finished).toMatchObject({
      outcome: "failed",
      exitCode: 1,
      output: "FAIL renames a device\n",
      droppedOutputBytes: 0,
    });
    expect(script).toBe(
      [
        `cd '${task.worktree}' || exit 125`,
        "unset 'HOME'",
        'export CI="$OFFICE_VARIABLE_0"',
        "unset OFFICE_VARIABLE_0",
        "npm test",
      ].join("\n"),
    );
    expect(variables).toEqual({ OFFICE_VARIABLE_0: "1" });
    // Its output folder goes with the run.
    expect(await readdir(testbed.folders.commandOutputs)).toEqual([]);
  });

  it("mounts the git folder Projects names, read-only", async () => {
    const task = await aTask("task-1");

    await registry.run(task, aCommand());

    const [started] = [...runtime.projects.values()];
    const override = parseYaml(await readFile(started?.project.files.at(-1) ?? "", "utf8"));
    expect(override).toHaveProperty("services.app.volumes.1", {
      type: "bind",
      source: task.repositoryGitFolder,
      target: task.repositoryGitFolder,
      read_only: true,
    });
  });

  it("mounts the Task's Stage runs' folder read-only at its own path, never the file", async () => {
    const task = await aTask("task-1");

    await registry.run(task, aCommand());

    const [started] = [...runtime.projects.values()];
    const override = parseYaml(await readFile(started?.project.files.at(-1) ?? "", "utf8"));
    expect(override).toHaveProperty("services.app.volumes.2", {
      type: "bind",
      source: task.stageRunsFolder,
      target: task.stageRunsFolder,
      read_only: true,
    });
  });

  it("runs a condition command in a run environment started with the Stage runs' folder", async () => {
    const task = await aTask("task-1");
    await registry.run(task, aCommand());

    const finished = await registry.run(task, aCommand({ readsStageRuns: true }));

    expect(finished).toMatchObject({ outcome: "passed", exitCode: 0 });
  });

  it("runs no condition command in a run environment already up without the folder, saying to stop and start it", async () => {
    const task = await aTask("task-1");
    // Up as one started before the folder was mounted: with another folder than the Task's now.
    await registry.run(task, aCommand());
    let execs = 0;
    runtime.onExec = () => {
      execs += 1;
      return Promise.resolve({ exitCode: 0 });
    };

    const finished = await registry.run(
      { ...task, stageRunsFolder: join(testbed.folder, "stage-runs-now", task.taskId) },
      aCommand({ readsStageRuns: true }),
    );

    expect(finished).toEqual({
      outcome: "could-not-run",
      exitCode: undefined,
      durationMs: 0,
      output:
        "The run environment started before condition commands could read their file; stop and start the Task's run environment.",
      droppedOutputBytes: 0,
    });
    expect(execs).toBe(0);
  });

  it("hides a Secret variable in the output file as it streams, and in the output read back", async () => {
    const task = await aTask("task-1");
    const outputFile = join(testbed.folder, "sessions", "s-1", "office-tools", "token.log");
    runtime.onExec = () => Promise.resolve({ output: "token: npm_s3cret\n", exitCode: 0 });

    const finished = await registry.run(
      task,
      aCommand({ outputFile, mask: new OutputMask([{ name: "NPM_TOKEN", value: "npm_s3cret" }]) }),
    );

    expect(finished).toMatchObject({ output: "token: [secret NPM_TOKEN]\n" });
    await expect(readFile(outputFile, "utf8")).resolves.toBe("token: [secret NPM_TOKEN]\n");
  });

  it("builds the image with the Project's variables as secrets, none of their values in the build", async () => {
    const task = {
      ...(await aTask("task-1")),
      installVariables: [
        { name: "CI", value: "1", secret: false },
        { name: "NPM_TOKEN", value: "npm_s3cret", secret: true },
      ],
    };

    await registry.run(task, aCommand());

    const install = runtime.builds.find(({ dockerfile }) => dockerfile === "Dockerfile");
    expect(install?.secrets).toEqual({ OFFICE_VARIABLE_0: "1", OFFICE_VARIABLE_1: "npm_s3cret" });
    expect(install?.args).toEqual({});
    expect(install?.image).not.toContain("npm_s3cret");
  });
});
