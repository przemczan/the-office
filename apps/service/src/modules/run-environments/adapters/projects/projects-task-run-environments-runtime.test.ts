import { execFileSync } from "node:child_process";
import { lstat, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OutputMask,
  TaskRunEnvironments,
  type TaskInRunEnvironment,
  type TaskRunEnvironmentCommand,
} from "../../../projects/index.js";
import {
  restartedTestbed,
  runEnvironmentsTestbed,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "../../application/run-environments.fixtures.js";
import { officeLabels } from "../../domain/run-environment.js";
import { REAL_RUNTIME_TEST, realRuntimeMissing } from "../compose/compose-command-line.fixtures.js";
import { ComposeCommandLine } from "../compose/compose-command-line.js";
import { ProjectsTaskRunEnvironments } from "./projects-task-run-environments.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{
    "dockerComposeFile": "compose.yaml",
    "service": "app",
    "overrideCommand": true
  }`,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: busybox:1.37.0\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

/** Set on the service only: a command in a run environment must never see it. */
const HOST_ONLY = "OFFICE_RUN_ENVIRONMENT_CHECK_HOST_ONLY";

const hostUserId = process.getuid?.();
const hostGroupId = process.getgid?.();
/**
 * The non-root Office the checks' files go back to: this process's own user when it isn't root,
 * so the test can still remove what it made, else one no file here starts with.
 */
const NON_ROOT_OFFICE =
  hostUserId === undefined || hostGroupId === undefined || hostUserId === 0
    ? { userId: 4321, groupId: 4321 }
    : { userId: hostUserId, groupId: hostGroupId };

function aCommand(
  commandLine: string,
  fields: Partial<TaskRunEnvironmentCommand> = {},
): TaskRunEnvironmentCommand {
  return {
    commandLine,
    environment: {
      set: [{ name: "GREETING", value: "hello", secret: false }],
      unset: [],
      prependPath: [],
    },
    mask: OutputMask.NONE,
    timeoutMs: 60_000,
    ...fields,
  };
}

const missing = await realRuntimeMissing();

describe.skipIf(missing !== undefined)(
  `Projects' commands on the real container runtime${missing ? ` (skipped: ${missing})` : ""}`,
  REAL_RUNTIME_TEST,
  () => {
    const runtime = new ComposeCommandLine();
    let testbed: RunEnvironmentsTestbed;
    const registry = new TaskRunEnvironments();

    beforeAll(async () => {
      process.env[HOST_ONLY] = "leaked";
      testbed = await runEnvironmentsTestbed(runtime, {
        limits: {
          cpuLimit: { choice: "fixed", fixedCpus: 1 },
          memoryMegabytes: 256,
          processes: 128,
        },
        runEnvironmentsAtOnce: 1,
      });
      new ProjectsTaskRunEnvironments(
        registry,
        testbed.environments,
        testbed.knownTasks,
        testbed.folders,
        testbed.setUpTasks,
      ).onModuleInit();
    }, REAL_RUNTIME_TEST.timeout);

    afterAll(async () => {
      delete process.env[HOST_ONLY];
      // Everything carries this test's own Office label, so nothing of another Office is touched.
      // As after a restart, with no open Task: everything this test's Office made goes.
      await (await restartedTestbed(testbed, runtime)).environments.sweep();
      for (const { name } of await runtime.listImages(officeLabels(testbed.folders.instance))) {
        await runtime.removeImage(name);
      }
      await rm(testbed.folder, { recursive: true, force: true });
    }, REAL_RUNTIME_TEST.timeout);

    async function aTask(taskId: string): Promise<TaskInRunEnvironment> {
      testbed.knownTasks.tasks.push({ id: taskId, title: `Task ${taskId}`, state: "in-progress" });
      const worktree = join(testbed.folder, "worktrees", taskId);
      await writeFiles(worktree, DEFINITION);
      return {
        taskId,
        projectId: "shop",
        worktree,
        // A main checkout's, inside the worktree: no git folder to mount, as none exists here.
        repositoryGitFolder: join(worktree, ".git"),
        stageRunsFolder: join(testbed.folder, "stage-runs", taskId),
        installCommand: "echo installed",
        installInputs: ["package-lock.json"],
        installVariables: [],
      };
    }

    /** A Task in a git worktree of a repository with one commit, on an image that has git. */
    async function aTaskInAGitWorktree(taskId: string): Promise<TaskInRunEnvironment> {
      testbed.knownTasks.tasks.push({ id: taskId, title: `Task ${taskId}`, state: "in-progress" });
      const repository = join(testbed.folder, "git-repository");
      const worktree = join(testbed.folder, "worktrees", taskId);
      gitIn(testbed.folder, "init", "--quiet", "--initial-branch=main", repository);
      gitIn(repository, "commit", "--quiet", "--allow-empty", "--message", "First");
      gitIn(repository, "worktree", "add", "--quiet", "-b", taskId, worktree);
      await writeFiles(worktree, GIT_DEFINITION);
      return {
        taskId,
        projectId: "shop",
        worktree,
        // As Projects names it: git on the host, never the worktree's .git file.
        repositoryGitFolder: gitIn(
          worktree,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ).trim(),
        stageRunsFolder: join(testbed.folder, "stage-runs", taskId),
        installCommand: "apk add --no-cache git",
        installInputs: ["package-lock.json"],
        installVariables: [],
      };
    }

    it("runs the command in the container, the worktree mounted, with only the Project's variables", async () => {
      const task = await aTask("task-1");

      const finished = await registry.run(
        task,
        aCommand(
          [
            "test -f /.dockerenv && echo in-a-container",
            'echo "greeting: $GREETING"',
            `echo "host only: \${${HOST_ONLY}:-unset}"`,
            "echo written > written.txt",
            "exit 4",
          ].join("\n"),
        ),
      );

      expect(finished).toMatchObject({ outcome: "failed", exitCode: 4 });
      expect(finished.output).toBe("in-a-container\ngreeting: hello\nhost only: unset\n");
      expect(await readFile(join(task.worktree, "written.txt"), "utf8")).toBe("written\n");
    });

    it("waits for a free run environment, telling the wait, and runs once one is free", async () => {
      const first = await aTask("task-2");
      const second = await aTask("task-3");
      await testbed.environments.remove("task-1");
      await registry.run(first, aCommand("true"));
      const wait = {
        started: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        ended: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      };

      const secondRun = registry.run(second, aCommand("echo second ran", { wait }));
      await vi.waitFor(() => expect(wait.started).toHaveBeenCalledOnce(), { timeout: 60_000 });
      expect(wait.ended).not.toHaveBeenCalled();
      await testbed.environments.remove("task-2");

      expect(await secondRun).toMatchObject({ outcome: "passed", output: "second ran\n" });
      expect(wait.ended).toHaveBeenCalledOnce();
    });

    it("reads the worktree's history with git, and can't commit, its git folder read-only", async () => {
      await testbed.environments.remove("task-3");
      const task = await aTaskInAGitWorktree("task-4");
      const head = gitIn(task.worktree, "rev-parse", "HEAD");

      const reads = await registry.run(
        task,
        aCommand(`${GIT} rev-parse HEAD && ${GIT} status --short && ${GIT} log -1 --format=%s`),
      );
      const commit = await registry.run(
        task,
        aCommand(`${GIT} commit --quiet --allow-empty --message Second`),
      );

      expect(reads).toMatchObject({ outcome: "passed" });
      expect(reads.output).toContain(head);
      expect(reads.output).toContain("First\n");
      expect(commit).toMatchObject({ outcome: "failed" });
      expect(commit.output).toMatch(/Read-only file system/);
      expect(gitIn(task.worktree, "rev-parse", "HEAD")).toBe(head);
    });

    it("reads the Stage runs' file written after it started, and can't write there", async () => {
      await testbed.environments.remove("task-4");
      const task = await aTask("task-5");
      await registry.run(task, aCommand("true"));
      const file = join(task.stageRunsFolder, "stage-runs.json");
      await writeFile(file, '{"version":1}');

      const reads = await registry.run(
        task,
        aCommand('cat "$STAGE_RUNS" && ! echo changed > "$STAGE_RUNS"', {
          environment: {
            set: [{ name: "STAGE_RUNS", value: file, secret: false }],
            unset: [],
            prependPath: [],
          },
          readsStageRuns: true,
        }),
      );

      expect(reads).toMatchObject({ outcome: "passed" });
      expect(reads.output).toContain('{"version":1}');
      expect(await readFile(file, "utf8")).toBe('{"version":1}');
    });
  },
);

describe.skipIf(missing !== undefined)(
  `Checks of a non-root Office on the real container runtime${missing ? ` (skipped: ${missing})` : ""}`,
  REAL_RUNTIME_TEST,
  () => {
    const runtime = new ComposeCommandLine();
    let testbed: RunEnvironmentsTestbed;
    const registry = new TaskRunEnvironments();

    beforeAll(async () => {
      testbed = await runEnvironmentsTestbed(
        runtime,
        {
          limits: {
            cpuLimit: { choice: "fixed", fixedCpus: 1 },
            memoryMegabytes: 256,
            processes: 128,
          },
          runEnvironmentsAtOnce: 1,
        },
        NON_ROOT_OFFICE,
      );
      new ProjectsTaskRunEnvironments(
        registry,
        testbed.environments,
        testbed.knownTasks,
        testbed.folders,
        testbed.setUpTasks,
      ).onModuleInit();
    }, REAL_RUNTIME_TEST.timeout);

    afterAll(async () => {
      // As after a restart, with no open Task: everything this test's Office made goes.
      await (await restartedTestbed(testbed, runtime)).environments.sweep();
      for (const { name } of await runtime.listImages(officeLabels(testbed.folders.instance))) {
        await runtime.removeImage(name);
      }
      await rm(testbed.folder, { recursive: true, force: true });
    }, REAL_RUNTIME_TEST.timeout);

    it("gives what a root check wrote back to The Office's user, leaving its own files untouched", async () => {
      testbed.knownTasks.tasks.push({ id: "task-1", title: "Task task-1", state: "in-progress" });
      const worktree = join(testbed.folder, "worktrees", "task-1");
      await writeFiles(worktree, DEFINITION);
      const task: TaskInRunEnvironment = {
        taskId: "task-1",
        projectId: "shop",
        worktree,
        repositoryGitFolder: join(worktree, ".git"),
        stageRunsFolder: join(testbed.folder, "stage-runs", "task-1"),
        installCommand: "echo installed",
        installInputs: ["package-lock.json"],
        installVariables: [],
      };
      await registry.run(task, aCommand("true"));
      const untouched = await stat(join(worktree, "package-lock.json"));

      const finished = await registry.run(
        task,
        aCommand('[ "$(id -u)" = 0 ] && mkdir -p out/dir && echo written > out/dir/file'),
      );

      expect(finished).toMatchObject({ outcome: "passed", output: "" });
      for (const path of ["out", "out/dir", "out/dir/file"]) {
        expect(await ownerOf(join(worktree, path))).toEqual(NON_ROOT_OFFICE);
      }
      expect((await stat(join(worktree, "package-lock.json"))).ctimeMs).toBe(untouched.ctimeMs);
    });

    it("has git trust the worktree and the git folder another user owns, the Project setting nothing", async () => {
      await testbed.environments.remove("task-1");
      testbed.knownTasks.tasks.push({ id: "task-2", title: "Task task-2", state: "in-progress" });
      const repository = join(testbed.folder, "git-repository");
      const worktree = join(testbed.folder, "worktrees", "task-2");
      gitIn(testbed.folder, "init", "--quiet", "--initial-branch=main", repository);
      gitIn(repository, "commit", "--quiet", "--allow-empty", "--message", "First");
      gitIn(repository, "worktree", "add", "--quiet", "-b", "task-2", worktree);
      await writeFiles(worktree, GIT_DEFINITION);
      const task: TaskInRunEnvironment = {
        taskId: "task-2",
        projectId: "shop",
        worktree,
        repositoryGitFolder: gitIn(
          worktree,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ).trim(),
        stageRunsFolder: join(testbed.folder, "stage-runs", "task-2"),
        installCommand: "apk add --no-cache git",
        installInputs: ["package-lock.json"],
        installVariables: [],
      };
      // The first check's hand-back leaves the worktree's top folder The Office's user's.
      await registry.run(task, aCommand("true"));
      expect(await ownerOf(worktree)).toEqual(NON_ROOT_OFFICE);

      const trusted = await registry.run(
        task,
        aCommand("git rev-parse HEAD && git status --short"),
      );
      const untrusted = await registry.run(
        task,
        aCommand("unset GIT_CONFIG_COUNT; git rev-parse HEAD"),
      );

      expect(trusted).toMatchObject({ outcome: "passed" });
      expect(trusted.output).toContain(gitIn(worktree, "rev-parse", "HEAD"));
      expect(untrusted).toMatchObject({ outcome: "failed" });
      expect(untrusted.output).toMatch(/dubious ownership/);
    });
  },
);

async function ownerOf(path: string): Promise<{ userId: number; groupId: number }> {
  const { uid, gid } = await lstat(path);
  return { userId: uid, groupId: gid };
}

/** Alpine with git installed as its image is built. */
const GIT_DEFINITION = {
  ...DEFINITION,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: alpine:3.21\n",
};

/**
 * git in the run environment, its user root: a repository the host's user owns would otherwise
 * meet git's "dubious ownership" refusal, which isn't what this test checks.
 */
const GIT = "git -c safe.directory='*' -c user.name=Check -c user.email=check@example.com";

function gitIn(folder: string, ...gitArguments: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Check", "-c", "user.email=check@example.com", ...gitArguments],
    { cwd: folder, encoding: "utf8" },
  );
}
