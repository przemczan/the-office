import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
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
fs.writeFileSync("screenshot-" + runs + ".txt", "a screenshot\\n");
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
  worktrees = new Worktrees(
    new CommandLineGit(new RepositoryLocks()),
    commands,
    new OfficeDataDirectory(join(repository.folder, "office-data")),
  );
  scriptCommands = new ScriptCommands(worktrees, commands);
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

describe("ScriptCommands.run", () => {
  it("runs a passing test command once, then restores what it changed in tracked files", async () => {
    const { project, taskId, worktreePath } = await aTask(1);

    const runs = await scriptCommands.run(project, taskId, "test");

    expect(runs).toEqual([
      expect.objectContaining({ commandLine: RUN_TEST_SUITE, outcome: "passed", exitCode: 0 }),
    ]);
    expect(runs[0]?.output).toContain("All 2 tests passed.");
    expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
    // Untracked files such as screenshots stay for the user to see.
    expect(await exists(join(worktreePath, "screenshot-1.txt"))).toBe(true);
  });

  it("runs a flaky test command again from the restored worktree, and gives both runs", async () => {
    const { project, taskId, worktreePath, runLog } = await aTask(2);

    const runs = await scriptCommands.run(project, taskId, "test");

    expect(runs.map(({ outcome }) => outcome)).toEqual(["failed", "passed"]);
    expect(runs[0]?.output).toContain("FAIL renames a device: expected 'Hall' to be 'Kitchen'");
    expect(await readFile(`${runLog}.seen`, "utf8")).toBe(UNCHANGED_INDEX.repeat(2));
    expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
  });

  it("gives a test command that fails twice both its failed runs, with the worktree restored", async () => {
    const { project, taskId, worktreePath } = await aTask(Number.MAX_SAFE_INTEGER);

    const runs = await scriptCommands.run(project, taskId, "test");

    expect(runs).toEqual([
      expect.objectContaining({ outcome: "failed", exitCode: 1 }),
      expect.objectContaining({ outcome: "failed", exitCode: 1 }),
    ]);
    expect(runs[1]?.output).toContain("FAIL renames a device");
    expect(await trackedIndex(worktreePath)).toBe(UNCHANGED_INDEX);
  });

  it("doesn't run a test command again that the shell couldn't run", async () => {
    const { project, taskId } = await aTask(1, { test: "office-no-such-program --run" });

    const runs = await scriptCommands.run(project, taskId, "test");

    expect(runs.map(({ outcome }) => outcome)).toEqual(["could-not-run"]);
  });

  it("runs a failing build once and leaves what it changed for the Stage's commit", async () => {
    const { project, taskId, worktreePath } = await aTask(Number.MAX_SAFE_INTEGER);

    const runs = await scriptCommands.run(project, taskId, "build");

    expect(runs.map(({ outcome }) => outcome)).toEqual(["failed"]);
    expect(await trackedIndex(worktreePath)).toBe("export const changedByRun = 1;\n");
  });
});
