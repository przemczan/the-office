import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

function aCommand(
  commandLine: string,
  fields: Partial<TaskRunEnvironmentCommand> = {},
): TaskRunEnvironmentCommand {
  return {
    commandLine,
    environment: { set: [{ name: "GREETING", value: "hello" }], unset: [], prependPath: [] },
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
        limits: { cpus: 1, memoryMegabytes: 256, processes: 128 },
        runEnvironmentsAtOnce: 1,
      });
      new ProjectsTaskRunEnvironments(
        registry,
        testbed.environments,
        testbed.knownTasks,
        testbed.folders,
      ).onModuleInit();
    }, REAL_RUNTIME_TEST.timeout);

    afterAll(async () => {
      delete process.env[HOST_ONLY];
      // Everything carries this test's own Office label, so nothing of another Office is touched.
      testbed.knownTasks.tasks = [];
      await testbed.environments.sweep();
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
        installCommand: "echo installed",
        installInputs: ["package-lock.json"],
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
  },
);
