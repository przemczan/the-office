import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { ProjectDeviceLines, type ProjectDeviceLine } from "../../projects/index.js";
import { DEVICE_HELPER_NOT_BUILT, DeviceHelperFiles } from "../../run-environments/index.js";
import {
  KIND_WORDS,
  type ConnectedDevice,
  type ConnectedDeviceKind,
  type DeviceUser,
} from "../domain/connected-device.js";
import { ConnectedDeviceChanged } from "../domain/connected-device-events.js";
import {
  alreadyAmongTheProjects,
  beingPaired,
  inUseBy,
  NEEDS_RUN_ENVIRONMENT_ON,
  pairingCutOff,
  pairingFailed,
  pairingStarted,
  pairingStepped,
  pairingSucceeded,
  projectDeviceGivenBack,
  projectDevicePortChanged,
  projectDeviceRenamed,
  projectDeviceStateOf,
  usbProjectDevice,
  wirelessProjectDevice,
  type PhonePlace,
  type ProjectDevice,
  type ProjectDeviceChange,
  type ProjectDeviceHolder,
  type ProjectDevicePairingStep,
  type ProjectDeviceState,
} from "../domain/project-device.js";
import { ProjectDeviceChanged } from "../domain/project-device-events.js";
import { ProjectDeviceNotFound, ProjectDeviceRefused } from "../domain/project-device-refused.js";
import {
  adbSerialAt,
  wirelessAddressOf,
  wirelessDeviceKeyOf,
  type WirelessAddress,
} from "../domain/wireless-address.js";
import { ConnectedDeviceRepository } from "../ports/connected-device-repository.js";
import { DeviceTasks } from "../ports/device-tasks.js";
import {
  PairingEnvironmentStart,
  type RunningPairingEnvironment,
} from "../ports/pairing-environment-start.js";
import { PairingDefinitions, type PairingDefinition } from "../ports/pairing-definitions.js";
import { ProjectDeviceRepository } from "../ports/project-device-repository.js";
import { ProjectDeviceFeature } from "../ports/project-features.js";
import { ProjectRunEnvironmentSettings } from "../ports/project-run-environment-settings.js";
import type { AdbPlace } from "./adb-in-run-environment.js";
import { ConnectedDevices, type WirelessPhoneToPair } from "./connected-devices.js";
import { hostHelperArchitecture } from "./device-helper-architecture.js";
import { WirelessDevices, type PhoneToPair, type WirelessEnd } from "./wireless-devices.js";

/** A device over USB the browser reached, to add by its device key. */
export interface UsbDeviceToAdd {
  readonly kind: Exclude<ConnectedDeviceKind, "android-wireless">;
  readonly name: string;
  readonly deviceKey: string;
}

/** A phone over wireless debugging to add, paired at once. */
export type WirelessDeviceToAdd = { readonly kind: "android-wireless" } & WirelessPhoneToPair;

export type ProjectDeviceToAdd = UsbDeviceToAdd | WirelessDeviceToAdd;

/** What a rename or a new Port changes; at least one of them. */
export interface ProjectDeviceEdit {
  readonly name?: string;
  readonly port?: number;
}

/** A Project device as its Devices section shows it: at rest, or In use naming its holder. */
export interface SeenProjectDevice {
  readonly device: ProjectDevice;
  readonly state: ProjectDeviceState;
  readonly inUseBy: ProjectDeviceHolder | null;
}

/** Said when a pairing ended with the phone not answering. */
const PHONE_DIDNT_ANSWER = "The phone didn't answer; pair it again.";
/** Said when the pairing environment stopped before adb could run. */
const ENVIRONMENT_STOPPED = "The pairing environment stopped while pairing; pair it again.";

/** A phone's name in the Project's record while its name is still its address. */
const NAMED_BY_ITS_ADDRESS = "Not named yet";

const STATE_WORDS: Readonly<Record<Exclude<ProjectDeviceState, "in-use">, string>> = {
  paired: "Paired",
  "didnt-answer": "Didn't answer",
  "not-paired": "Not paired",
  "over-usb": "Over USB",
};

/**
 * Project devices (spec §2.13, "A Project's device"): kept between uses, added, renamed, given a
 * new Port, removed, paired in a pairing environment, and lent to a Task, whose Connected device
 * record names it while it holds it and gives it back as that record ends. Each change emits
 * `ProjectDeviceChanged`. A pairing code goes only into `adb pair`'s standard input.
 */
@Injectable()
export class ProjectDevices implements OnModuleInit {
  private readonly logger = new Logger(ProjectDevices.name);
  /** The lent records that reached Connected, so their device is Paired once given back. */
  private readonly everConnected = new Set<string>();
  /** The pairings running now, for `settled`. */
  private readonly pairings = new Set<Promise<void>>();

  constructor(
    private readonly repository: ProjectDeviceRepository,
    private readonly connectedDevices: ConnectedDeviceRepository,
    private readonly devices: ConnectedDevices,
    private readonly tasks: DeviceTasks,
    private readonly runEnvironmentSettings: ProjectRunEnvironmentSettings,
    private readonly deviceFeature: ProjectDeviceFeature,
    private readonly helperFiles: DeviceHelperFiles,
    private readonly definitions: PairingDefinitions,
    private readonly pairingEnvironments: PairingEnvironmentStart,
    private readonly wireless: WirelessDevices,
    private readonly lines: ProjectDeviceLines,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.lines.register((projectId) => this.linesOf(projectId));
    // Every lent record's change, its end included, goes through the one place records change.
    this.events.subscribe(ConnectedDeviceChanged, (event) => this.lentDeviceChanged(event));
  }

  /** The Project's devices in the order added, each In use while an open record names it. */
  async list(projectId: string): Promise<readonly SeenProjectDevice[]> {
    const [devices, open] = await Promise.all([
      this.repository.listOf(projectId),
      this.connectedDevices.openOfProject(projectId),
    ]);
    const titles = new Map<string, Promise<string>>();
    return Promise.all(
      devices.map((device) =>
        this.seen(
          device,
          open.find(({ projectDeviceId }) => projectDeviceId === device.id),
          titles,
        ),
      ),
    );
  }

  async read(id: string): Promise<SeenProjectDevice> {
    const device = await this.find(id);
    return this.seen(device, await this.connectedDevices.openOfProjectDevice(id));
  }

  /**
   * Adds a device over USB by its device key, or a phone over wireless debugging Not paired, its
   * pairing started at once. Refused, with every reason, unless the Project's Run environment is
   * On and Connected devices switched on, a phone's address one the run environment can reach and
   * the helper built (it writes the key); then refused when the device key is the Project's
   * already.
   */
  async add(
    projectId: string,
    given: ProjectDeviceToAdd,
    by: DeviceUser,
  ): Promise<SeenProjectDevice> {
    const problems = await this.projectProblemsOf(projectId);
    if (given.kind !== "android-wireless") {
      if (problems.length > 0) throw new ProjectDeviceRefused(problems);
      const { device, event } = usbProjectDevice({
        id: randomUUID(),
        projectId,
        kind: given.kind,
        name: given.name,
        deviceKey: given.deviceKey,
        addedBy: by,
        addedAt: this.schedule.now(),
      });
      await this.keep(device, event, device.name);
      return this.seen(device, undefined);
    }
    const address = await this.phoneAddressOf(given.address, problems);
    const place = placeOf(address, given.port);
    const { device, event } = wirelessProjectDevice({
      id: randomUUID(),
      projectId,
      ...place,
      addedBy: by,
      addedAt: this.schedule.now(),
    });
    await this.keep(device, event, phoneAt(place.address));
    this.followPairing(device, targetOf(address, given), given.pairingCode);
    return this.seen(device, undefined);
  }

  /** Renames it and gives a phone over wireless debugging a new Port, needing no pairing. */
  async change(id: string, edit: ProjectDeviceEdit): Promise<SeenProjectDevice> {
    if (edit.name !== undefined) {
      const name = edit.name;
      await this.update(id, (device) => projectDeviceRenamed(device, name));
    }
    if (edit.port !== undefined) {
      const port = edit.port;
      await this.update(id, (device) => projectDevicePortChanged(device, port));
    }
    return this.read(id);
  }

  /** Forgets it; refused while it is in use, naming the holder, or while it pairs. */
  async remove(id: string): Promise<void> {
    const device = await this.find(id);
    if (device.pairingStep !== null) throw new ProjectDeviceRefused([beingPaired(device)]);
    await this.refuseWhileHeld(device);
    if (await this.repository.remove(id)) {
      await this.events.publish(new ProjectDeviceChanged(device.projectId, id));
    }
  }

  /**
   * Pairs a phone over wireless debugging again, at the address and Port given, in a pairing
   * environment. Refused as adding is, while it is in use, naming the holder, and while it pairs.
   */
  async pair(id: string, given: WirelessPhoneToPair): Promise<SeenProjectDevice> {
    const kept = await this.find(id);
    const problems = await this.projectProblemsOf(kept.projectId);
    const address = await this.phoneAddressOf(given.address, problems);
    await this.refuseWhileHeld(kept);
    const place = placeOf(address, given.port);
    const updated = await this.repository.update(id, (device) => pairingStarted(device, place));
    if (updated.kind === "missing") throw new ProjectDeviceNotFound(id);
    if (updated.kind === "device-key-taken") {
      throw new ProjectDeviceRefused([alreadyAmongTheProjects(phoneAt(place.address))]);
    }
    if (updated.kind !== "changed") return this.read(id);
    await this.events.publish(updated.change.event);
    this.followPairing(updated.change.device, targetOf(address, given), given.pairingCode);
    return this.seen(updated.change.device, undefined);
  }

  /**
   * Lends the device to the Task (spec §2.13, "Lent to a Task"): refused as a connect is, while
   * it pairs, and naming the holder while another environment holds it.
   */
  async lend(taskId: string, projectDeviceId: string, by: DeviceUser): Promise<ConnectedDevice> {
    const device = await this.find(projectDeviceId);
    if (device.pairingStep !== null) throw new ProjectDeviceRefused([beingPaired(device)]);
    return this.devices.lend(
      taskId,
      {
        projectDeviceId: device.id,
        projectId: device.projectId,
        kind: device.kind,
        name: device.name,
        deviceKey: device.deviceKey,
        wirelessEndpoint: wirelessEndpointOf(device),
      },
      by,
    );
  }

  /**
   * After an Office restart: removes every pairing environment the last run left, and each
   * pairing it cut off is Not paired, saying to pair it again.
   */
  async sweep(): Promise<void> {
    await this.pairingEnvironments.sweep();
    for (const device of await this.repository.pairing()) {
      await this.update(device.id, pairingCutOff).catch((error: unknown) => {
        this.logger.warn(`The pairing of the Project device ${device.id} wasn't swept.`, error);
      });
    }
  }

  /** Resolves once every pairing running now has ended, for tests. */
  async settled(): Promise<void> {
    while (this.pairings.size > 0) await Promise.all(this.pairings);
  }

  /**
   * Each of the Project's devices in words, for its record, never its address or Port: a phone
   * still named by its address, as it is until it pairs, isn't named there.
   */
  private async linesOf(projectId: string): Promise<readonly ProjectDeviceLine[]> {
    return (await this.list(projectId)).map(({ device, state, inUseBy: holder }) => ({
      id: device.id,
      kind: KIND_WORDS[device.kind],
      name: device.name === device.address ? NAMED_BY_ITS_ADDRESS : device.name,
      state: stateWordsOf(device, state, holder),
    }));
  }

  /**
   * A lent record changed: Connected is remembered, so the device is Paired once given back;
   * Disconnected gives it back, at rest again with its last use. Either way the Project's devices
   * changed, as In use came or went. Never throws, as the bus waits for it inside the change.
   */
  private async lentDeviceChanged(event: ConnectedDeviceChanged): Promise<void> {
    const { projectDeviceId, deviceId } = event;
    if (projectDeviceId === null) return;
    try {
      if (event.state === "connected") this.everConnected.add(deviceId);
      if (event.state === "disconnected") {
        await this.givenBack(projectDeviceId, deviceId);
        return;
      }
      const device = await this.repository.find(projectDeviceId);
      if (device !== undefined) {
        await this.events.publish(new ProjectDeviceChanged(device.projectId, device.id));
      }
    } catch (error) {
      this.logger.error(`The Project device ${projectDeviceId} wasn't given back.`, error);
    }
  }

  private async givenBack(projectDeviceId: string, deviceId: string): Promise<void> {
    const ended = await this.connectedDevices.find(deviceId);
    if (ended === undefined || ended.state !== "disconnected") return;
    const everConnected = this.everConnected.delete(deviceId);
    const holder = await this.holderOf(ended);
    const updated = await this.repository.update(projectDeviceId, (device) =>
      projectDeviceGivenBack(device, ended, holder, everConnected),
    );
    if (updated.kind === "changed") await this.events.publish(updated.change.event);
  }

  /**
   * Pairs in a pairing environment, detached from the request: the base branch's definition
   * written out, the environment started, then adb's check, the Project's key, `adb pair` with the
   * code on its standard input, `adb connect`, the model and `adb disconnect`, bounded as a Task's
   * pairing. The environment and the definition are removed however it ends.
   */
  private followPairing(device: ProjectDevice, target: PhoneToPair, pairingCode: string): void {
    const pairing = this.pairIn(device, target, pairingCode).catch(async (error: unknown) => {
      this.logger.error(`The Project device ${device.id} wasn't paired.`, error);
      await this.pairingEnded(device.id, { kind: "failed", problem: wordsOf(error) }).catch(
        () => undefined,
      );
    });
    this.pairings.add(pairing);
    void pairing.finally(() => this.pairings.delete(pairing));
  }

  private async pairIn(
    device: ProjectDevice,
    target: PhoneToPair,
    pairingCode: string,
  ): Promise<void> {
    const logFolder = await mkdtemp(join(tmpdir(), "office-pairing-log-"));
    let definition: PairingDefinition | undefined;
    let environment: RunningPairingEnvironment | undefined;
    try {
      const exported = await this.definitions.exportDefinition(device.projectId);
      if ("problems" in exported) {
        await this.pairingEnded(device.id, {
          kind: "failed",
          problem: exported.problems.join(" "),
        });
        return;
      }
      definition = exported;
      const started = await this.pairingEnvironments.start({
        projectId: device.projectId,
        projectDeviceId: device.id,
        definitionFolder: definition.folder,
        logFile: join(logFolder, "pairing.log"),
      });
      if ("problems" in started) {
        await this.pairingEnded(device.id, { kind: "failed", problem: started.problems.join(" ") });
        return;
      }
      environment = started;
      const place: AdbPlace = {
        projectId: device.projectId,
        label: `the pairing environment of the Project device ${device.id}`,
        attach: (attachment) => started.attach(attachment),
      };
      await this.stepTo(device.id, "pairing");
      const end = await this.wireless.pairIn(place, target, pairingCode, () =>
        this.stepTo(device.id, "reading-model"),
      );
      if (end.kind === "connected") await this.wireless.disconnectIn(place, end.endpoint);
      await this.pairingEnded(device.id, end);
    } finally {
      await environment?.remove();
      await definition?.remove();
      await rm(logFolder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async stepTo(id: string, step: ProjectDevicePairingStep): Promise<void> {
    await this.update(id, (device) => pairingStepped(device, step));
  }

  private async pairingEnded(id: string, end: WirelessEnd): Promise<void> {
    await this.update(id, (device) => {
      switch (end.kind) {
        case "connected":
          return pairingSucceeded(device, end.model);
        case "failed":
          return pairingFailed(device, end.problem);
        case "unanswered":
          return pairingFailed(device, PHONE_DIDNT_ANSWER);
        case "not-running":
          return pairingFailed(device, ENVIRONMENT_STOPPED);
      }
    });
  }

  /** Every reason the Project takes no device now: Run environment not On, Connected devices off. */
  private async projectProblemsOf(projectId: string): Promise<string[]> {
    if (!(await this.runEnvironmentSettings.isOn(projectId))) return [NEEDS_RUN_ENVIRONMENT_ON];
    const reason = await this.deviceFeature.switchedOffReasonOf(projectId);
    return reason === undefined ? [] : [reason];
  }

  /**
   * The phone's address, refused with the Project's problems, the address's and the helper not
   * built (it writes the key), every one of them.
   */
  private async phoneAddressOf(given: string, problems: string[]): Promise<WirelessAddress> {
    const reading = wirelessAddressOf(given);
    if ("problem" in reading) problems.push(reading.problem);
    if (
      problems.length === 0 &&
      (await this.helperFiles.executableFor(hostHelperArchitecture())) === undefined
    ) {
      problems.push(DEVICE_HELPER_NOT_BUILT);
    }
    if (problems.length > 0 || "problem" in reading) throw new ProjectDeviceRefused(problems);
    return reading.address;
  }

  private async refuseWhileHeld(device: ProjectDevice): Promise<void> {
    const holding = await this.connectedDevices.openOfProjectDevice(device.id);
    if (holding === undefined) return;
    const holder = await this.holderOf(holding);
    throw new ProjectDeviceRefused([inUseBy(device, holder)], holder);
  }

  /** Keeps the new device, refused when its device key is the Project's already. */
  private async keep(
    device: ProjectDevice,
    event: ProjectDeviceChanged,
    named: string,
  ): Promise<void> {
    if ((await this.repository.insert(device)) === "device-key-taken") {
      throw new ProjectDeviceRefused([alreadyAmongTheProjects(named)]);
    }
    await this.events.publish(event);
  }

  /** Saves the change, then publishes it; refused for a device that isn't there. */
  private async update(
    id: string,
    change: (device: ProjectDevice) => ProjectDeviceChange,
  ): Promise<void> {
    const updated = await this.repository.update(id, change);
    if (updated.kind === "missing") throw new ProjectDeviceNotFound(id);
    if (updated.kind === "changed") await this.events.publish(updated.change.event);
  }

  private async find(id: string): Promise<ProjectDevice> {
    const device = await this.repository.find(id);
    if (device === undefined) throw new ProjectDeviceNotFound(id);
    return device;
  }

  private async seen(
    device: ProjectDevice,
    holding: ConnectedDevice | undefined,
    titles = new Map<string, Promise<string>>(),
  ): Promise<SeenProjectDevice> {
    const state = projectDeviceStateOf(device, holding);
    if (state !== "in-use" || holding === undefined) return { device, state, inUseBy: null };
    return { device, state, inUseBy: await this.holderOf(holding, titles) };
  }

  private async holderOf(
    record: ConnectedDevice,
    titles = new Map<string, Promise<string>>(),
  ): Promise<ProjectDeviceHolder> {
    let title = titles.get(record.taskId);
    if (title === undefined) {
      title = this.tasks.find(record.taskId).then((task) => task?.title ?? record.taskId);
      titles.set(record.taskId, title);
    }
    return { kind: "task", taskId: record.taskId, title: await title };
  }
}

function placeOf(address: WirelessAddress, port: number): PhonePlace {
  return { address: address.address, deviceKey: wirelessDeviceKeyOf(address), port };
}

function targetOf(address: WirelessAddress, given: WirelessPhoneToPair): PhoneToPair {
  return { address, port: given.port, pairingPort: given.pairingPort };
}

/** A phone over wireless debugging's adb serial, where a lend connects to it. */
function wirelessEndpointOf(device: ProjectDevice): string | null {
  if (device.kind !== "android-wireless" || device.address === null || device.port === null) {
    return null;
  }
  const reading = wirelessAddressOf(device.address);
  return "problem" in reading ? null : adbSerialAt(reading.address, device.port);
}

function phoneAt(address: string): string {
  return `The phone at ${address}`;
}

function stateWordsOf(
  device: ProjectDevice,
  state: ProjectDeviceState,
  holder: ProjectDeviceHolder | null,
): string {
  if (state === "in-use") return `In use by ${holder?.title ?? "a Task"}`;
  const words = STATE_WORDS[state];
  return device.pairingStep === null ? words : `${words}, being paired now`;
}

function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
