import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEVICE_FRAME_TYPES,
  encodeFrame,
  FrameReader,
  textFrame,
  type DeviceFrame,
  type DeviceRelayServerMessage,
} from "@the-office/contracts";
import type { EventBus } from "../../platform/events/event-bus.js";
import type { Schedule } from "../../platform/schedule/schedule.js";
import {
  DeviceHelperFiles,
  type DeviceHelperArchitecture,
  type RunEnvironmentCommandVariables,
  type RunEnvironments,
  type ScriptedContainerRuntime,
  type TaskInWorktree,
} from "../run-environments/index.js";
import { TaskConnectedDevices } from "../work/index.js";
import type { RelaySocket } from "./adapters/websocket/device-relay-link.js";
import { AdbKeyFrames } from "./adapters/device-helper/adb-key-frames.js";
import { AdbInRunEnvironment } from "./application/adb-in-run-environment.js";
import { AndroidUsbDevices } from "./application/android-usb-devices.js";
import { ConnectedDevices } from "./application/connected-devices.js";
import { AdbKeysForTests } from "./ports/adb-key-repository.fixtures.js";
import { ConnectedDeviceRepository } from "./ports/connected-device-repository.js";
import { ConnectedDevicesForTests } from "./ports/connected-device-repository.fixtures.js";
import { DeviceTasks, type DeviceTask } from "./ports/device-tasks.js";
import { ProjectRunEnvironmentSettings } from "./ports/project-run-environment-settings.js";

export const HELPER_VERSION = "1.4.0";
export const HELPER_ENDPOINT = "127.0.0.1:41234";
export const PROJECT_ID = "shop";

/** A definition the scripted runtime takes, the checks' service `app` as `node`. */
const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "remoteUser": "node" }`,
  ".devcontainer/compose.yaml":
    "services:\n  app:\n    image: node:22\n    command: sleep infinity\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

export class DeviceTasksForTests extends DeviceTasks {
  readonly tasks = new Map<string, DeviceTask>();

  find(taskId: string): Promise<DeviceTask | undefined> {
    return Promise.resolve(this.tasks.get(taskId));
  }
}

export class RunEnvironmentSettingsForTests extends ProjectRunEnvironmentSettings {
  readonly off = new Set<string>();

  isOn(projectId: string): Promise<boolean> {
    return Promise.resolve(!this.off.has(projectId));
  }
}

/**
 * The browser's relay socket in memory: what the service sent (`sent`), and the browser's own
 * messages and close by `fromBrowser` and `browserCloses`.
 */
export class FakeRelaySocket extends EventEmitter implements RelaySocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: (Uint8Array | string)[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | undefined;

  send(data: Uint8Array | string, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    callback?.();
  }

  close(code?: number, reason?: string): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.closedWith = { code, reason };
    this.emit("close");
  }

  /** The browser sends a frame, or a control message. */
  fromBrowser(message: DeviceFrame | object): void {
    if ("payload" in message && "channel" in message) {
      this.emit("message", Buffer.from(encodeFrame(message as DeviceFrame)), true);
    } else {
      this.emit("message", Buffer.from(JSON.stringify(message)), false);
    }
  }

  browserCloses(): void {
    this.close(1001, "");
  }

  /** The states the service told the browser, in order. */
  states(): DeviceRelayServerMessage[] {
    return this.sent
      .filter((message): message is string => typeof message === "string")
      .map((message) => JSON.parse(message) as DeviceRelayServerMessage);
  }

  /** The frames the service sent the browser. */
  frames(): DeviceFrame[] {
    const reader = new FrameReader();
    return this.sent
      .filter((message): message is Uint8Array => typeof message !== "string")
      .flatMap((message) => reader.push(message));
  }
}

/** What a loopback helper does as it starts. */
export interface LoopbackHelperOptions {
  readonly version?: string;
  readonly endpoint?: string;
  /** Says nothing, as a helper that never gets ready. */
  readonly silent?: boolean;
}

/**
 * Answers each helper attached as the Office device helper does: HELLO with the version, READY
 * at the endpoint, then each DATA frame written to it echoed back on its channel.
 */
export function loopbackHelper(
  process: ScriptedAttachedProcess,
  {
    version = HELPER_VERSION,
    endpoint = HELPER_ENDPOINT,
    silent = false,
  }: LoopbackHelperOptions = {},
): void {
  if (silent) return;
  process.print(encodeFrame(textFrame(DEVICE_FRAME_TYPES.hello, version)));
  process.print(encodeFrame(textFrame(DEVICE_FRAME_TYPES.ready, endpoint)));
  const reader = new FrameReader();
  process.stdin.on("data", (chunk: Buffer) => {
    for (const frame of reader.push(chunk)) {
      if (frame.type === DEVICE_FRAME_TYPES.data) process.print(encodeFrame(frame));
    }
  });
}

/**
 * adb in the scripted run environment: whether it is there, what the helper's `adb-key` mode
 * answers, and every adb step the service ran, in order ("command -v adb", "adb-key",
 * "adb kill-server", "adb connect 127.0.0.1:41234").
 */
export class ScriptedAdb {
  present = true;
  /** Whether `command -v adb` is cut off with no exit code, as when its run environment stops. */
  checkStopped = false;
  /** What `adb-key` answers: `written` the first time, `same` after, unless set. */
  keyAnswer: "written" | "same" | undefined;
  readonly steps: string[] = [];
  /** What each `adb-key` step read on its standard input. */
  readonly keyInputs: Buffer[] = [];
  private keyWritten = false;

  /** Answers the attached program when it is an adb step; false for anything else. */
  answer(process: ScriptedAttachedProcess): boolean {
    const programArguments = process.attachment.arguments;
    if (programArguments.join(" ") === "sh -c command -v adb") {
      this.steps.push("command -v adb");
      if (this.checkStopped) process.stop();
      else process.end(this.present ? 0 : 1);
      return true;
    }
    if (programArguments[1] === "adb-key") {
      process.stdin.on("finish", () => {
        this.steps.push("adb-key");
        this.keyInputs.push(process.written());
        const answer = this.keyAnswer ?? (this.keyWritten ? "same" : "written");
        this.keyWritten = true;
        process.print(`${answer}\n`);
        process.end(0);
      });
      return true;
    }
    const adbArguments =
      programArguments[0] === "adb"
        ? programArguments.slice(1)
        : programArguments[0] === "sh" && programArguments[3] === "sh"
          ? programArguments.slice(4)
          : undefined;
    if (adbArguments === undefined) return false;
    this.steps.push(`adb ${adbArguments.join(" ")}`);
    if (adbArguments[0] === "connect") process.print(`connected to ${adbArguments[1]}\n`);
    process.end(0);
    return true;
  }
}

/** Frames written to a helper's standard input. */
export function framesWrittenTo(process: ScriptedAttachedProcess): DeviceFrame[] {
  return new FrameReader().push(process.written());
}

type ScriptedAttachedProcess = ScriptedContainerRuntime["attached"][number];

/** What the testbed takes of Run environments' own (`runEnvironmentsTestbed`, from its fixtures). */
export interface RunEnvironmentsOfTestbed {
  readonly environments: RunEnvironments;
  readonly folders: ConstructorParameters<typeof DeviceHelperFiles>[1];
  readonly knownTasks: { tasks: { id: string; title: string; state: string }[] };
  readonly schedule: Schedule;
  readonly events: EventBus;
  readonly commandVariables: RunEnvironmentCommandVariables;
  readonly folder: string;
}

export interface DevicesTestbed<Environments extends RunEnvironmentsOfTestbed> {
  readonly devices: ConnectedDevices;
  readonly adb: ScriptedAdb;
  readonly adbKeys: AdbKeysForTests;
  readonly repository: ConnectedDeviceRepository;
  readonly tasks: DeviceTasksForTests;
  readonly settings: RunEnvironmentSettingsForTests;
  readonly taskDevices: TaskConnectedDevices;
  readonly runtime: ScriptedContainerRuntime;
  readonly environments: Environments;
  /** Adds an open Task of the Project, in a worktree with a valid definition. */
  addTask(id: string, title?: string): Promise<TaskInWorktree>;
}

/**
 * Connected devices on the run environments' testbed and its scripted runtime, each helper
 * attached a loopback one and each adb step answered by `ScriptedAdb`, the helper built at
 * `HELPER_VERSION` for both machines, every Project's Run environment On unless turned off.
 */
export async function devicesTestbed<Environments extends RunEnvironmentsOfTestbed>(
  runtime: ScriptedContainerRuntime,
  environments: Environments,
  repository: ConnectedDeviceRepository = new ConnectedDevicesForTests(),
): Promise<DevicesTestbed<Environments>> {
  const adb = new ScriptedAdb();
  runtime.onAttach = (process) => {
    if (!adb.answer(process)) loopbackHelper(process);
  };
  const helperFiles = new DeviceHelperFiles(
    { folder: await builtHelper(join(environments.folder, "helper-dist")) },
    environments.folders,
  );
  await helperFiles.copy();
  const tasks = new DeviceTasksForTests();
  const settings = new RunEnvironmentSettingsForTests();
  const taskDevices = new TaskConnectedDevices();
  const adbKeys = new AdbKeysForTests();
  const androidUsb = new AndroidUsbDevices(
    new AdbInRunEnvironment(
      environments.environments,
      helperFiles,
      adbKeys,
      new AdbKeyFrames(),
      environments.schedule,
    ),
    environments.schedule,
  );
  const devices = new ConnectedDevices(
    repository,
    tasks,
    settings,
    environments.environments,
    helperFiles,
    environments.commandVariables,
    taskDevices,
    environments.schedule,
    environments.events,
    androidUsb,
  );
  devices.onModuleInit();
  return {
    devices,
    adb,
    adbKeys,
    repository,
    tasks,
    settings,
    taskDevices,
    runtime,
    environments,
    async addTask(id, title = `Task ${id}`) {
      tasks.tasks.set(id, { id, title, projectId: PROJECT_ID, state: "in-progress" });
      environments.knownTasks.tasks.push({ id, title, state: "in-progress" });
      const task: TaskInWorktree = {
        taskId: id,
        taskTitle: title,
        projectId: PROJECT_ID,
        worktree: join(environments.folder, "worktrees", id),
        repositoryGitFolder: join(environments.folder, "worktrees", id, ".git"),
        stageRunsFolder: join(environments.folder, "stage-runs", id),
        installCommand: "echo installed",
        installInputs: ["package-lock.json"],
        installVariables: [],
      };
      for (const [path, content] of Object.entries(DEFINITION)) {
        await mkdir(dirname(join(task.worktree, path)), { recursive: true });
        await writeFile(join(task.worktree, path), content);
      }
      return task;
    },
  };
}

async function builtHelper(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const architectures: DeviceHelperArchitecture[] = ["x86_64", "aarch64"];
  for (const architecture of architectures) {
    await writeFile(join(folder, `office-device-helper-${architecture}`), "#!/bin/sh\n");
  }
  await writeFile(join(folder, "version"), HELPER_VERSION);
  return folder;
}
