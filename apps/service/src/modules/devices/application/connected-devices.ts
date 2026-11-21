import { randomUUID } from "node:crypto";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ProjectRunEnvironmentChanged } from "../../projects/index.js";
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
  alreadyConnectedTo,
  androidSerialOf,
  connectedDevicesVariable,
  connectingDevice,
  connectProblemsOf,
  deviceConnected,
  deviceDisconnected,
  deviceWaiting,
  isOpen,
  KIND_WORDS,
  STATE_WORDS,
  type ConnectedDevice,
  type ConnectedDeviceChange,
  type ConnectedDeviceKind,
  type DeviceUser,
  type DisconnectedBecause,
} from "../domain/connected-device.js";
import {
  ConnectedDeviceNotFound,
  ConnectedDeviceRefused,
} from "../domain/connected-device-refused.js";
import { ConnectedDeviceRepository } from "../ports/connected-device-repository.js";
import { DeviceTasks } from "../ports/device-tasks.js";
import { ProjectRunEnvironmentSettings } from "../ports/project-run-environment-settings.js";
import type { HelperOpening, RelayClose, RelayLink } from "../ports/relay-link.js";
import { AndroidUsbDevices, type ConnectedAndroidPhone } from "./android-usb-devices.js";
import { hostHelperArchitecture } from "./device-helper-architecture.js";

/** The variable every check in a Task's run environment gets (spec §2.13, "What Agents see"). */
export const CONNECTED_DEVICES_VARIABLE = "OFFICE_CONNECTED_DEVICES";
/** The serial adb uses when one Android phone is Connected, unless the Project sets its own. */
export const ANDROID_SERIAL_VARIABLE = "ANDROID_SERIAL";

/** How long a helper has to say HELLO and READY before its device ends as an error. */
export const HELPER_START_TIMEOUT_MS = 10_000;

/** What the browser reached, to connect. */
export interface DeviceToConnect {
  readonly kind: ConnectedDeviceKind;
  readonly name: string;
  readonly deviceKey: string;
}

/** A device's open relay socket. */
interface Relay {
  readonly link: RelayLink;
}

/**
 * Connected devices (spec §2.13): connect and disconnect, each device's relay socket and helper,
 * and how they follow the Task, its run environment and its Project's Run environment setting.
 * Relays live in memory: an Office restart drops every socket, so the sweep ends the open
 * records as tab closed.
 */
@Injectable()
export class ConnectedDevices implements OnModuleInit {
  private readonly logger = new Logger(ConnectedDevices.name);
  private readonly locks = new KeyedLocks();
  private readonly relays = new Map<string, Relay>();

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
      return this.disconnectAll(
        this.repository.openOfProject(projectId),
        "run-environment-turned-off",
      );
    });
  }

  /** The Task's devices, the newest connected first, Disconnected ones kept as history. */
  async list(taskId: string): Promise<readonly ConnectedDevice[]> {
    if ((await this.tasks.find(taskId)) === undefined) throw ConnectedDeviceNotFound.task(taskId);
    return this.repository.listOfTask(taskId);
  }

  async read(id: string): Promise<ConnectedDevice> {
    const device = await this.repository.find(id);
    if (device === undefined) throw ConnectedDeviceNotFound.device(id);
    return device;
  }

  /**
   * Keeps a Connecting record for the device the browser reached, whose relay it opens next.
   * Refused, with every reason, unless the Task is open, its Project's Run environment On, the
   * kind relayed and the helper built; then refused naming the other Task when an open record
   * holds the device key. Never starts the run environment.
   */
  async connect(taskId: string, given: DeviceToConnect, by: DeviceUser): Promise<ConnectedDevice> {
    const task = await this.tasks.find(taskId);
    if (task === undefined) throw ConnectedDeviceNotFound.task(taskId);
    const problems = connectProblemsOf({
      taskState: task.state,
      runEnvironmentOn: await this.runEnvironmentSettings.isOn(task.projectId),
      kind: given.kind,
    });
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
    const { heldBy } = await this.repository.insert(device);
    if (heldBy !== undefined) {
      const other = await this.tasks.find(heldBy.taskId);
      const otherTask = { id: heldBy.taskId, title: other?.title ?? heldBy.taskId };
      throw new ConnectedDeviceRefused([alreadyConnectedTo(otherTask)], otherTask);
    }
    await this.events.publish(event);
    return device;
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
      link.onClosed((close) => void this.relayClosed(id, link, close));
      link.onChannelsClosed(() => void this.connectionsClosed(id));
      link.sendState(device.state, device.endpoint);
      await this.startHelper(device);
    });
  }

  /** Every open device ends as tab closed: an Office restart dropped every relay socket. */
  async sweep(): Promise<void> {
    for (const device of await this.repository.allOpen()) {
      await this.end(device.id, "tab-closed");
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
    try {
      const executable = await this.helperFiles.executableFor(hostHelperArchitecture());
      if (executable === undefined) {
        await this.end(device.id, "error", undefined, DEVICE_HELPER_NOT_BUILT);
        return;
      }
      const helper = await this.environments.attach(device.taskId, {
        arguments: [executable, "relay", "--listen", "127.0.0.1:0"],
      });
      if (helper === undefined) {
        await this.change(device.id, deviceWaiting);
        return;
      }
      const opening = await this.withinStartTimeout(
        relay.link.startHelper(helper, (why) => {
          // Weighed as it ends: a stop forgets the environment before its containers stop.
          const running = this.environments.isRunning(device.taskId);
          void this.helperEnded(device, relay, why, running);
        }),
        () => relay.link.stopHelper(),
      );
      if (this.relays.get(device.id) !== relay) return;
      if (opening.kind === "ended") {
        await this.helperEndedNow(device, opening.why, this.environments.isRunning(device.taskId));
        return;
      }
      const problem = await this.helperFiles.helloProblemOf(opening.version);
      if (problem !== undefined) {
        relay.link.stopHelper();
        await this.end(device.id, "error", undefined, problem);
        return;
      }
      const connected = await this.change(device.id, (current) =>
        deviceConnected(current, opening.endpoint),
      );
      const phone = connected === undefined ? undefined : androidUsbPhoneOf(connected.device);
      if (phone !== undefined) this.followAndroidUsb(phone);
    } catch (error) {
      const problem =
        error instanceof RunEnvironmentRefused ? error.reasons.join(" ") : wordsOf(error);
      relay.link.stopHelper();
      await this.end(device.id, "error", undefined, problem).catch((ending: unknown) => {
        this.logger.error(`The device ${device.id} wasn't disconnected.`, ending);
      });
    }
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
  private followAndroidUsb(phone: ConnectedAndroidPhone): void {
    void this.locks
      .runDetached(`adb:${phone.id}`, async () => {
        const problem = await this.androidUsb.helperReady(phone);
        if (problem !== undefined) await this.end(phone.id, "error", undefined, problem);
      })
      .catch((error: unknown) => {
        this.logger.error(`adb didn't connect to the device ${phone.id}.`, error);
      });
  }

  /** adb's last connection to the helper closed while the phone was Connected. */
  private async connectionsClosed(id: string): Promise<void> {
    const device = await this.repository.find(id);
    const phone = device === undefined ? undefined : androidUsbPhoneOf(device);
    if (phone !== undefined)
      this.androidUsb.connectionsClosed(phone, (kept) => this.repository.find(kept));
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

  /** Each Waiting or Connecting device of the Task with an open socket runs a new helper. */
  private async environmentStarted(taskId: string): Promise<void> {
    const devices = await this.repository.openOfTask(taskId);
    for (const device of devices) {
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
      const changed = await this.change(id, (device) => {
        phone = androidUsbPhoneOf(device);
        return deviceDisconnected(device, {
          because,
          at,
          ...(by === undefined ? {} : { by }),
          ...(problem === undefined ? {} : { problem }),
        });
      });
      this.relays.delete(id);
      relay?.link.closeAsEnded(changed?.device.problem ?? "The device was disconnected.");
      if (changed !== undefined && phone !== undefined) void this.androidUsb.disconnected(phone);
    });
  }

  /** Saves the change, then publishes it and tells the device's socket. */
  private async change(
    id: string,
    transition: (device: ConnectedDevice) => ConnectedDeviceChange,
  ): Promise<ConnectedDeviceChange> {
    const changed = await this.repository.update(id, transition);
    if (changed === undefined) return undefined;
    this.relays.get(id)?.link.sendState(changed.device.state, changed.device.endpoint);
    await this.events.publish(changed.event);
    return changed;
  }

  private async wordsOf(taskId: string): Promise<readonly TaskConnectedDevice[]> {
    return (await this.repository.openOfTask(taskId)).map((device) => ({
      kind: KIND_WORDS[device.kind],
      name: device.name,
      state: STATE_WORDS[device.state],
      connected: device.state === "connected",
      endpoint: device.endpoint,
    }));
  }
}

/** The device as an Android phone over USB Connected at its helper's endpoint, if it is one. */
function androidUsbPhoneOf(device: ConnectedDevice): ConnectedAndroidPhone | undefined {
  if (device.kind !== "android-usb" || device.state !== "connected" || device.endpoint === null) {
    return undefined;
  }
  return { ...device, endpoint: device.endpoint };
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
