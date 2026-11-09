import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { AgentCommands } from "./agent-commands.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";
import { ScriptedTaskRunEnvironments } from "./task-run-environments.fixtures.js";
import { Worktrees } from "./worktrees.js";

// Real git and real commands in a Task's worktree of a temporary repository.
let repository: TemporaryRepository;
let worktrees: Worktrees;
let agentCommands: AgentCommands;
let runEnvironments: ScriptedTaskRunEnvironments;
let taskCount = 0;

/** Prints a line, writes a file into the worktree, and exits with EXIT_CODE. */
const CHECK = `const fs = require("fs");
console.log("checked " + (process.argv[2] ?? "everything"));
fs.writeFileSync("checked.txt", "by the check\\n");
process.exit(Number(process.env.EXIT_CODE ?? 0));
`;

/** Notes each install in INSTALL_LOG, failing when INSTALL_FAILS is set. */
const INSTALL = `const fs = require("fs");
fs.appendFileSync(process.env.INSTALL_LOG, "installed\\n");
console.log("installing");
if (process.env.INSTALL_FAILS === "yes") { console.log("npm ERR! missing lockfile"); process.exit(1); }
`;

/**
 * Starts a process that holds its output open, writes its id to the file named first, prints a
 * line and sleeps, as a hung test run does.
 */
const HANG = `const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const left = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "inherit" });
console.log("started " + left.pid);
writeFileSync(process.argv[2], String(left.pid));
`;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  await writeFile(join(repository.folder, "check.cjs"), CHECK);
  await writeFile(join(repository.folder, "install.cjs"), INSTALL);
  await writeFile(join(repository.folder, "hang.cjs"), HANG);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  const officeData = new OfficeDataDirectory(join(repository.folder, "office-data"));
  runEnvironments = new ScriptedTaskRunEnvironments(new ShellCommandRunner());
  const taskCommands = taskCommandsOver(commands, runEnvironments.registry());
  worktrees = new Worktrees(
    new CommandLineGit(new RepositoryLocks(), officeIdentityForTests()),
    commands,
    taskCommands,
    officeData,
  );
  agentCommands = new AgentCommands(worktrees, taskCommands);
});

afterAll(async () => {
  await repository.remove();
});

interface ATask {
  readonly project: Project;
  readonly taskId: string;
  readonly installLog: string;
}

/** A started Task's worktree of a Project whose test command runs the check. */
async function aTask({
  commands = {},
  variables = {},
  runEnvironment = "not-decided",
}: {
  readonly commands?: Partial<Project["commands"]>;
  readonly variables?: Readonly<Record<string, string>>;
  readonly runEnvironment?: Project["runEnvironment"];
} = {}): Promise<ATask> {
  taskCount += 1;
  const taskId = `agent-task-${taskCount}`;
  const installLog = join(repository.folder, `${taskId}-install.log`);
  const project = aProject({
    path: repository.path,
    commands: {
      install: `node "${join(repository.folder, "install.cjs")}"`,
      build: "",
      lint: "",
      test: `node "${join(repository.folder, "check.cjs")}"`,
      ...commands,
    },
    installInputs: [],
    environment: {
      set: Object.entries({ INSTALL_LOG: installLog, ...variables }).map(([name, value]) => ({
        name,
        value,
        secret: false,
      })),
      unset: [],
      prependPath: [],
    },
    runEnvironment,
  });
  await writeFile(installLog, "");
  return { project, taskId, installLog };
}

async function worktreeHas({ project, taskId }: ATask, path: string): Promise<boolean> {
  return (
    (await readFile(join(worktrees.pathOf(project, taskId), path)).catch(() => undefined)) !==
    undefined
  );
}

/** Whether the process is still running, after giving it a moment to end. */
async function isRunning(processId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      process.kill(processId, 0);
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

function outputFileOf(taskId: string): string {
  return join(repository.folder, "sessions", taskId, "office-tools", "command.log");
}

function options(taskId: string, signal = new AbortController().signal) {
  return { signal, outputFile: outputFileOf(taskId) };
}

async function installs(task: ATask): Promise<number> {
  return (await readFile(task.installLog, "utf8")).split("\n").filter(Boolean).length;
}

describe("AgentCommands.run", REAL_GIT_TEST, () => {
  it("runs one of the Project's commands by its key, its whole output in the file, and leaves what it wrote in the worktree", async () => {
    const task = await aTask();

    const end = await agentCommands.run(
      task.project,
      task.taskId,
      { key: "test" },
      options(task.taskId),
    );

    expect(end).toMatchObject({ kind: "ran", run: { outcome: "passed", exitCode: 0 } });
    await expect(readFile(outputFileOf(task.taskId), "utf8")).resolves.toBe("checked everything\n");
    await expect(
      readFile(join(worktrees.pathOf(task.project, task.taskId), "checked.txt"), "utf8"),
    ).resolves.toBe("by the check\n");
  });

  it("runs a command line as written in the worktree's root, and gives its exit code", async () => {
    const task = await aTask({ variables: { EXIT_CODE: "3" } });
    const commandLine = `node "${join(repository.folder, "check.cjs")}" src/one.test.ts`;

    const end = await agentCommands.run(
      task.project,
      task.taskId,
      { commandLine },
      options(task.taskId),
    );

    expect(end).toMatchObject({
      kind: "ran",
      run: { commandLine, outcome: "failed", exitCode: 3 },
    });
    await expect(readFile(outputFileOf(task.taskId), "utf8")).resolves.toBe(
      "checked src/one.test.ts\n",
    );
  });

  it("runs a command line in the Bash its Office rules judged it as, on every platform", async () => {
    const task = await aTask();

    const end = await agentCommands.run(
      task.project,
      task.taskId,
      { commandLine: 'echo "bash ${BASH_VERSINFO[0]}"' },
      options(task.taskId),
    );

    expect(end).toMatchObject({ kind: "ran", run: { outcome: "passed" } });
    await expect(readFile(outputFileOf(task.taskId), "utf8")).resolves.toMatch(/^bash \d+\n$/);
  });

  it("runs nothing for a key the Project has no command for", async () => {
    const task = await aTask();

    await expect(
      agentCommands.run(task.project, task.taskId, { key: "lint" }, options(task.taskId)),
    ).resolves.toEqual({ kind: "no-command" });
    expect(await installs(task)).toBe(0);
  });

  it("installs first when the install hasn't passed with these inputs, and only then", async () => {
    const task = await aTask();

    await agentCommands.run(task.project, task.taskId, { key: "test" }, options(task.taskId));
    await agentCommands.run(task.project, task.taskId, { key: "test" }, options(task.taskId));

    expect(await installs(task)).toBe(1);
  });

  it("runs the install when asked by its key, though it is up to date", async () => {
    const task = await aTask();
    await agentCommands.run(task.project, task.taskId, { key: "test" }, options(task.taskId));

    const end = await agentCommands.run(
      task.project,
      task.taskId,
      { key: "install" },
      options(task.taskId),
    );

    expect(end).toMatchObject({ kind: "ran", run: { outcome: "passed" } });
    expect(await installs(task)).toBe(2);
  });

  it("runs nothing when the install before it fails, its output in the file", async () => {
    const task = await aTask({ variables: { INSTALL_FAILS: "yes" } });

    const end = await agentCommands.run(
      task.project,
      task.taskId,
      { key: "test" },
      options(task.taskId),
    );

    expect(end).toMatchObject({ kind: "install-failed", run: { outcome: "failed", exitCode: 1 } });
    await expect(readFile(outputFileOf(task.taskId), "utf8")).resolves.toContain(
      "npm ERR! missing lockfile",
    );
    expect(await worktreeHas(task, "checked.txt")).toBe(false);
  });

  it("ends a stopped command with every process it started, its output so far in the file", async () => {
    const task = await aTask();
    const processIdFile = join(repository.folder, `${task.taskId}.pid`);
    const commandLine = `node "${join(repository.folder, "hang.cjs")}" "${processIdFile}"`;
    const stop = new AbortController();

    const running = agentCommands.run(
      task.project,
      task.taskId,
      { commandLine },
      options(task.taskId, stop.signal),
    );
    await expect
      .poll(() => readFile(processIdFile, "utf8").catch(() => ""), { timeout: 10_000 })
      .not.toBe("");
    stop.abort();

    await expect(running).resolves.toMatchObject({ kind: "ran", run: { outcome: "stopped" } });
    const left = Number(await readFile(processIdFile, "utf8"));
    await expect(isRunning(left)).resolves.toBe(false);
    await expect(readFile(outputFileOf(task.taskId), "utf8")).resolves.toBe(`started ${left}\n`);
  });
});

describe("AgentCommands.run with the Project's run environment On", REAL_GIT_TEST, () => {
  it("runs the command in the Task's run environment, its output in the file", async () => {
    const task = await aTask({ runEnvironment: "on" });
    const before = runEnvironments.runs.length;

    const end = await agentCommands.run(
      task.project,
      task.taskId,
      { key: "test" },
      options(task.taskId),
    );

    expect(end).toMatchObject({ kind: "ran", run: { outcome: "passed" } });
    expect(runEnvironments.runs.slice(before).map(({ command }) => command)).toEqual([
      expect.objectContaining({ commandLine: task.project.commands.install }),
      expect.objectContaining({
        commandLine: task.project.commands.test,
        outputFile: outputFileOf(task.taskId),
      }),
    ]);
    await expect(readFile(outputFileOf(task.taskId), "utf8")).resolves.toBe("checked everything\n");
  });

  it("waits for a free run environment as a Script Stage's command does, and a stop runs nothing", async () => {
    const task = await aTask({ runEnvironment: "on", commands: { install: "" } });
    runEnvironments.waitsUntil = new Promise(() => undefined);
    const stop = new AbortController();
    const wait = {
      started: vi.fn<() => Promise<void>>(() => {
        stop.abort();
        return Promise.resolve();
      }),
      ended: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };

    const end = await agentCommands.run(
      task.project,
      task.taskId,
      { key: "test" },
      {
        ...options(task.taskId, stop.signal),
        wait,
      },
    );

    // No install command is set, so nothing installs and the wait is the test command's own.
    expect(end).toMatchObject({ kind: "ran", run: { outcome: "stopped" } });
    expect(wait.started).toHaveBeenCalledOnce();
    expect(wait.ended).toHaveBeenCalledOnce();
    expect(await worktreeHas(task, "checked.txt")).toBe(false);
  });
});
