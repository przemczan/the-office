import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  controlPayload,
  DEVICE_CONTROL_CHANNEL,
  DEVICE_FRAME_TYPES,
  FrameReader,
  frameText,
  serialSettingsSchema,
  type DeviceFrame,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DeviceHelperFiles,
  DeviceHelperSource,
  type DeviceHelperArchitecture,
} from "../../application/device-helper-files.js";
import {
  runEnvironmentsTestbed,
  taskIn,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "../../application/run-environments.fixtures.js";
import { NO_MASK } from "../scripted/scripted-container-runtime.js";
import {
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  officeLabels,
  type TaskInWorktree,
} from "../../domain/run-environment.js";
import { REAL_RUNTIME_TEST, realRuntimeMissing } from "./compose-command-line.fixtures.js";
import { ComposeCommandLine } from "./compose-command-line.js";

/** `npm run build:device-helper`'s output, from this file in the service's src/. */
const HELPER_BUILD = fileURLToPath(
  new URL("../../../../../../../tools/device-helper/dist", import.meta.url),
);

/** The runtime runs containers of this computer's machine. */
const ARCHITECTURE: DeviceHelperArchitecture = process.arch === "arm64" ? "aarch64" : "x86_64";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{
    "dockerComposeFile": "compose.yaml",
    "service": "app",
    "overrideCommand": true
  }`,
  ".devcontainer/compose.yaml": "services:\n  app:\n    image: busybox:1.37.0\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

async function helperMissing(): Promise<string | undefined> {
  return access(join(HELPER_BUILD, `office-device-helper-${ARCHITECTURE}`)).then(
    () => undefined,
    () => "the Office device helper isn't built (npm run build:device-helper)",
  );
}

const missing = (await realRuntimeMissing()) ?? (await helperMissing());

/** Every frame the stream carries from now on, however it is chunked. */
class Frames {
  readonly all: DeviceFrame[] = [];
  private readonly reader = new FrameReader();
  private readonly waiting = new Set<() => void>();

  constructor(stream: Readable) {
    stream.on("data", (chunk: Buffer) => {
      this.all.push(...this.reader.push(chunk));
      for (const wake of this.waiting) wake();
    });
  }

  /** The first frame of the type, once it came, for up to 30 s. */
  of(type: DeviceFrame["type"]): Promise<DeviceFrame> {
    return this.where((frame) => frame.type === type, `of type ${type}`);
  }

  /** The first frame that matches, once it came, for up to 30 s. */
  where(matches: (frame: DeviceFrame) => boolean, what = "that matches"): Promise<DeviceFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(look);
        reject(new Error(`No frame ${what} came, only ${this.all.length} others.`));
      }, 30_000);
      const look = (): void => {
        const found = this.all.find(matches);
        if (found === undefined) return;
        clearTimeout(timer);
        this.waiting.delete(look);
        resolve(found);
      };
      this.waiting.add(look);
      look();
    });
  }
}

describe.skipIf(missing !== undefined)(
  `The Office device helper on the real container runtime${missing ? ` (skipped: ${missing})` : ""}`,
  REAL_RUNTIME_TEST,
  () => {
    const runtime = new ComposeCommandLine();
    let testbed: RunEnvironmentsTestbed;
    let task: TaskInWorktree;
    let helper: DeviceHelperFiles;

    beforeAll(async () => {
      testbed = await runEnvironmentsTestbed(runtime, DEFAULT_RUN_ENVIRONMENT_OPTIONS);
      helper = new DeviceHelperFiles(new DeviceHelperSource(HELPER_BUILD), testbed.folders);
      await helper.copy();
      task = taskIn(testbed, "task-1");
      await writeFiles(task.worktree, DEFINITION);
      await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"));
    }, REAL_RUNTIME_TEST.timeout);

    afterAll(async () => {
      testbed.knownTasks.tasks = [];
      await testbed.environments.sweep();
      for (const { name } of await runtime.listImages(officeLabels(testbed.folders.instance))) {
        await runtime.removeImage(name);
      }
      await rm(testbed.folder, { recursive: true, force: true });
    }, REAL_RUNTIME_TEST.timeout);

    it("relays a connection made inside the run environment, and ends at stop", async () => {
      const executable = await helper.executableFor(ARCHITECTURE);
      const attached = await testbed.environments.attach(task.taskId, {
        arguments: [executable ?? "", "relay", "--listen", "127.0.0.1:0"],
      });
      if (attached === undefined) throw new Error("The run environment isn't running.");
      const frames = new Frames(attached.stdout);

      const hello = await frames.of(DEVICE_FRAME_TYPES.hello);
      const ready = await frames.of(DEVICE_FRAME_TYPES.ready);
      expect(frames.all.indexOf(hello)).toBe(0);
      expect(await helper.helloProblemOf(frameText(hello))).toBeUndefined();
      const port = frameText(ready).split(":")[1];

      const end = await testbed.environments.run(task, {
        commandLine: `echo hi | timeout 3 nc 127.0.0.1 ${port}; true`,
        environment: { set: [], unset: [], prependPath: [] },
        mask: NO_MASK,
        timeoutMs: 60_000,
        outputFile: join(testbed.folder, "nc.log"),
      });
      const open = await frames.of(DEVICE_FRAME_TYPES.open);
      const data = await frames.of(DEVICE_FRAME_TYPES.data);

      expect(end).toMatchObject({ exitCode: 0 });
      expect(data.channel).toBe(open.channel);
      expect(frameText(data)).toBe("hi\n");

      attached.stop();
      expect(await attached.ended).toMatchObject({ endedBy: "stop" });
    });

    it("makes a serial board's path as root, handed to the checks' user, carrying its baud rate and bytes", async () => {
      // The definition names no user: the checks run as busybox's root.
      expect(await testbed.environments.checksUserOf(task.taskId)).toBe("0:0");
      const executable = await helper.executableFor(ARCHITECTURE);
      const attached = await testbed.environments.attach(task.taskId, {
        arguments: [
          executable ?? "",
          "pty",
          "--path-prefix",
          "/dev/ttyACM",
          "--owner",
          "1000:1000",
        ],
        asRoot: true,
      });
      if (attached === undefined) throw new Error("The run environment isn't running.");
      const frames = new Frames(attached.stdout);

      const ready = await frames.of(DEVICE_FRAME_TYPES.ready);
      expect(frameText(ready)).toBe("/dev/ttyACM0");

      // As the checks' user the pty was handed to, not as root.
      const end = await testbed.environments.run(task, {
        commandLine:
          "chpst -u 1000:1000 stty -F /dev/ttyACM0 115200 && chpst -u 1000:1000 sh -c 'echo hi > /dev/ttyACM0'",
        environment: { set: [], unset: [], prependPath: [] },
        mask: NO_MASK,
        timeoutMs: 60_000,
        outputFile: join(testbed.folder, "tty.log"),
      });
      expect(end).toMatchObject({ exitCode: 0 });
      const settings = await frames.where(
        (frame) =>
          frame.type === DEVICE_FRAME_TYPES.settings &&
          controlPayload(frame, serialSettingsSchema)?.baudRate === 115_200,
      );
      const data = await frames.of(DEVICE_FRAME_TYPES.data);

      expect(settings.channel).toBe(DEVICE_CONTROL_CHANNEL);
      expect(frames.all.indexOf(settings)).toBeLessThan(frames.all.indexOf(data));
      expect(frameText(data)).toBe("hi\n");

      attached.stop();
      expect(await attached.ended).toMatchObject({ endedBy: "stop" });
    });
  },
);
