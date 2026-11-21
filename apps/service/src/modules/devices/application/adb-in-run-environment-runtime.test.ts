import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ComposeCommandLine,
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  DeviceHelperSource,
  officeLabels,
  REAL_RUNTIME_TEST,
  realRuntimeMissing,
  runEnvironmentsTestbed,
  taskIn,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "../../run-environments/index.fixtures.js";
import { DeviceHelperFiles, type TaskInWorktree } from "../../run-environments/index.js";
import { AdbKeyFrames } from "../adapters/device-helper/adb-key-frames.js";
import { AdbKeysForTests } from "../ports/adb-key-repository.fixtures.js";
import { AdbInRunEnvironment } from "./adb-in-run-environment.js";

const CODE = "482913";
const TARGET = "192.168.1.20:37000";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{
    "dockerComposeFile": "compose.yaml",
    "service": "app",
    "overrideCommand": true
  }`,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: busybox:1.37.0\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

/**
 * A fake adb: records its arguments and what it read on its standard input; `start-server`
 * daemonises a sleep as adb's server does, once; `pair` prompts, reads the code and pairs.
 */
const FAKE_ADB = `#!/bin/sh
echo "$*" >> /tmp/adb-argv
case "$1" in
  start-server)
    if [ -f /tmp/adb-server.pid ] && kill -0 "$(cat /tmp/adb-server.pid)" 2>/dev/null; then exit 0; fi
    sleep 600 </dev/null >/dev/null 2>&1 &
    echo $! > /tmp/adb-server.pid
    ;;
  pair)
    printf 'Enter pairing code: '
    cat >> /tmp/adb-stdin
    echo "Successfully paired to $2 [guid=adb-R5CT1234-abcdef]"
    ;;
esac
`;

const missing = await realRuntimeMissing();

describe.skipIf(missing !== undefined)(
  `adb pair in a real run environment${missing ? ` (skipped: ${missing})` : ""}`,
  REAL_RUNTIME_TEST,
  () => {
    const runtime = new ComposeCommandLine();
    let testbed: RunEnvironmentsTestbed;
    let task: TaskInWorktree;
    let adb: AdbInRunEnvironment;

    /** Runs the program in the run environment to its end: its exit code and its output. */
    async function inside(
      programArguments: readonly string[],
      input = "",
      asRoot = false,
    ): Promise<{ exitCode: number | undefined; output: string }> {
      const attached = await testbed.environments.attach(task.taskId, {
        arguments: programArguments,
        asRoot,
      });
      if (attached === undefined) throw new Error("The run environment isn't running.");
      const output: Buffer[] = [];
      attached.stdout.on("data", (chunk: Buffer) => void output.push(chunk));
      attached.stdin.end(input);
      const end = await attached.ended;
      return { exitCode: end.exitCode, output: Buffer.concat(output).toString("utf8") };
    }

    beforeAll(async () => {
      testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS);
      task = taskIn(testbed, "task-adb");
      await writeFiles(task.worktree, DEFINITION);
      await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));
      const installed = await inside(
        [
          "sh",
          "-c",
          "mkdir -p /usr/local/bin && cat > /usr/local/bin/adb && chmod 755 /usr/local/bin/adb",
        ],
        FAKE_ADB,
        true,
      );
      if (installed.exitCode !== 0)
        throw new Error(`The fake adb wasn't installed: ${installed.output}`);
      adb = new AdbInRunEnvironment(
        testbed.environments,
        new DeviceHelperFiles(new DeviceHelperSource(undefined), testbed.folders),
        new AdbKeysForTests(),
        new AdbKeyFrames(),
        testbed.schedule,
      );
    }, REAL_RUNTIME_TEST.timeout);

    afterAll(async () => {
      testbed.knownTasks.tasks = [];
      await testbed.environments.sweep();
      for (const { name } of await runtime.listImages(officeLabels(testbed.folders.instance))) {
        await runtime.removeImage(name);
      }
      await rm(testbed.folder, { recursive: true, force: true });
    }, REAL_RUNTIME_TEST.timeout);

    it("gives the code to adb pair's standard input only, and leaves adb's server running", async () => {
      expect(await adb.pair(task.taskId, TARGET, CODE)).toBeUndefined();

      const stdin = await inside(["cat", "/tmp/adb-stdin"]);
      expect(stdin.output).toBe(`${CODE}\n`);
      const argv = await inside(["cat", "/tmp/adb-argv"]);
      expect(argv.output).toBe(`start-server\npair ${TARGET}\n`);

      // Nowhere else in the run environment: its variables, a process's command line, a script.
      const environment = await inside(["env"]);
      expect(environment.exitCode).toBe(0);
      expect(environment.output).not.toContain(CODE);
      const commandLines = await inside([
        "sh",
        "-c",
        "for f in /proc/[0-9]*/cmdline; do tr '\\0' ' ' < \"$f\"; echo; done",
      ]);
      expect(commandLines.exitCode).toBe(0);
      expect(commandLines.output).not.toContain(CODE);
      const scripts = await inside(
        ["sh", "-c", `grep -rl ${CODE} / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev`],
        "",
        true,
      );
      expect(scripts.output.trim().split("\n")).toEqual(["/tmp/adb-stdin"]);

      // Nor in the Office's own files of the run environment: its compose files and logs.
      const files = await readdir(testbed.folder, { recursive: true, withFileTypes: true });
      const holdingTheCode: string[] = [];
      for (const file of files.filter((entry) => entry.isFile())) {
        const path = join(file.parentPath, file.name);
        if ((await readFile(path, "utf8")).includes(CODE)) holdingTheCode.push(path);
      }
      expect(holdingTheCode).toEqual([]);

      // The server the exec started outlives it.
      const server = await inside(["sh", "-c", 'kill -0 "$(cat /tmp/adb-server.pid)"']);
      expect(server.exitCode).toBe(0);
    });
  },
);
