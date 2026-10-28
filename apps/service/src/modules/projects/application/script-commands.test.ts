import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ScriptCommands } from "./script-commands.js";
import { Worktrees } from "./worktrees.js";

// Real git and real commands in a Task's worktree of a temporary repository.
let repository: TemporaryRepository;
let worktrees: Worktrees;
let scriptCommands: ScriptCommands;
let officeData: OfficeDataDirectory;
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

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  await writeFile(join(repository.folder, "test-suite.cjs"), TEST_SUITE);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  officeData = new OfficeDataDirectory(join(repository.folder, "office-data"));
  worktrees = new Worktrees(new CommandLineGit(new RepositoryLocks()), commands, officeData);
  scriptCommands = new ScriptCommands(worktrees, commands, officeData);
});

afterAll(async () => {
  await repository.remove();
});

/** A started Task's worktree, as planning left it, of a Project whose suite passes from `passFromRun`. */
async function aTask(
  passFromRun: number,
  commands: Partial<Project["commands"]> = {},
): Promise<{ project: Project; taskId: string; worktreePath: string; runLog: string }> {
  taskCount += 1;
  const taskId = `task-${taskCount}`;
  const runLog = join(repository.folder, `${taskId}.log`);
  const project = aProject({
    path: repository.path,
    commands: { ...aProject().commands, build: RUN_TEST_SUITE, test: RUN_TEST_SUITE, ...commands },
    environment: {
      set: [
        { name: "TEST_SUITE", value: join(repository.folder, "test-suite.cjs") },
        { name: "RUN_LOG", value: runLog },
        { name: "PASS_FROM_RUN", value: String(passFromRun) },
      ],
      unset: [],
      prependPath: [],
    },
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

  it("runs a flaky test command again from the restored worktree, and gives both runs", async () => {
    const { project, taskId, worktreePath, runLog } = await aTask(2);

    const runs = await scriptCommands.run(project, taskId, "test", "stage-run");

    expect(runs.map(({ outcome }) => outcome)).toEqual(["failed", "passed"]);
    expect(runs[0]?.output).toContain("FAIL renames a device: expected 'Hall' to be 'Kitchen'");
    expect(await readFile(`${runLog}.seen`, "utf8")).toBe(UNCHANGED_INDEX.repeat(2));
    expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
    expect(runs.map(({ movedFiles }) => movedFiles?.paths)).toEqual([
      ["screenshots/run-1.txt"],
      ["screenshots/run-2.txt"],
    ]);
  });

  it("keeps the screenshots folder as the Agent left it across test runs, out of every commit", async () => {
    const { project, taskId, worktreePath } = await aTask(2);
    const screenshots = join(worktreePath, ".office", "screenshots");
    await writeFile(join(screenshots, "dialog.png"), "the Agent's\n");
    await writeFile(join(worktreePath, "notes.txt"), "the Agent's notes\n");

    const runs = await scriptCommands.run(project, taskId, "test", "stage-run-3");

    expect(runs.map(({ outcome }) => outcome)).toEqual(["failed", "passed"]);
    expect(await readdir(screenshots)).toEqual(["dialog.png"]);
    await expect(readFile(join(screenshots, "dialog.png"), "utf8")).resolves.toBe("the Agent's\n");
    await worktrees.commit(project, taskId, "The Agent's notes");
    expect(gitIn(worktreePath, "show", "--name-only", "--format=", "HEAD")).toBe("notes.txt");
  });

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

  it("runs a failing build once and leaves what it changed for the Stage's commit", async () => {
    const { project, taskId, worktreePath } = await aTask(Number.MAX_SAFE_INTEGER);

    const runs = await scriptCommands.run(project, taskId, "build", "stage-run");

    expect(runs).toEqual([expect.objectContaining({ outcome: "failed", movedFiles: undefined })]);
    expect(await trackedIndex(worktreePath)).toBe("export const changedByRun = 1;\n");
  });
});
