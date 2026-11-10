import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OutputMask } from "../../../projects/index.js";
import { TaskStateChanged } from "../../../work/index.js";
import {
  runEnvironmentsTestbed,
  taskIn,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "../../application/run-environments.fixtures.js";
import { RunEnvironmentRemoved } from "../../domain/run-environment-events.js";
import {
  officeLabels,
  taskLabels,
  type RunEnvironmentOptions,
  type TaskInWorktree,
} from "../../domain/run-environment.js";
import {
  containerLimitsOf,
  REAL_RUNTIME_TEST,
  realRuntimeMissing,
} from "./compose-command-line.fixtures.js";
import { ComposeCommandLine } from "./compose-command-line.js";

const OPTIONS: RunEnvironmentOptions = {
  limits: {
    cpuLimit: { choice: "fixed", fixedCpus: 1 },
    memoryMegabytes: 256,
    processes: 128,
  },
  runEnvironmentsAtOnce: 2,
};

/** The checks' service and a web server beside it, with a named volume. */
const DEFINITION = {
  ".devcontainer/devcontainer.json": `{
    "dockerComposeFile": "compose.yaml",
    "service": "app",
    "overrideCommand": true
  }`,
  ".devcontainer/compose.yaml": `
services:
  app:
    image: busybox:1.37.0
  web:
    image: busybox:1.37.0
    # httpd as process 1 would ignore the stop signal, and every removal would wait it out.
    init: true
    command: ["sh", "-c", "mkdir -p /www && echo hello-from-web > /www/index.html && exec httpd -f -p 8080 -h /www"]
    volumes:
      - data:/data
volumes:
  data: {}
`,
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

const missing = await realRuntimeMissing();

describe.skipIf(missing !== undefined)(
  `ComposeCommandLine on the real container runtime${missing ? ` (skipped: ${missing})` : ""}`,
  REAL_RUNTIME_TEST,
  () => {
    const runtime = new ComposeCommandLine();
    let testbed: RunEnvironmentsTestbed;
    let task: TaskInWorktree;

    beforeAll(async () => {
      testbed = await runEnvironmentsTestbed(runtime, OPTIONS);
      // The install sees the Project's variables, a Secret variable as a BuildKit secret.
      task = {
        ...taskIn(testbed, "task-1"),
        installCommand: 'test "$INSTALL_TOKEN" = s3cret-install && echo installed > marker',
        installVariables: [{ name: "INSTALL_TOKEN", value: "s3cret-install", secret: true }],
      };
      await writeFiles(task.worktree, DEFINITION);
      await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));
    }, REAL_RUNTIME_TEST.timeout);

    afterAll(async () => {
      // Everything carries this test's own Office label, so nothing of another Office is touched.
      testbed.knownTasks.tasks = [];
      await testbed.environments.sweep();
      for (const { name } of await runtime.listImages(officeLabels(testbed.folders.instance))) {
        await runtime.removeImage(name);
      }
      await rm(testbed.folder, { recursive: true, force: true });
    }, REAL_RUNTIME_TEST.timeout);

    it("runs a check that reaches the other service and writes into the mounted worktree", async () => {
      const output = join(testbed.folder, "check.log");

      const end = await testbed.environments.run(task, {
        commandLine: [
          "for attempt in 1 2 3 4 5 6 7 8 9 10; do",
          "  wget -q -O from-web.txt http://web:8080/ && break; sleep 1",
          "done",
          'echo "variable: $GREETING"',
          'echo "secret: $SECRET_TOKEN"',
          "cat /office-install/marker",
          "exit 3",
        ].join("\n"),
        environment: {
          set: [
            { name: "GREETING", value: "hello" },
            { name: "SECRET_TOKEN", value: "s3cret-token" },
          ],
          unset: [],
          prependPath: [],
        },
        mask: new OutputMask([{ name: "SECRET_TOKEN", value: "s3cret-token" }]),
        timeoutMs: 60_000,
        outputFile: output,
      });

      expect(end).toMatchObject({ exitCode: 3 });
      expect(await readFile(join(task.worktree, "from-web.txt"), "utf8")).toBe("hello-from-web\n");
      expect(await readFile(output, "utf8")).toBe(
        "variable: hello\nsecret: [secret SECRET_TOKEN]\ninstalled\n",
      );
    });

    it("gives the Task its own network and volume, and limits every service", async () => {
      const resources = await runtime.listByLabel(taskLabels(testbed.folders.instance, "task-1"));
      const containers = resources.filter(({ kind }) => kind === "container");

      expect(containers).toHaveLength(2);
      expect(resources.filter(({ kind }) => kind === "network")).toHaveLength(1);
      expect(resources.filter(({ kind }) => kind === "volume")).toHaveLength(1);
      for (const { id } of containers) {
        expect(await containerLimitsOf(id)).toEqual({
          nanoCpus: 1_000_000_000,
          memoryBytes: 256 * 1024 * 1024,
          processes: 128,
        });
      }
    });

    it("ends a check that runs past its time, and the next check runs", async () => {
      const slow = await testbed.environments.run(task, {
        commandLine: "sleep 30",
        environment: { set: [], unset: [], prependPath: [] },
        mask: OutputMask.NONE,
        timeoutMs: 1_000,
        outputFile: join(testbed.folder, "slow.log"),
      });
      const next = await testbed.environments.run(task, {
        commandLine: "true",
        environment: { set: [], unset: [], prependPath: [] },
        mask: OutputMask.NONE,
        timeoutMs: 60_000,
        outputFile: join(testbed.folder, "next.log"),
      });

      expect(slow).toMatchObject({ exitCode: undefined, endedBy: "timeout" });
      expect(next).toMatchObject({ exitCode: 0 });
    });

    it("runs a check in the new folder once the worktree is removed and added again", async () => {
      // As Publish removes the worktree and the next Stage adds it at the same path: the running
      // containers keep the old folder, and exec into it fails in the runtime with exit code 128.
      await rm(task.worktree, { recursive: true, force: true });
      await writeFiles(task.worktree, { ...DEFINITION, "new-folder.txt": "new\n" });
      const output = join(testbed.folder, "replaced.log");
      const startOutput = join(testbed.folder, "replaced-start.log");

      const end = await testbed.environments.run(task, {
        commandLine: "pwd && cat new-folder.txt && echo ok",
        environment: { set: [], unset: [], prependPath: [] },
        mask: OutputMask.NONE,
        timeoutMs: 60_000,
        outputFile: output,
        startOutputFile: startOutput,
      });

      expect(end).toMatchObject({ exitCode: 0 });
      expect(await readFile(output, "utf8")).toBe(`${task.worktree}\nnew\nok\n`);
      expect(await readFile(startOutput, "utf8")).toContain("The Task's worktree was replaced");
    });

    it("removes the Task's containers, network and volume by its label when it is Done", async () => {
      const removed = vi.fn<(event: RunEnvironmentRemoved) => void>();
      testbed.events.subscribe(RunEnvironmentRemoved, removed);

      await testbed.events.publish(new TaskStateChanged("task-1", "in-progress", "done"));

      await vi.waitFor(() => expect(removed).toHaveBeenCalledOnce(), { timeout: 60_000 });
      expect(await runtime.listByLabel(taskLabels(testbed.folders.instance, "task-1"))).toEqual([]);
    });

    it("sweeps a leftover whose Task isn't open, and keeps an open Task's", async () => {
      const leftover = taskIn(testbed, "leftover");
      const open = taskIn(testbed, "open");
      for (const each of [leftover, open]) {
        await writeFiles(each.worktree, DEFINITION);
        await testbed.environments.prepare(each, join(testbed.folder, `${each.taskId}.log`));
      }
      testbed.knownTasks.tasks = [{ id: "open", title: "Open", state: "in-progress" }];

      await testbed.environments.sweep();

      const instance = testbed.folders.instance;
      expect(await runtime.listByLabel(taskLabels(instance, "leftover"))).toEqual([]);
      expect(await runtime.listByLabel(taskLabels(instance, "open"))).not.toEqual([]);
    });
  },
);
