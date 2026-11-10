import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commitOnOrigin,
  gitIn,
  type TemporaryRepository,
  REAL_GIT_TEST,
} from "../adapters/git/temporary-repository.fixtures.js";
import { OutputMask } from "../domain/output-mask.js";
import type { Project } from "../domain/project.js";
import { ScriptedTaskRunEnvironments } from "./task-run-environments.fixtures.js";
import { Worktrees } from "./worktrees.js";
import { COUNTING_INSTALL, worktreesOnATemporaryRepository } from "../worktrees.fixtures.js";

// Real git and real commands on a temporary repository whose main tracks its origin's.
let repository: TemporaryRepository;
let worktrees: Worktrees;
let installLog: string;
let project: Project;
let runEnvironments: ScriptedTaskRunEnvironments;
let taskCount = 0;

beforeAll(async () => {
  ({ repository, worktrees, installLog, project, runEnvironments } =
    await worktreesOnATemporaryRepository());
});

afterAll(async () => {
  await repository.remove();
});

function aTaskId(): string {
  taskCount += 1;
  return `task-${taskCount}`;
}

async function installs(): Promise<number> {
  return (await readFile(installLog, "utf8").catch(() => "")).length;
}

// Real git, making worktrees and commits: slow under a full run.
describe("Worktrees.prepare", REAL_GIT_TEST, () => {
  it("starts at the local base branch when it tracks no remote branch", async () => {
    gitIn(repository.path, "branch", "--quiet", "local-base", "main");
    const localBase = { ...project, baseBranch: "local-base" };

    const { worktree } = await worktrees.prepare(localBase, aTaskId());

    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(
      gitIn(repository.path, "rev-parse", "local-base"),
    );
  });

  it("installs nothing while the install command isn't set, and installs once it is", async () => {
    const taskId = aTaskId();
    const notSet = { ...project, commands: { ...project.commands, install: "" } };
    const before = await installs();

    const first = await worktrees.prepare(notSet, taskId);
    const set = await worktrees.prepare(project, taskId);

    expect(first.installation).toEqual({ kind: "up-to-date" });
    expect(set.installation).toMatchObject({ kind: "ran", run: { outcome: "passed" } });
    expect(await installs()).toBe(before + 1);
  });

  it("gives the worktree back as the Task left it, without installing again", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await writeFile(join(worktree.path, "half-done.txt"), "not committed\n");
    const before = await installs();

    const again = await worktrees.prepare(project, taskId);

    expect(again.worktree).toEqual(worktree);
    expect(again.installation).toEqual({ kind: "up-to-date" });
    await expect(readFile(join(worktree.path, "half-done.txt"), "utf8")).resolves.toBe(
      "not committed\n",
    );
    expect(await installs()).toBe(before);
  });

  it("checks out the Task's branch where it was when its worktree was removed", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await writeFile(join(worktree.path, "kept.txt"), "kept\n");
    gitIn(worktree.path, "add", ".");
    gitIn(worktree.path, "commit", "--quiet", "--message", "Keep a file");
    const commit = gitIn(worktree.path, "rev-parse", "HEAD");

    await worktrees.remove(project, taskId);
    expect(await stat(worktree.path).catch(() => undefined)).toBeUndefined();
    const again = await worktrees.prepare(project, taskId);

    expect(gitIn(again.worktree.path, "rev-parse", "HEAD")).toBe(commit);
  });
});

describe("Worktrees.open", REAL_GIT_TEST, () => {
  it("makes the Task's worktree at the freshly fetched base without installing, as planning reads it", async () => {
    const fetched = await commitOnOrigin(repository, "main", "planned.txt");
    const taskId = aTaskId();
    const before = await installs();

    const worktree = await worktrees.open(project, taskId);

    expect(worktree).toEqual({
      path: worktrees.pathOf(project, taskId),
      branch: `office/${taskId}`,
    });
    expect(gitIn(worktree.path, "rev-parse", "HEAD")).toBe(fetched);
    expect(await installs()).toBe(before);
    expect((await worktrees.prepare(project, taskId)).installation).toMatchObject({ kind: "ran" });
  });
});

describe("Worktrees.prepare, by the Project's Run environment setting", REAL_GIT_TEST, () => {
  it("installs in the run environment when On, with the install's time limit and wait", async () => {
    const taskId = aTaskId();
    const on: Project = { ...project, runEnvironment: "on" };
    const before = runEnvironments.runs.length;
    const wait = { started: () => Promise.resolve(), ended: () => Promise.resolve() };
    const { signal } = new AbortController();

    const { worktree, installation } = await worktrees.prepare(on, taskId, { signal, wait });

    expect(installation).toMatchObject({ kind: "ran", run: { outcome: "passed" } });
    expect(runEnvironments.runs.slice(before)).toEqual([
      {
        task: expect.objectContaining({ taskId, worktree: worktree.path }) as unknown,
        command: {
          commandLine: COUNTING_INSTALL,
          environment: project.environment,
          mask: OutputMask.NONE,
          timeoutMs: 30 * 60_000,
          signal,
          wait,
        },
      },
    ]);
  });

  it("installs again where the commands run next, never reusing an install made elsewhere", async () => {
    const taskId = aTaskId();
    const on: Project = { ...project, runEnvironment: "on" };
    const installationOf = async (given: Project) =>
      (await worktrees.prepare(given, taskId)).installation.kind;
    await worktrees.prepare(project, taskId);
    const count = await installs();

    expect(await installationOf(on)).toBe("ran");
    expect(await installationOf(on)).toBe("up-to-date");
    runEnvironments.image = "the-office/shop:second-key";
    expect(await installationOf(on)).toBe("ran");
    expect(await installationOf({ ...project, runEnvironment: "off" })).toBe("ran");
    expect(await installationOf(project)).toBe("up-to-date");
    expect(await installs()).toBe(count + 3);
  });

  it("gives a run environment that can't start as a failed install, nothing run on the host", async () => {
    const taskId = aTaskId();
    runEnvironments.refusal = "The run environment's image couldn't be built.";
    try {
      const count = await installs();

      const { installation } = await worktrees.prepare(
        { ...project, runEnvironment: "on" },
        taskId,
      );

      expect(installation).toMatchObject({
        kind: "ran",
        run: { outcome: "could-not-run", output: "The run environment's image couldn't be built." },
      });
      expect(await installs()).toBe(count);
    } finally {
      runEnvironments.refusal = undefined;
    }
  });
});

describe("Worktrees.install", REAL_GIT_TEST, () => {
  it("installs again only when the install command, an install input or the environment changes", async () => {
    const { worktree } = await worktrees.prepare(project, aTaskId());
    const count = await installs();

    await writeFile(join(worktree.path, "unrelated.txt"), "changed\n");
    await expect(worktrees.install(project, worktree.path)).resolves.toEqual({
      kind: "up-to-date",
    });

    await writeFile(join(worktree.path, "package-lock.json"), "{}\n");
    await worktrees.install(project, worktree.path);
    expect(await installs()).toBe(count + 1);

    const changedCommand = {
      ...project,
      commands: { ...project.commands, install: `${COUNTING_INSTALL} && echo again` },
    };
    await worktrees.install(changedCommand, worktree.path);
    expect(await installs()).toBe(count + 2);

    const changedEnvironment = {
      ...project.environment,
      set: [...project.environment.set, { name: "EXTRA", value: "1", secret: false }],
    };
    await worktrees.install(changedCommand, worktree.path, { environment: changedEnvironment });
    expect(await installs()).toBe(count + 3);
  });

  it("tries again after an install that failed", async () => {
    const { worktree } = await worktrees.prepare(project, aTaskId());
    const failing = {
      ...project,
      commands: { ...project.commands, install: `node -e "process.exit(1)"` },
    };

    await expect(worktrees.install(failing, worktree.path)).resolves.toMatchObject({
      kind: "ran",
      run: { outcome: "failed", exitCode: 1 },
    });
    await expect(worktrees.install(failing, worktree.path)).resolves.toMatchObject({ kind: "ran" });
  });
});

// Real git, making worktrees and commits: slow under a full run.
describe("Worktrees with a Task's id", REAL_GIT_TEST, () => {
  it("summarises what the Task's commits changed since its branch left the base, without the base's later commits", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await expect(worktrees.changesSoFar(project, taskId)).resolves.toBeUndefined();

    await writeFile(join(worktree.path, "renamed.txt"), "a Stage's work\n");
    await worktrees.commit(project, taskId, "Implement: a Stage's work");
    await commitOnOrigin(repository, "main", `later-${taskId}.txt`);
    gitIn(repository.path, "fetch", "--quiet", "origin");
    await writeFile(join(worktree.path, "uncommitted.txt"), "not yet a Stage's work\n");

    const summary = await worktrees.changesSoFar(project, taskId);
    expect(summary).toMatch(/^ renamed\.txt \| 1 \+\n 1 file changed, 1 insertion\(\+\)$/);
  });
});

describe("Worktrees.changes", REAL_GIT_TEST, () => {
  it("has none before the Task has a branch", async () => {
    await expect(worktrees.changes(project, aTaskId())).resolves.toEqual({
      files: [],
      diff: "",
      diffCut: false,
      worktreePath: undefined,
    });
  });

  it("reads the Task's committed changes against the fetched base, without its later commits, with the worktree's path while it is there, and after it is gone too", async () => {
    const taskId = aTaskId();
    const { worktree } = await worktrees.prepare(project, taskId);
    await writeFile(join(worktree.path, "work.txt"), "a Stage's work\n");
    await worktrees.commit(project, taskId, "Implement: a Stage's work");
    await commitOnOrigin(repository, "main", `later-${taskId}.txt`);
    gitIn(repository.path, "fetch", "--quiet", "origin");
    const expected = [
      {
        path: "work.txt",
        previousPath: undefined,
        lines: { added: 1, removed: 0 },
        deleted: false,
      },
    ];

    await expect(worktrees.changes(project, taskId)).resolves.toMatchObject({
      files: expected,
      worktreePath: worktree.path,
    });
    await worktrees.remove(project, taskId);
    await expect(worktrees.changes(project, taskId)).resolves.toMatchObject({
      files: expected,
      worktreePath: undefined,
    });
  });
});

describe("Worktrees.remove", REAL_GIT_TEST, () => {
  it("makes the worktree again from the Task's branch for the next Stage's HEAD check", async () => {
    const taskId = aTaskId();
    const worktree = await worktrees.open(project, taskId);
    await writeFile(join(worktree.path, "published.txt"), "published\n");
    const commit = await worktrees.commit(project, taskId, "Implement: a Stage's work");
    await worktrees.remove(project, taskId);

    await expect(worktrees.head(project, taskId)).resolves.toEqual({
      commit,
      branch: worktree.branch,
    });
    expect(await readFile(join(worktree.path, "published.txt"), "utf8")).toBe("published\n");
  });
});
