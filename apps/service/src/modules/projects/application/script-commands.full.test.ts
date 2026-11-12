import { readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
  REAL_GIT_TEST,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { Project, ProjectCommand } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ScriptCommands } from "./script-commands.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";
import { ScriptedTaskRunEnvironments } from "./task-run-environments.fixtures.js";
import { Worktrees } from "./worktrees.js";
import { TaskBasesForTests } from "./task-bases.fixtures.js";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";

// Real git and real commands in a Task's worktree of a temporary repository.
let repository: TemporaryRepository;
let worktrees: Worktrees;
let scriptCommands: ScriptCommands;
let officeData: OfficeDataDirectory;
let runEnvironments: ScriptedTaskRunEnvironments;
let taskCount = 0;

/**
 * A test suite that edits a tracked file and writes a screenshot, as suites do, and fails until
 * its PASS_FROM_RUN-th run. Each run first notes the tracked file as it found it. It sits outside
 * the worktree, with its counter, so a restore can't reset either.
 */
const TEST_SUITE = `const fs = require("fs");
const log = process.env.RUN_LOG;
fs.appendFileSync(log + ".seen", fs.readFileSync("src/index.ts", "utf8"));
fs.appendFileSync(log, "x");
const runs = fs.readFileSync(log, "utf8").length;
fs.writeFileSync("src/index.ts", "export const changedByRun = " + runs + ";\\n");
fs.mkdirSync("screenshots", { recursive: true });
fs.writeFileSync("screenshots/run-" + runs + ".txt", "a screenshot\\n");
fs.mkdirSync(".office/screenshots", { recursive: true });
fs.writeFileSync(".office/screenshots/by-run-" + runs + ".png", "the run's\\n");
fs.writeFileSync(".office/screenshots/dialog.png", "the run's\\n");
if (runs >= Number(process.env.PASS_FROM_RUN)) {
  console.log("All 2 tests passed.");
  process.exit(0);
}
console.log("ok 1 - lists the devices");
console.log("FAIL renames a device: expected 'Hall' to be 'Kitchen'");
process.exit(1);
`;
const RUN_TEST_SUITE = `node -e "require(process.env.TEST_SUITE)"`;
const UNCHANGED_INDEX = "export {};\n";

/** Each kind of command runs the suite; `test-full` is a test command under another key. */
const SUITE_COMMANDS: readonly ProjectCommand[] = [
  { key: "build", name: "Build", kind: "build", commandLine: RUN_TEST_SUITE },
  { key: "lint", name: "Lint", kind: "lint", commandLine: RUN_TEST_SUITE },
  { key: "test", name: "Test", kind: "test", commandLine: RUN_TEST_SUITE },
  { key: "test-full", name: "Full tests", kind: "test", commandLine: RUN_TEST_SUITE },
];

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  await writeFile(join(repository.folder, "test-suite.cjs"), TEST_SUITE);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  officeData = new OfficeDataDirectory(join(repository.folder, "office-data"));
  runEnvironments = new ScriptedTaskRunEnvironments(new ShellCommandRunner());
  const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  const taskCommands = taskCommandsOver(commands, git, runEnvironments.registry());
  worktrees = new Worktrees(git, commands, taskCommands, officeData, new TaskBasesForTests(git));
  scriptCommands = new ScriptCommands(worktrees, taskCommands, officeData);
});

afterAll(async () => {
  await repository.remove();
});

/**
 * A started Task's worktree, as planning left it, of a Project whose suite passes from
 * `passFromRun`; `lines` gives a command another line by its key.
 */
async function aTask(
  passFromRun: number,
  lines: Readonly<Record<string, string>> = {},
  runEnvironment: Project["runEnvironment"] = "not-decided",
): Promise<{ project: Project; taskId: string; worktreePath: string; runLog: string }> {
  taskCount += 1;
  const taskId = `task-${taskCount}`;
  const runLog = join(repository.folder, `${taskId}.log`);
  const project = aProject({
    path: repository.path,
    commands: SUITE_COMMANDS.map((command) => ({
      ...command,
      commandLine: lines[command.key] ?? command.commandLine,
    })),
    environment: {
      set: [
        { name: "TEST_SUITE", value: join(repository.folder, "test-suite.cjs"), secret: false },
        { name: "RUN_LOG", value: runLog, secret: false },
        { name: "PASS_FROM_RUN", value: String(passFromRun), secret: false },
      ],
      unset: [],
      prependPath: [],
    },
    runEnvironment,
  });
  const { path } = await worktrees.open(project, taskId);
  return { project, taskId, worktreePath: path, runLog };
}

function trackedIndex(worktreePath: string): Promise<string> {
  return readFile(join(worktreePath, "src", "index.ts"), "utf8");
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

describe("ScriptCommands.run", REAL_GIT_TEST, () => {
  it("runs a passing test command once, then restores what it changed in tracked files", async () => {
    const { project, taskId, worktreePath } = await aTask(1);

    const runs = await scriptCommands.run(project, taskId, "test", "stage-run");

    expect(runs).toEqual([
      expect.objectContaining({ commandLine: RUN_TEST_SUITE, outcome: "passed", exitCode: 0 }),
    ]);
    expect(runs[0]?.output).toContain("All 2 tests passed.");
    expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
  });

  it("moves the files a test run wrote out of the worktree, so no commit holds them", async () => {
    const { project, taskId, worktreePath } = await aTask(1);
    await writeFile(join(worktreePath, "notes.txt"), "the Agent's, from before the run\n");

    const [run] = await scriptCommands.run(project, taskId, "test", "stage-run-2");

    const folder = join(officeData.folder("test-output"), "stage-run-2", "1");
    expect(run?.movedFiles).toEqual({ folder, paths: ["screenshots/run-1.txt"] });
    await expect(readFile(join(folder, "screenshots", "run-1.txt"), "utf8")).resolves.toBe(
      "a screenshot\n",
    );
    expect(await exists(join(worktreePath, "screenshots", "run-1.txt"))).toBe(false);
    await worktrees.commit(project, taskId, "The Agent's notes");
    expect(gitIn(worktreePath, "show", "--name-only", "--format=", "HEAD")).toBe("notes.txt");
  });

  it.each(["test", "test-full"])(
    "runs a flaky test command (%s) again from the restored worktree, and gives both runs",
    async (key) => {
      const { project, taskId, worktreePath, runLog } = await aTask(2);

      const runs = await scriptCommands.run(project, taskId, key, `stage-run-flaky-${key}`);

      expect(runs.map(({ outcome }) => outcome)).toEqual(["failed", "passed"]);
      expect(runs[0]?.output).toContain("FAIL renames a device: expected 'Hall' to be 'Kitchen'");
      expect(await readFile(`${runLog}.seen`, "utf8")).toBe(UNCHANGED_INDEX.repeat(2));
      expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
      expect(runs.map(({ movedFiles }) => movedFiles?.paths)).toEqual([
        ["screenshots/run-1.txt"],
        ["screenshots/run-2.txt"],
      ]);
    },
  );

  it.each(["test", "test-full"])(
    "keeps the screenshots folder as the Agent left it across %s runs, out of every commit",
    async (key) => {
      const { project, taskId, worktreePath } = await aTask(2);
      const screenshots = join(worktreePath, ".office", "screenshots");
      await writeFile(join(screenshots, "dialog.png"), "the Agent's\n");
      await writeFile(join(worktreePath, "notes.txt"), "the Agent's notes\n");

      const runs = await scriptCommands.run(project, taskId, key, `stage-run-3-${key}`);

      expect(runs.map(({ outcome }) => outcome)).toEqual(["failed", "passed"]);
      expect(await readdir(screenshots)).toEqual(["dialog.png"]);
      await expect(readFile(join(screenshots, "dialog.png"), "utf8")).resolves.toBe(
        "the Agent's\n",
      );
      await worktrees.commit(project, taskId, "The Agent's notes");
      expect(gitIn(worktreePath, "show", "--name-only", "--format=", "HEAD")).toBe("notes.txt");
    },
  );

  it("commits no screenshot when the Agent removed the folder's .gitignore", async () => {
    const { project, taskId, worktreePath } = await aTask(1);
    await rm(join(worktreePath, ".office", ".gitignore"));
    await writeFile(join(worktreePath, ".office", "screenshots", "home.png"), "the Agent's\n");
    await writeFile(join(worktreePath, "notes.txt"), "the Agent's notes\n");

    await worktrees.commit(project, taskId, "The Agent's notes");

    expect(gitIn(worktreePath, "show", "--name-only", "--format=", "HEAD")).toBe("notes.txt");
  });

  it("leaves no screenshots folder's files a test run wrote when the Agent left it empty", async () => {
    const { project, taskId, worktreePath } = await aTask(1);

    await scriptCommands.run(project, taskId, "test", "stage-run-4");

    expect(await readdir(join(worktreePath, ".office", "screenshots"))).toEqual([]);
  });

  it("gives a test command that fails twice both its failed runs, with the worktree restored", async () => {
    const { project, taskId, worktreePath } = await aTask(Number.MAX_SAFE_INTEGER);

    const runs = await scriptCommands.run(project, taskId, "test", "stage-run");

    expect(runs).toEqual([
      expect.objectContaining({ outcome: "failed", exitCode: 1 }),
      expect.objectContaining({ outcome: "failed", exitCode: 1 }),
    ]);
    expect(runs[1]?.output).toContain("FAIL renames a device");
    expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
  });

  it("doesn't run a test command again that the shell couldn't run", async () => {
    const { project, taskId } = await aTask(1, { test: "office-no-such-program --run" });

    const runs = await scriptCommands.run(project, taskId, "test", "stage-run");

    expect(runs.map(({ outcome }) => outcome)).toEqual(["could-not-run"]);
  });

  it.each(["build", "test"])(
    "runs nothing for a %s command that isn't set and can't pass, saying how to set it",
    async (key) => {
      const { project, taskId, runLog } = await aTask(1, { [key]: "" });

      const runs = await scriptCommands.run(project, taskId, key, "stage-run");

      expect(runs).toEqual([
        expect.objectContaining({
          commandLine: "",
          outcome: "could-not-run",
          output: `The Project's ${key} command isn't set yet. Set it on the Project's page, or ask Devops.`,
          movedFiles: undefined,
        }),
      ]);
      expect(await exists(runLog)).toBe(false);
    },
  );

  it("runs nothing for a command the Project lacks, naming it", async () => {
    const { project, taskId, runLog } = await aTask(1);

    const runs = await scriptCommands.run(project, taskId, "e2e", "stage-run");

    expect(runs).toEqual([
      expect.objectContaining({
        commandLine: "",
        outcome: "could-not-run",
        output: "The Project has no e2e command. Add it on the Project's page, or ask Devops.",
        movedFiles: undefined,
      }),
    ]);
    expect(await exists(runLog)).toBe(false);
  });

  it.each(["build", "lint"])(
    "runs a failing %s command once, without the test handling, leaving what it changed for the Stage's commit",
    async (key) => {
      const { project, taskId, worktreePath } = await aTask(Number.MAX_SAFE_INTEGER);

      const runs = await scriptCommands.run(project, taskId, key, `stage-run-${key}`);

      expect(runs).toEqual([expect.objectContaining({ outcome: "failed", movedFiles: undefined })]);
      expect(await trackedIndex(worktreePath)).toBe("export const changedByRun = 1;\n");
      expect(await exists(join(worktreePath, "screenshots", "run-1.txt"))).toBe(true);
      expect((await readdir(join(worktreePath, ".office", "screenshots"))).toSorted()).toEqual([
        "by-run-1.png",
        "dialog.png",
      ]);
    },
  );
});

describe("ScriptCommands.run with the Project's run environment On", REAL_GIT_TEST, () => {
  it("runs the command in the Task's run environment, with only the Project's variables", async () => {
    const { project, taskId, worktreePath } = await aTask(1, {}, "on");
    const before = runEnvironments.runs.length;

    const runs = await scriptCommands.run(project, taskId, "build", "stage-run-5");

    expect(runs.map(({ outcome }) => outcome)).toEqual(["passed"]);
    expect(runEnvironments.runs.slice(before)).toEqual([
      {
        task: {
          taskId,
          projectId: project.id,
          worktree: worktreePath,
          // Named by git on the host, which gives real paths.
          repositoryGitFolder: await realpath(join(repository.path, ".git")),
          installCommand: project.installCommand,
          installInputs: project.installInputs,
          installVariables: project.environment.set,
        },
        command: expect.objectContaining({
          commandLine: RUN_TEST_SUITE,
          environment: project.environment,
          timeoutMs: 30 * 60_000,
        }),
      },
    ]);
  });

  it("keeps a test run's re-run, restore, moved files and screenshots as on the host", async () => {
    const { project, taskId, worktreePath } = await aTask(2, {}, "on");
    const screenshots = join(worktreePath, ".office", "screenshots");
    await writeFile(join(screenshots, "dialog.png"), "the Agent's\n");
    const before = runEnvironments.runs.length;

    const runs = await scriptCommands.run(project, taskId, "test", "stage-run-6");

    expect(runEnvironments.runs.length - before).toBe(2);
    expect(runs.map(({ outcome }) => outcome)).toEqual(["failed", "passed"]);
    expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
    expect(runs.map(({ movedFiles }) => movedFiles?.paths)).toEqual([
      ["screenshots/run-1.txt"],
      ["screenshots/run-2.txt"],
    ]);
    expect(await exists(join(worktreePath, "screenshots", "run-1.txt"))).toBe(false);
    expect(await readdir(screenshots)).toEqual(["dialog.png"]);
  });

  it("tells the wait for a free run environment, and a stop during it runs nothing", async () => {
    const { project, taskId, runLog } = await aTask(1, {}, "on");
    runEnvironments.waitsUntil = new Promise(() => undefined);
    const stop = new AbortController();
    const wait = {
      started: vi.fn<() => Promise<void>>(() => {
        stop.abort();
        return Promise.resolve();
      }),
      ended: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };

    const runs = await scriptCommands.run(project, taskId, "test", "stage-run-7", {
      signal: stop.signal,
      wait,
    });

    expect(runs.map(({ outcome }) => outcome)).toEqual(["stopped"]);
    expect(wait.started).toHaveBeenCalledOnce();
    expect(wait.ended).toHaveBeenCalledOnce();
    expect(await exists(runLog)).toBe(false);
  });

  it("fails with why when the run environment can't start, running nothing on the host", async () => {
    const { project, taskId, runLog } = await aTask(1, {}, "on");
    runEnvironments.refusal = "The run environment couldn't start. The image didn't build.";

    try {
      const runs = await scriptCommands.run(project, taskId, "build", "stage-run-8");

      expect(runs).toEqual([
        expect.objectContaining({
          outcome: "could-not-run",
          output: expect.stringContaining("The image didn't build.") as string,
        }),
      ]);
      expect(await exists(runLog)).toBe(false);
    } finally {
      runEnvironments.refusal = undefined;
    }
  });

  it.each(["off", "not-decided"] as const)(
    "runs on the host with the setting %s",
    async (runEnvironment) => {
      const { project, taskId, runLog } = await aTask(1, {}, runEnvironment);
      const before = runEnvironments.runs.length;

      await scriptCommands.run(project, taskId, "build", "stage-run-9");

      expect(runEnvironments.runs.length).toBe(before);
      expect(await exists(runLog)).toBe(true);
    },
  );
});
