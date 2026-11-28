import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ProjectFeaturesChanged, ProjectRunEnvironmentChanged } from "../../projects/index.js";
import {
  DEVICE_HELPER_NOT_BUILT,
  DeviceHelperFiles,
  RunEnvironmentCommandVariables,
  RunEnvironmentRefused,
  RunEnvironmentRemoved,
  RunEnvironments,
  RunEnvironmentStarted,
  RunEnvironmentStopped,
} from "../../run-environments/index.js";
import {
  TaskConnectedDevices,
  TaskStateChanged,
  type TaskConnectedDevice,
} from "../../work/index.js";
import {
  ALREADY_IN_THIS_TASK,
  alreadyConnectedTo,
  androidSerialOf,
  connectedDevicesVariable,
  connectingDevice,
  connectProblemsOf,
  adbSerialOf,
  detailsOf,
  deviceBaudRateSet,
  deviceConnected,
  deviceDisconnected,
  deviceNoticed,
  deviceRoundTripMeasured,
  deviceWaiting,
  heldDevice,
  holdProblemOf,
  isOpen,
  KIND_WORDS,
  lentDevice,
  letGoBeforeConnecting,
  notPluggedIn,
  phonePaired,
  RUN_ENVIRONMENT_NOT_RUNNING,
  STATE_WORDS,
  taskProblemsOf,
  type ConnectedDevice,
  type ConnectedDeviceChange,
  type ConnectedDeviceKind,
  type DeviceConnector,
  type DeviceUser,
  type DisconnectedBecause,
} from "../domain/connected-device.js";
import {
  ConnectedDeviceNotFound,
  ConnectedDeviceRefused,
} from "../domain/connected-device-refused.js";
import type { ConnectedDeviceChanged } from "../domain/connected-device-events.js";
import {
  beingPaired,
  inUseBy,
  NOT_ONE_OF_THE_PROJECTS,
  notOfTheTasksProject,
} from "../domain/project-device.js";
import {
  ProjectDeviceNotFound,
  ProjectDeviceRefused,
  type ProjectDeviceHolder,
} from "../domain/project-device-refused.js";
import { wirelessAddressOf, wirelessDeviceKeyOf } from "../domain/wireless-address.js";
import { ConnectedDeviceRepository } from "../ports/connected-device-repository.js";
import { DeviceTasks, type DeviceTask } from "../ports/device-tasks.js";
import {
  ProjectDeviceRepository,
  type LockedProjectDevice,
} from "../ports/project-device-repository.js";
import { ProjectDeviceFeature } from "../ports/project-features.js";
import { ProjectRunEnvironmentSettings } from "../ports/project-run-environment-settings.js";
import type { HelperOpening, HelperProcess, RelayClose, RelayLink } from "../ports/relay-link.js";
import { RunEnvironmentStart } from "../ports/run-environment-start.js";
import { AdbInRunEnvironment, type AdbPlace } from "./adb-in-run-environment.js";
import { AndroidUsbDevices, type ConnectedAndroidPhone } from "./android-usb-devices.js";
import type { DeviceHold, DeviceHoldRequest, HoldingEnvironment } from "./device-holds.js";
import { hostHelperArchitecture } from "./device-helper-architecture.js";
import {
  WirelessDevices,
  type PairedPhone,
  type PhoneToPair,
  type WirelessEnd,
} from "./wireless-devices.js";

/** The variable every check in a Task's run environment gets (spec §2.13, "What Agents see"). */
export const CONNECTED_DEVICES_VARIABLE = "OFFICE_CONNECTED_DEVICES";
/** The serial adb uses when one Android phone is Connected, unless the Project sets its own. */
export const ANDROID_SERIAL_VARIABLE = "ANDROID_SERIAL";

/** Where the helper's serial mode makes a board's path: `/dev/ttyACM0`, then on (spec §2.13). */
export const SERIAL_PATH_PREFIX = "/dev/ttyACM";

/** How long a helper has to say HELLO and READY before its device ends as an error. */
export const HELPER_START_TIMEOUT_MS = 10_000;

/**
 * How long a run's device over USB waits for the starting tab to open its relay: the helper's
 * wait, plus time for the tab to find the device, or for the user to pick it in the browser's
 * picker. Once the relay opens, the helper's own wait bounds the rest.
 */
export const HELD_RELAY_WAIT_MS = HELPER_START_TIMEOUT_MS + 50_000;

/** What the browser reached, to connect. */
export interface DeviceToConnect {
  readonly kind: ConnectedDeviceKind;
  readonly name: string;
  readonly deviceKey: string;
}

/** What the user entered to pair a phone over wireless debugging, from its Wireless debugging screen. */
export interface WirelessPhoneToPair {
  readonly address: string;
  readonly port: number;
  readonly pairingPort: number;
  /** Used once, on `adb pair`'s standard input, and never kept. */
  readonly pairingCode: string;
}

/** A Project device to lend a Task, with no pairing (spec §2.13, "Lent to a Task"). */
export interface DeviceToLend {
  readonly projectDeviceId: string;
  readonly projectId: string;
  readonly kind: ConnectedDeviceKind;
  readonly name: string;
  readonly deviceKey: string;
  /** A phone over wireless debugging's adb serial, `<address>:<port>`; null for a device over USB. */
  readonly wirelessEndpoint: string | null;
}

/** A Project device a run holds, as Project devices found it. */
export interface DeviceToHold {
  readonly projectDeviceId: string;
  readonly kind: ConnectedDeviceKind;
  readonly name: string;
  readonly deviceKey: string;
  /** A phone over wireless debugging's adb serial, `<address>:<port>`; null for a device over USB. */
  readonly wirelessEndpoint: string | null;
}

/** A device's open relay socket. */
interface Relay {
  readonly link: RelayLink;
}

/**
 * Where a device's helper and adb run: its Task's run environment, or the run's own environment
 * that holds it, which is running while the hold is kept in this process.
 */
interface DeviceEnvironment {
  readonly adb: AdbPlace;
  isRunning(): boolean;
  /** The uid:gid of the checks' user there; undefined when it isn't running. */
  checksUser(): Promise<string | undefined>;
}

/** How a store of the Project device's row ended, under its lock. */
type LockedInsert =
  | { readonly kind: "kept" }
  | { readonly kind: "held"; readonly by: ConnectedDevice }
  | { readonly kind: "refused"; readonly reasons: readonly string[] };

/**
 * Connected devices (spec §2.13): connect and disconnect, each device's relay socket and helper,
 * and how they follow the Task, its run environment and its Project's Run environment setting.
 * Relays live in memory: an Office restart drops every socket, so the sweep ends the open
 * records relayed as tab closed; a phone over wireless debugging, which has none, waits for the
 * run environment instead. A run's hold of a Project device is a record too, in the run's own
 * environment, which lives in memory as well: the sweep ends every hold as run ended.
 */
@Injectable()
export class ConnectedDevices implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(ConnectedDevices.name);
  private readonly locks = new KeyedLocks();
  private readonly relays = new Map<string, Relay>();
  /** Each run's hold this process keeps, by its record's id: the run's environment holding it. */
  private readonly holds = new Map<string, HoldingEnvironment>();
  /** Each hold not yet answered, told its record once it is ready to use or Disconnected. */
  private readonly holdWaits = new Map<string, (device: ConnectedDevice) => void>();

  constructor(
    private readonly repository: ConnectedDeviceRepository,
    private readonly tasks: DeviceTasks,
    private readonly runEnvironmentSettings: ProjectRunEnvironmentSettings,
    private readonly environments: RunEnvironments,
    private readonly helperFiles: DeviceHelperFiles,
    private readonly commandVariables: RunEnvironmentCommandVariables,
    private readonly taskDevices: TaskConnectedDevices,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
    private readonly androidUsb: AndroidUsbDevices,
    private readonly wireless: WirelessDevices,
    private readonly environmentStart: RunEnvironmentStart,
    private readonly deviceFeature: ProjectDeviceFeature,
    private readonly adb: AdbInRunEnvironment,
    private readonly projectDevices: ProjectDeviceRepository,
  ) {}

  onModuleInit(): void {
    this.taskDevices.register((taskId) => this.wordsOf(taskId));
    this.commandVariables.register(async (taskId) => {
      const open = await this.repository.openOfTask(taskId);
      const androidSerial = androidSerialOf(open);
      return [
        { name: CONNECTED_DEVICES_VARIABLE, value: connectedDevicesVariable(open) },
        ...(androidSerial === undefined
          ? []
          : [{ name: ANDROID_SERIAL_VARIABLE, value: androidSerial, unlessProjectSets: true }]),
      ];
    });
    // The bus waits for these: a start's handler is done, never throwing, before its first check.
    this.events.subscribe(RunEnvironmentStarted, ({ taskId }) => this.environmentStarted(taskId));
    this.events.subscribe(RunEnvironmentStopped, ({ taskId }) => this.environmentStopped(taskId));
    this.events.subscribe(RunEnvironmentRemoved, ({ taskId }) =>
      this.disconnectAll(this.repository.openOfTask(taskId), "task-ended"),
    );
    this.events.subscribe(TaskStateChanged, ({ taskId, to }) => {
      if (to !== "done" && to !== "dropped") return;
      return this.disconnectAll(this.repository.openOfTask(taskId), "task-ended");
    });
    this.events.subscribe(ProjectRunEnvironmentChanged, ({ projectId, runEnvironment }) => {
      if (runEnvironment === "on") return;
      return this.projectSwitchedOff(projectId, "run-environment-turned-off");
    });
    // Connected devices reads off whenever Run environment isn't On, so both events may come.
    this.events.subscribe(ProjectFeaturesChanged, ({ projectId, features }) => {
      if (features["connected-devices"]) return;
      return this.projectSwitchedOff(projectId, "connected-devices-switched-off");
    });
  }

  /** The Task's devices, the newest connected first, Disconnected ones kept as history. */
  async list(taskId: string): Promise<readonly ConnectedDevice[]> {
    if ((await this.tasks.find(taskId)) === undefined) throw ConnectedDeviceNotFound.task(taskId);
    return this.repository.listOfTask(taskId);
  }

  /**
   * Every Task's device not Disconnected, across The Office, the earliest connected first; a run's
   * hold shows as its run instead.
   */
  async open(): Promise<readonly (ConnectedDevice & { readonly taskId: string })[]> {
    return (await this.repository.allOpen()).filter(
      (device): device is ConnectedDevice & { readonly taskId: string } => device.taskId !== null,
    );
  }

  /** Every run's hold this process keeps is let go of as the service stops: no run outlives it. */
  async beforeApplicationShutdown(): Promise<void> {
    for (const id of this.holds.keys()) {
      await this.letGo(id).catch((error: unknown) => {
        this.logger.warn(`The hold ${id} wasn't let go of as the service stopped.`, error);
      });
    }
  }

  async read(id: string): Promise<ConnectedDevice> {
    const device = await this.repository.find(id);
    if (device === undefined) throw ConnectedDeviceNotFound.device(id);
    return device;
  }

  /**
   * Keeps a Connecting record for the device the browser reached, whose relay it opens next.
   * Refused, with every reason, unless the Task is open, its Project's Run environment On and
   * Connected devices switched on, the kind relayed and the helper built; then refused naming the
   * other Task when an open record holds the device key. Never starts the run environment.
   */
  async connect(taskId: string, given: DeviceToConnect, by: DeviceUser): Promise<ConnectedDevice> {
    const task = await this.tasks.find(taskId);
    if (task === undefined) throw ConnectedDeviceNotFound.task(taskId);
    const runEnvironmentOn = await this.runEnvironmentSettings.isOn(task.projectId);
    const problems = connectProblemsOf({
      taskState: task.state,
      runEnvironmentOn,
      kind: given.kind,
    });
    problems.push(...(await this.switchedOffReasons(task, runEnvironmentOn)));
    if (
      problems.length === 0 &&
      (await this.helperFiles.executableFor(hostHelperArchitecture())) === undefined
    ) {
      problems.push(DEVICE_HELPER_NOT_BUILT);
    }
    if (problems.length > 0) throw new ConnectedDeviceRefused(problems);
    const { device, event } = connectingDevice({
      id: randomUUID(),
      taskId,
      projectId: task.projectId,
      kind: given.kind,
      name: given.name,
      deviceKey: given.deviceKey,
      connectedBy: by,
      connectedAt: this.schedule.now(),
    });
    await this.keep(device, event);
    return device;
  }

  /**
   * Keeps a Connecting record for a phone over wireless debugging and pairs with it in the
   * background: the run environment started first when it isn't running (the one start a device
   * makes), then adb's check, the Project's key, `adb pair` with the code on its standard input and
   * `adb connect`, Connected or ended as an error with adb's words. Refused, with every reason,
   * unless the Task is open, its Project's Run environment On and Connected devices switched on,
   * the address one the run environment can reach and the helper built (it writes the key); then
   * refused naming the other Task when an open record holds the address. The code is never kept.
   */
  async pair(taskId: string, given: WirelessPhoneToPair, by: DeviceUser): Promise<ConnectedDevice> {
    const task = await this.tasks.find(taskId);
    if (task === undefined) throw ConnectedDeviceNotFound.task(taskId);
    const runEnvironmentOn = await this.runEnvironmentSettings.isOn(task.projectId);
    const problems = taskProblemsOf({ taskState: task.state, runEnvironmentOn });
    problems.push(...(await this.switchedOffReasons(task, runEnvironmentOn)));
    const reading = wirelessAddressOf(given.address);
    if ("problem" in reading) problems.push(reading.problem);
    if (
      problems.length === 0 &&
      (await this.helperFiles.executableFor(hostHelperArchitecture())) === undefined
    ) {
      problems.push(DEVICE_HELPER_NOT_BUILT);
    }
    if (problems.length > 0 || "problem" in reading) throw new ConnectedDeviceRefused(problems);
    const { device, event } = connectingDevice({
      id: randomUUID(),
      taskId,
      projectId: task.projectId,
      kind: "android-wireless",
      name: reading.address.address,
      deviceKey: wirelessDeviceKeyOf(reading.address),
      connectedBy: by,
      connectedAt: this.schedule.now(),
    });
    await this.keep(device, event);
    const target = { address: reading.address, port: given.port, pairingPort: given.pairingPort };
    this.followPairing(taskId, device, target, given.pairingCode);
    return device;
  }

  /**
   * Lends the Project device to the Task as one of its Connected devices, with no pairing: a
   * device over USB Connecting, whose relay the browser opens next; a phone over wireless
   * debugging Waiting at its adb serial, connected again at once with the Project's key while the
   * run environment runs, else at its next start. Refused as a connect is (ProjectDeviceRefused),
   * while it pairs, and naming the holder when an open record holds it or its device key: the
   * check and the record's insert run holding the Project device's row. Never starts the run
   * environment.
   */
  async lend(taskId: string, lent: DeviceToLend, by: DeviceConnector): Promise<ConnectedDevice> {
    const task = await this.tasks.find(taskId);
    if (task === undefined) throw ConnectedDeviceNotFound.task(taskId);
    if (task.projectId !== lent.projectId) {
      throw new ProjectDeviceRefused([notOfTheTasksProject(lent)]);
    }
    const runEnvironmentOn = await this.runEnvironmentSettings.isOn(task.projectId);
    const problems = taskProblemsOf({ taskState: task.state, runEnvironmentOn });
    problems.push(...(await this.switchedOffReasons(task, runEnvironmentOn)));
    if (
      problems.length === 0 &&
      (await this.helperFiles.executableFor(hostHelperArchitecture())) === undefined
    ) {
      problems.push(DEVICE_HELPER_NOT_BUILT);
    }
    if (problems.length > 0) throw new ProjectDeviceRefused(problems);
    const { device, event } = lentDevice(
      {
        id: randomUUID(),
        taskId,
        projectId: task.projectId,
        projectDeviceId: lent.projectDeviceId,
        kind: lent.kind,
        name: lent.name,
        deviceKey: lent.deviceKey,
        connectedBy: by,
        connectedAt: this.schedule.now(),
      },
      lent.wirelessEndpoint,
    );
    const stored = await this.insertLocked(lent.projectDeviceId, device);
    if (stored.kind === "missing") throw new ProjectDeviceNotFound(lent.projectDeviceId);
    await this.refuseUnlessKept(stored, lent);
    await this.events.publish(event);
    if (device.state === "waiting-for-run-environment" && this.environments.isRunning(taskId)) {
      void this.locks
        .runDetached(`adb:${device.id}`, () => this.reconnectWireless(device))
        .catch((error: unknown) => {
          this.logger.error(`The device ${device.id} didn't connect.`, error);
        });
    }
    return device;
  }

  /**
   * Holds the Project device for the run (spec §2.13, "In use"), in the run's own environment,
   * which already runs: a Connecting record naming the run, then a phone over wireless debugging
   * connected with the Project's adb key, never paired, within its reconnect's time; a device over
   * USB relayed from the tab named `relayTab`, which opens its relay as it sees the record, then its
   * helper started there (and adb connected, for a phone). Answers held with the adb serial and the
   * variables for the run's commands, or not held, its record Disconnected, with why in 2.13's
   * words. Refused (ProjectDeviceRefused) while it pairs, and naming the holder while one holds it
   * or its device key: the check and the record's insert run holding the Project device's row.
   * `ProjectDevices.hold` checks the Project first.
   */
  async hold(request: DeviceHoldRequest, held: DeviceToHold): Promise<DeviceHold> {
    const { device, event } = heldDevice({
      id: randomUUID(),
      runHolder: request.holder,
      projectId: request.projectId,
      projectDeviceId: held.projectDeviceId,
      kind: held.kind,
      name: held.name,
      deviceKey: held.deviceKey,
      relayTab: held.kind === "android-wireless" ? null : (request.relayTab ?? null),
      connectedBy: { ...request.startedBy },
      connectedAt: this.schedule.now(),
    });
    if (request.signal?.aborted === true) {
      return { held: false, holdId: undefined, problem: letGoBeforeConnecting(device) };
    }
    // Kept before the record is told, as the tab may open its relay as soon as it sees it.
    this.holds.set(device.id, request.environment);
    const answered = new Promise<ConnectedDevice>((resolve) => {
      this.holdWaits.set(device.id, resolve);
    });
    try {
      const stored = await this.insertLocked(held.projectDeviceId, device, request.projectId);
      if (stored.kind === "missing") throw new ProjectDeviceRefused([NOT_ONE_OF_THE_PROJECTS]);
      await this.refuseUnlessKept(stored, held);
    } catch (error) {
      this.holds.delete(device.id);
      this.holdWaits.delete(device.id);
      throw error;
    }
    await this.events.publish(event);
    const letGo = (): void => {
      void this.letGo(device.id).catch((error: unknown) => {
        this.logger.warn(`The hold ${device.id} wasn't let go of as its request ended.`, error);
      });
    };
    request.signal?.addEventListener("abort", letGo, { once: true });
    // Aborted while the record was kept: no event comes for that any more.
    if (wasAborted(request.signal)) letGo();
    try {
      if (held.kind === "android-wireless") this.connectHeldPhone(device, held.wirelessEndpoint);
      else this.waitForRelay(device);
      const end = await answered;
      if (end.state !== "connected" || end.endpoint === null) {
        return { held: false, holdId: device.id, problem: holdProblemOf(end) };
      }
      const androidSerial = adbSerialOf(end);
      return {
        held: true,
        holdId: device.id,
        deviceName: end.name,
        serial: end.endpoint,
        variables: [
          { name: CONNECTED_DEVICES_VARIABLE, value: connectedDevicesVariable([end]) },
          ...(androidSerial === undefined
            ? []
            : [{ name: ANDROID_SERIAL_VARIABLE, value: androidSerial }]),
        ],
      };
    } finally {
      this.holdWaits.delete(device.id);
      request.signal?.removeEventListener("abort", letGo);
    }
  }

  /**
   * The run lets go of its hold, as run ended: `adb disconnect` first while its environment still
   * runs, its relay closed; nothing for a record already Disconnected or that isn't a run's hold.
   */
  async letGo(holdId: string): Promise<void> {
    const device = await this.repository.find(holdId);
    if (device === undefined || device.runHolder === null) {
      this.holds.delete(holdId);
      return;
    }
    await this.end(holdId, "run-ended");
  }

  /** What holds a record's device, named as the UI names it: a Task by its title, a run by its name. */
  async holderOf(
    record: ConnectedDevice,
    titles = new Map<string, Promise<string>>(),
  ): Promise<ProjectDeviceHolder> {
    if (record.runHolder !== null) return record.runHolder;
    const taskId = record.taskId ?? "";
    let title = titles.get(taskId);
    if (title === undefined) {
      title = this.tasks.find(taskId).then((task) => task?.title ?? taskId);
      titles.set(taskId, title);
    }
    return { kind: "task", taskId, title: await title };
  }

  /**
   * Inserts a record naming the Project device holding its row: refused while it pairs, held by
   * the record naming it, or by the one holding its device key; missing for none (of the Project
   * given).
   */
  private insertLocked(
    projectDeviceId: string,
    record: ConnectedDevice,
    projectId?: string,
  ): Promise<LockedInsert | { readonly kind: "missing" }> {
    return this.projectDevices.withDeviceLocked(projectDeviceId, async (locked) => {
      if (locked === undefined) return { kind: "missing" } as const;
      if (projectId !== undefined && locked.device.projectId !== projectId) {
        return { kind: "missing" } as const;
      }
      return this.insertHolding(locked, record);
    });
  }

  private async insertHolding(
    locked: LockedProjectDevice,
    record: ConnectedDevice,
  ): Promise<LockedInsert> {
    if (locked.device.pairingStep !== null) {
      return { kind: "refused", reasons: [beingPaired(locked.device)] };
    }
    const holding = await locked.holding();
    if (holding !== undefined) return { kind: "held", by: holding };
    const { heldBy } = await locked.insertRecord(record);
    return heldBy === undefined ? { kind: "kept" } : { kind: "held", by: heldBy };
  }

  /** Refuses a lend or a hold not kept, naming the holder when one holds it. */
  private async refuseUnlessKept(
    stored: LockedInsert,
    device: Pick<ConnectedDevice, "name">,
  ): Promise<void> {
    if (stored.kind === "refused") throw new ProjectDeviceRefused(stored.reasons);
    if (stored.kind === "held") {
      const holder = await this.holderOf(stored.by);
      throw new ProjectDeviceRefused([inUseBy(device, holder)], holder);
    }
  }

  /**
   * A run's phone over wireless debugging connects with the Project's adb key, never pairing,
   * detached under `adb:<id>`: Connected at its adb serial, or ended as device unplugged when it
   * doesn't answer, an error otherwise.
   */
  private connectHeldPhone(device: ConnectedDevice, endpoint: string | null): void {
    void this.locks
      .runDetached(`adb:${device.id}`, async () => {
        if (endpoint === null) {
          await this.end(device.id, "error", undefined, NOT_PAIRED_YET);
          return;
        }
        const place = this.environmentOf(device).adb;
        const reconnected = await this.wireless.reconnect({ id: device.id, endpoint }, place);
        if (reconnected.kind === "connected") {
          const changed = await this.locks.run(device.id, () =>
            this.change(device.id, (current) =>
              current.state === "connecting" ? deviceConnected(current, endpoint) : undefined,
            ),
          );
          // Let go of while adb connected: adb forgets it again.
          if (changed === undefined)
            await this.wireless.disconnected({ ...device, endpoint }, place);
        } else if (reconnected.kind === "unanswered") {
          await this.end(device.id, "device-unplugged");
        } else {
          const problem =
            reconnected.kind === "failed" ? reconnected.problem : RUN_ENVIRONMENT_NOT_RUNNING;
          await this.end(device.id, "error", undefined, problem);
        }
      })
      .catch(async (error: unknown) => {
        this.logger.error(`The held device ${device.id} didn't connect.`, error);
        await this.end(device.id, "error", undefined, wordsOf(error)).catch(() => undefined);
      });
  }

  /**
   * A run's device over USB waits for its tab to open the relay, at most `HELD_RELAY_WAIT_MS`;
   * none by then ends it as device unplugged, in 2.13's words. Once the relay opens, the helper's
   * own wait bounds the rest.
   */
  private waitForRelay(device: ConnectedDevice): void {
    const wait = this.schedule.once(
      "connected-device-held-relay",
      new Date(this.schedule.now().getTime() + HELD_RELAY_WAIT_MS),
      async () => {
        if (this.relays.has(device.id)) return;
        await this.end(device.id, "device-unplugged", undefined, notPluggedIn(device));
      },
    );
    const waits = this.holdWaits.get(device.id);
    this.holdWaits.set(device.id, (end) => {
      wait.cancel();
      waits?.(end);
    });
  }

  /**
   * Connected devices switched off for the Project, in the words naming it; asked only while the
   * Run environment is On, as Connected devices reads off without it and that reason is given.
   */
  private async switchedOffReasons(
    task: DeviceTask,
    runEnvironmentOn: boolean,
  ): Promise<readonly string[]> {
    if (!runEnvironmentOn) return [];
    const reason = await this.deviceFeature.switchedOffReasonOf(task.projectId);
    return reason === undefined ? [] : [reason];
  }

  /**
   * The Project's Run environment turned Off or its Connected devices switched off: every open
   * device of its Tasks ends, for that reason.
   */
  private projectSwitchedOff(
    projectId: string,
    because: "run-environment-turned-off" | "connected-devices-switched-off",
  ): Promise<void> {
    return this.disconnectAll(this.repository.openOfProject(projectId), because);
  }

  /** Disconnects the device by a user, or for the reason given; one Disconnected stays as it is. */
  async disconnect(
    id: string,
    because: DisconnectedBecause,
    by?: DeviceUser,
    problem?: string,
  ): Promise<ConnectedDevice> {
    await this.read(id);
    await this.end(id, because, by, problem);
    return this.read(id);
  }

  /**
   * The browser opened the device's relay socket: one per device, a second closed as taken, and
   * one for a device not there or Disconnected closed as ended. Starts the helper when the Task's
   * run environment runs, else the device waits for it.
   */
  relayOpened(id: string, link: RelayLink): Promise<void> {
    return this.locks.run(id, async () => {
      const device = await this.repository.find(id);
      if (device === undefined || !isOpen(device)) {
        link.closeAsEnded("The device is disconnected.");
        return;
      }
      if (this.relays.has(id)) {
        link.closeAsTaken();
        return;
      }
      this.relays.set(id, { link });
      link.onClosed((close) => {
        void this.relayClosed(id, link, close).catch((error: unknown) => {
          this.logger.error(`The device ${id} wasn't ended as its relay closed.`, error);
        });
      });
      link.onChannelsClosed(() => {
        void this.connectionsClosed(id).catch((error: unknown) => {
          this.logger.error(`The device ${id}'s closed adb connections weren't followed.`, error);
        });
      });
      link.sendState(device.state, device.endpoint);
      await this.startHelper(device);
    });
  }

  /**
   * An Office restart dropped every relay socket, so every open relayed device ends as tab closed;
   * a phone over wireless debugging waits for the run environment, whose next start connects to it.
   * Every run's hold ends as run ended, as no run outlives a restart.
   */
  async sweep(): Promise<void> {
    for (const device of await this.repository.allOpen()) {
      if (device.runHolder !== null) {
        await this.end(device.id, "run-ended");
      } else if (device.kind === "android-wireless") {
        await this.locks.run(device.id, () => this.change(device.id, deviceWaiting));
      } else {
        await this.end(device.id, "tab-closed");
      }
    }
  }

  /** Keeps the new record, refused naming the other Task when an open one holds its device key. */
  private async keep(device: ConnectedDevice, event: ConnectedDeviceChanged): Promise<void> {
    const { heldBy } = await this.repository.insert(device);
    if (heldBy?.runHolder != null) {
      throw new ConnectedDeviceRefused([inUseBy(device, heldBy.runHolder)]);
    }
    if (heldBy?.taskId === device.taskId) throw new ConnectedDeviceRefused([ALREADY_IN_THIS_TASK]);
    if (heldBy !== undefined) {
      const otherTaskId = heldBy.taskId ?? "";
      const other = await this.tasks.find(otherTaskId);
      const otherTask = { id: otherTaskId, title: other?.title ?? otherTaskId };
      throw new ConnectedDeviceRefused([alreadyConnectedTo(otherTask)], otherTask);
    }
    await this.events.publish(event);
  }

  /**
   * Pairs outside the device's lock, under its own key as a USB phone's adb steps, so a slow start
   * or adb never holds a disconnect back; the result is weighed against the record as it is then.
   */
  private followPairing(
    taskId: string,
    device: ConnectedDevice,
    target: PhoneToPair,
    pairingCode: string,
  ): void {
    void this.locks
      .runDetached(`adb:${device.id}`, async () => {
        if (!this.environments.isRunning(taskId)) {
          const problems = await this.environmentStart.start(taskId, device.projectId);
          if (problems.length > 0) {
            await this.end(device.id, "error", undefined, problems.join(" "));
            return;
          }
        }
        const place = this.environmentOf(device).adb;
        const paired = await this.wireless.pairIn(place, target, pairingCode);
        await this.pairingEnded(device, paired);
      })
      .catch(async (error: unknown) => {
        this.logger.error(`The device ${device.id} wasn't paired.`, error);
        await this.end(device.id, "error", undefined, wordsOf(error)).catch(() => undefined);
      });
  }

  private async pairingEnded(device: ConnectedDevice, paired: WirelessEnd): Promise<void> {
    if (paired.kind !== "connected") {
      const problem =
        paired.kind === "failed" ? paired.problem : "The phone didn't answer; pair it again.";
      await this.end(device.id, "error", undefined, problem);
      return;
    }
    const changed = await this.locks.run(device.id, () =>
      this.change(device.id, (current) =>
        phonePaired(
          current,
          paired.endpoint,
          paired.model ?? current.name,
          this.environmentOf(current).isRunning(),
        ),
      ),
    );
    // Disconnected while it paired: adb forgets it again.
    if (changed === undefined) {
      await this.wireless.disconnected(
        { ...device, endpoint: paired.endpoint },
        this.environmentOf(device).adb,
      );
    }
  }

  /**
   * A paired phone Waiting for the run environment connects again as it starts, never pairing:
   * Connected, or ended as device unplugged saying to pair it again when it doesn't answer.
   * Inside the start's handler, so never throwing.
   */
  private async reconnectWireless(device: ConnectedDevice): Promise<void> {
    if (device.state !== "waiting-for-run-environment") return;
    if (device.endpoint === null) {
      await this.end(device.id, "device-unplugged", undefined, PAIR_IT_AGAIN);
      return;
    }
    const phone: PairedPhone = { ...device, endpoint: device.endpoint };
    const reconnected = await this.wireless.reconnect(phone, this.environmentOf(device).adb);
    if (reconnected.kind === "connected") {
      await this.locks.run(device.id, () =>
        this.change(device.id, (current) =>
          current.state === "waiting-for-run-environment"
            ? deviceConnected(current, reconnected.endpoint, reconnected.model ?? current.name)
            : undefined,
        ),
      );
    } else if (reconnected.kind === "unanswered") {
      await this.end(device.id, "device-unplugged", undefined, phoneDidntAnswerAt(phone.endpoint));
    } else if (reconnected.kind === "failed") {
      await this.end(device.id, "error", undefined, reconnected.problem);
    }
  }

  private relayClosed(id: string, link: RelayLink, close: RelayClose): Promise<void> {
    // Ends a helper start in progress at once, rather than after it gets ready.
    link.stopHelper();
    // Set up under relayOpened's lock, so it must queue for the lock rather than inherit it.
    return this.locks.runDetached(id, async () => {
      if (this.relays.get(id)?.link !== link) return;
      this.relays.delete(id);
      if (close.kind === "unplugged") await this.end(id, "device-unplugged");
      else if (close.kind === "error") await this.end(id, "error", undefined, close.problem);
      else await this.end(id, "tab-closed");
    });
  }

  /**
   * Runs the helper on the device's relay, inside the device's lock: Connected at its READY's
   * endpoint once its HELLO's version is this Office's, Waiting when the run environment isn't
   * running, an error otherwise. Never throws.
   */
  private async startHelper(device: ConnectedDevice): Promise<void> {
    const relay = this.relays.get(device.id);
    if (relay === undefined || relay.link.relaysHelper) return;
    const environment = this.environmentOf(device);
    try {
      const executable = await this.helperFiles.executableFor(hostHelperArchitecture());
      if (executable === undefined) {
        await this.end(device.id, "error", undefined, DEVICE_HELPER_NOT_BUILT);
        return;
      }
      const helper = await this.attachHelper(device, executable, environment);
      if (helper === undefined) {
        // A run's hold never waits: its environment stopping is the run's end.
        if (device.runHolder !== null) {
          await this.end(device.id, "error", undefined, RUN_ENVIRONMENT_NOT_RUNNING);
        } else {
          await this.change(device.id, deviceWaiting);
        }
        return;
      }
      const opening = await this.withinStartTimeout(
        relay.link.startHelper(helper, {
          ended: (why) => {
            // Weighed as it ends: a stop forgets the environment before its containers stop.
            const running = environment.isRunning();
            void this.helperEnded(device, relay, why, running).catch((error: unknown) => {
              this.logger.error(
                `The device ${device.id} wasn't changed as its helper ended.`,
                error,
              );
            });
          },
          settingsChanged: (baudRate) =>
            this.relayedChange(device.id, relay, (current) => deviceBaudRateSet(current, baudRate)),
          roundTripMeasured: (roundTripMs) =>
            this.relayedChange(device.id, relay, (current) =>
              deviceRoundTripMeasured(current, roundTripMs),
            ),
          noticed: (notice) =>
            this.relayedChange(device.id, relay, (current) => deviceNoticed(current, notice)),
        }),
        () => relay.link.stopHelper(),
      );
      if (this.relays.get(device.id) !== relay) return;
      if (opening.kind === "ended") {
        await this.helperEndedNow(device, opening.why, environment.isRunning());
        return;
      }
      const problem = await this.helperFiles.helloProblemOf(opening.version);
      if (problem !== undefined) {
        relay.link.stopHelper();
        await this.end(device.id, "error", undefined, problem);
        return;
      }
      const connected = await this.change(device.id, (current) =>
        deviceConnected(current, opening.endpoint, current.name, opening.rfc2217Url),
      );
      const phone = connected === undefined ? undefined : androidUsbPhoneOf(connected.device);
      if (phone !== undefined) this.followAndroidUsb(phone, environment.adb);
    } catch (error) {
      const problem =
        error instanceof RunEnvironmentRefused ? error.reasons.join(" ") : wordsOf(error);
      relay.link.stopHelper();
      await this.end(device.id, "error", undefined, problem).catch((ending: unknown) => {
        this.logger.error(`The device ${device.id} wasn't disconnected.`, ending);
      });
    }
  }

  /**
   * Attaches the helper for the device's kind: an Android phone's relay listening on 127.0.0.1 as
   * the checks' user, a serial board's pseudo-terminal as root, handed to the checks' user.
   * Nothing when the run environment isn't running.
   */
  private async attachHelper(
    device: ConnectedDevice,
    executable: string,
    environment: DeviceEnvironment,
  ): Promise<HelperProcess | undefined> {
    if (device.kind !== "serial-usb") {
      return environment.adb.attach({
        arguments: [executable, "relay", "--listen", "127.0.0.1:0"],
      });
    }
    const owner = await environment.checksUser();
    if (owner === undefined) return undefined;
    return environment.adb.attach({
      arguments: [executable, "pty", "--path-prefix", SERIAL_PATH_PREFIX, "--owner", owner],
      asRoot: true,
    });
  }

  /**
   * What the device's helper told after its READY, saved in the device's lock while the relay is
   * still the device's; a failure is logged, never thrown, as nobody waits for it.
   */
  private relayedChange(
    id: string,
    relay: Relay,
    transition: (device: ConnectedDevice) => ConnectedDeviceChange,
  ): void {
    // Told under startHelper's lock at times, so it must queue for the lock rather than inherit it.
    void this.locks
      .runDetached(id, async () => {
        if (this.relays.get(id) !== relay) return;
        await this.change(id, transition, { tellSocket: false });
      })
      .catch((error: unknown) => {
        this.logger.error(`The device ${id} wasn't changed as its helper told.`, error);
      });
  }

  private async withinStartTimeout(
    opening: Promise<HelperOpening>,
    stop: () => void,
  ): Promise<HelperOpening> {
    const timeout = deferred<HelperOpening>();
    const wait = this.schedule.once(
      "connected-device-helper-start",
      new Date(this.schedule.now().getTime() + HELPER_START_TIMEOUT_MS),
      () => {
        // Settled first, so the race answers these words rather than the stop's.
        timeout.resolve({
          kind: "ended",
          why: `The Office device helper didn't get ready within ${HELPER_START_TIMEOUT_MS / 1000} seconds.`,
        });
        stop();
        return Promise.resolve();
      },
    );
    try {
      return await Promise.race([opening, timeout.promise]);
    } finally {
      wait.cancel();
    }
  }

  /** The helper ended by itself after READY. */
  private helperEnded(
    device: ConnectedDevice,
    relay: Relay,
    why: string,
    environmentRunning: boolean,
  ): Promise<void> {
    // Set up under startHelper's lock, so it must queue for the lock rather than inherit it.
    return this.locks.runDetached(device.id, async () => {
      // Another socket, or a new helper the environment's next start ran, took over meanwhile.
      if (this.relays.get(device.id) !== relay || relay.link.relaysHelper) return;
      await this.helperEndedNow(device, why, environmentRunning);
    });
  }

  /**
   * adb's steps for a phone whose helper got ready, outside the device's lock, so a slow adb never
   * holds a disconnect back: the device ends as an error when the phone can't be used.
   */
  private followAndroidUsb(phone: ConnectedAndroidPhone, place: AdbPlace): void {
    void this.locks
      .runDetached(`adb:${phone.id}`, async () => {
        const problem = await this.androidUsb.helperReady(phone, place);
        if (problem !== undefined) {
          await this.end(phone.id, "error", undefined, problem);
          return;
        }
        // A run's phone is ready to use once adb connected to it.
        const waiting = this.holdWaits.get(phone.id);
        const current = waiting === undefined ? undefined : await this.repository.find(phone.id);
        if (current?.state === "connected") waiting?.(current);
      })
      .catch((error: unknown) => {
        this.logger.error(`adb didn't connect to the device ${phone.id}.`, error);
      });
  }

  /** adb's last connection to the helper closed while the phone was Connected. */
  private async connectionsClosed(id: string): Promise<void> {
    const device = await this.repository.find(id);
    const phone = device === undefined ? undefined : androidUsbPhoneOf(device);
    if (phone !== undefined) {
      this.androidUsb.connectionsClosed(phone, this.environmentOf(phone).adb, (kept) =>
        this.repository.find(kept),
      );
    }
  }

  /** Waiting when its run environment stopped under it, an error with why otherwise. */
  private async helperEndedNow(
    device: ConnectedDevice,
    why: string,
    environmentRunning: boolean,
  ): Promise<void> {
    if (!environmentRunning) {
      await this.change(device.id, deviceWaiting);
      return;
    }
    await this.end(device.id, "error", undefined, why);
  }

  /**
   * Each Waiting or Connecting device of the Task with an open socket runs a new helper; each
   * paired phone over wireless debugging Waiting connects again.
   */
  private async environmentStarted(taskId: string): Promise<void> {
    const devices = await this.repository.openOfTask(taskId);
    for (const device of devices) {
      if (device.kind === "android-wireless") {
        await this.reconnectWireless(device).catch((error: unknown) => {
          this.logger.error(`The device ${device.id} didn't connect again.`, error);
        });
        continue;
      }
      await this.locks
        .run(device.id, async () => {
          const current = await this.repository.find(device.id);
          if (current === undefined || current.state === "connected" || !isOpen(current)) return;
          await this.startHelper(current);
        })
        .catch((error: unknown) => {
          this.logger.error(`The device ${device.id}'s helper didn't start.`, error);
        });
    }
  }

  /** Every open device of the Task waits, its helper ended with the environment. */
  private async environmentStopped(taskId: string): Promise<void> {
    for (const device of await this.repository.openOfTask(taskId)) {
      this.relays.get(device.id)?.link.stopHelper();
      await this.locks.run(device.id, () => this.change(device.id, deviceWaiting));
    }
  }

  private async disconnectAll(
    devices: Promise<readonly ConnectedDevice[]>,
    because: DisconnectedBecause,
  ): Promise<void> {
    for (const device of await devices) await this.end(device.id, because);
  }

  /**
   * Disconnects the device for good, its helper stopped and its socket told and closed, inside
   * its lock; nothing for one already Disconnected.
   */
  private end(
    id: string,
    because: DisconnectedBecause,
    by?: DeviceUser,
    problem?: string,
  ): Promise<void> {
    const at = this.schedule.now();
    return this.locks.run(id, async () => {
      const relay = this.relays.get(id);
      relay?.link.stopHelper();
      // Told by `change` while the relay is still kept, then closed.
      let phone: ConnectedAndroidPhone | undefined;
      let wirelessPhone: PairedPhone | undefined;
      let place: AdbPlace | undefined;
      const changed = await this.change(id, (device) => {
        phone = androidUsbPhoneOf(device);
        wirelessPhone = pairedPhoneOf(device);
        // Taken while a run's hold still has its environment, for adb's disconnect.
        place = this.environmentOf(device).adb;
        return deviceDisconnected(device, {
          because,
          at,
          ...(by === undefined ? {} : { by }),
          ...(problem === undefined ? {} : { problem }),
        });
      });
      this.relays.delete(id);
      relay?.link.closeAsEnded(changed?.device.problem ?? "The device was disconnected.");
      if (changed !== undefined && phone !== undefined && place !== undefined) {
        void this.androidUsb.disconnected(phone, place).catch((error: unknown) => {
          this.logger.warn(`adb didn't let go of the device ${id}.`, error);
        });
      }
      // Nothing when the run environment isn't running, as it attaches nothing.
      if (changed !== undefined && wirelessPhone !== undefined && place !== undefined) {
        void this.wireless.disconnected(wirelessPhone, place).catch((error: unknown) => {
          this.logger.warn(`adb didn't let go of the device ${id}.`, error);
        });
      }
      const ended = changed?.device ?? (await this.repository.find(id));
      if (ended === undefined || !isOpen(ended)) this.holds.delete(id);
    });
  }

  /**
   * Saves the change, then publishes it and tells the device's socket its state, unless
   * `tellSocket` is false, as for a baud rate, a round trip or a notice, which leave it as it was.
   */
  private async change(
    id: string,
    transition: (device: ConnectedDevice) => ConnectedDeviceChange,
    { tellSocket = true }: { readonly tellSocket?: boolean } = {},
  ): Promise<ConnectedDeviceChange> {
    const changed = await this.repository.update(id, transition);
    if (changed === undefined) return undefined;
    if (tellSocket) {
      this.relays.get(id)?.link.sendState(changed.device.state, changed.device.endpoint);
    }
    await this.events.publish(changed.event);
    if (readyOrEnded(changed.device)) this.holdWaits.get(id)?.(changed.device);
    return changed;
  }

  /**
   * Where the device's helper and adb run: its Task's run environment, or the environment of the
   * run holding it, running while this process keeps the hold (never after a restart).
   */
  private environmentOf(device: ConnectedDevice): DeviceEnvironment {
    if (device.taskId !== null) {
      const taskId = device.taskId;
      return {
        adb: this.adb.inTask(taskId, device.projectId),
        isRunning: () => this.environments.isRunning(taskId),
        checksUser: () => this.environments.checksUserOf(taskId),
      };
    }
    const holding = this.holds.get(device.id);
    return {
      adb: {
        projectId: device.projectId,
        label: holding?.label ?? `the run that held the device ${device.id}`,
        attach: (attachment) =>
          holding === undefined ? Promise.resolve(undefined) : holding.attach(attachment),
      },
      isRunning: () => this.holds.has(device.id),
      checksUser: () => Promise.resolve(holding?.checksUser),
    };
  }

  private async wordsOf(taskId: string): Promise<readonly TaskConnectedDevice[]> {
    return (await this.repository.openOfTask(taskId)).map((device) => {
      const details = detailsOf(device);
      return {
        kind: KIND_WORDS[device.kind],
        name: device.name,
        state: STATE_WORDS[device.state],
        connected: device.state === "connected",
        endpoint: endpointWordsOf(device),
        ...(details.length === 0 ? {} : { details }),
      };
    });
  }
}

/** Where commands reach it, in words: a serial board's path and its RFC 2217 address, when known. */
function endpointWordsOf(device: ConnectedDevice): string | null {
  if (device.endpoint === null || device.rfc2217Url === null) return device.endpoint;
  return `${device.endpoint} and ${device.rfc2217Url}`;
}

/** The device as an Android phone over USB Connected at its helper's endpoint, if it is one. */
function androidUsbPhoneOf(device: ConnectedDevice): ConnectedAndroidPhone | undefined {
  if (device.kind !== "android-usb" || device.state !== "connected" || device.endpoint === null) {
    return undefined;
  }
  return { ...device, endpoint: device.endpoint };
}

/** A phone over wireless debugging with the adb serial it was paired at, Connected or Waiting. */
function pairedPhoneOf(device: ConnectedDevice): PairedPhone | undefined {
  if (device.kind !== "android-wireless" || device.endpoint === null) return undefined;
  return { ...device, endpoint: device.endpoint };
}

/**
 * Whether a run waiting for its hold is answered now: Disconnected, or Connected, but for an
 * Android phone over USB, whose adb connects after its helper is ready.
 */
function readyOrEnded(device: ConnectedDevice): boolean {
  if (device.state === "disconnected") return true;
  return device.state === "connected" && device.kind !== "android-usb";
}

/** Said when a run's phone over wireless debugging has no address and Port to connect to. */
const NOT_PAIRED_YET = "The phone has no address and Port to connect to; pair it first.";

/** Said when a phone over wireless debugging was never paired before a restart. */
const PAIR_IT_AGAIN = "The phone wasn't paired before the run environment stopped; pair it again.";

function phoneDidntAnswerAt(serial: string): string {
  return `The phone didn't answer at ${serial}; pair it again.`;
}

function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A promise and its resolve, as `Promise.withResolvers` (ES2024) gives. */
function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  const settles: { resolve?: (value: Value) => void } = {};
  const promise = new Promise<Value>((resolve) => {
    settles.resolve = resolve;
  });
  return { promise, resolve: (value) => settles.resolve?.(value) };
}

/** Whether the signal was aborted by now: read through a call, as it may abort while awaiting. */
function wasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
