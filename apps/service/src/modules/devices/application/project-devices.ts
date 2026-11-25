import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  ProjectDeviceLines,
  ProjectFeaturesChanged,
  ProjectRunEnvironmentChanged,
  type ProjectDeviceLine,
} from "../../projects/index.js";
import { DEVICE_HELPER_NOT_BUILT, DeviceHelperFiles } from "../../run-environments/index.js";
import {
  ANDROID_KINDS,
  KIND_WORDS,
  type ConnectedDevice,
  type ConnectedDeviceKind,
  type DeviceUser,
} from "../domain/connected-device.js";
import { ConnectedDeviceChanged } from "../domain/connected-device-events.js";
import {
  alreadyAmongTheProjects,
  beingPaired,
  holderNameOf,
  inUseBy,
  NEEDS_RUN_ENVIRONMENT_ON,
  NOT_ONE_OF_THE_PROJECTS,
  PAIRING_CUT_OFF_BY_RUN_ENVIRONMENT_OFF,
  PAIRING_CUT_OFF_BY_SWITCH,
  PAIRING_ENVIRONMENT_DIDNT_START,
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
import type { DeviceHold, DeviceHoldRequest, HeldDeviceOf } from "./device-holds.js";
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

/**
 * How long a pairing environment has to start, its image built included (spec §2.13, "The pairing
 * environment's start"); by then the pairing ends Not paired, its start cut off.
 */
export const PAIRING_ENVIRONMENT_START_TIMEOUT_MS = 15 * 60_000;

/** A pairing running now: cut off through its signal, its environment removed once. */
interface RunningPairing {
  readonly projectId: string;
  readonly controller: AbortController;
  /** Removes its environment once it started; at most once, however the pairing ends. */
  removeEnvironment?: () => Promise<void>;
}

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
  /** The pairings running now, for `settled`. */
  private readonly pairings = new Set<Promise<void>>();
  /** The pairing running now for each Project device, by its id. */
  private readonly running = new Map<string, RunningPairing>();

  constructor(
    private readonly repository: ProjectDeviceRepository,
    private readonly connectedDevices: ConnectedDeviceRepository,
    private readonly devices: ConnectedDevices,
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
    // Every lent or held record's change, its end included, goes through the one place records change.
    this.events.subscribe(ConnectedDeviceChanged, (event) => this.lentDeviceChanged(event));
    // A pairing needs the Run environment On and Connected devices switched on throughout.
    this.events.subscribe(ProjectRunEnvironmentChanged, ({ projectId, runEnvironment }) => {
      if (runEnvironment === "on") return;
      return this.pairingsCutOff(projectId, PAIRING_CUT_OFF_BY_RUN_ENVIRONMENT_OFF);
    });
    // Connected devices reads off whenever Run environment isn't On, so both events may come.
    this.events.subscribe(ProjectFeaturesChanged, async ({ projectId, features }) => {
      if (features["connected-devices"]) return;
      const runEnvironmentOn = await this.runEnvironmentSettings.isOn(projectId).catch(() => true);
      return this.pairingsCutOff(
        projectId,
        runEnvironmentOn ? PAIRING_CUT_OFF_BY_SWITCH : PAIRING_CUT_OFF_BY_RUN_ENVIRONMENT_OFF,
      );
    });
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

  /**
   * Forgets it; refused while it is in use, naming the holder, or while it pairs, checked holding
   * its row.
   */
  async remove(id: string): Promise<void> {
    const removed = await this.repository.withDeviceLocked(id, async (locked) => {
      if (locked === undefined) return { kind: "missing" } as const;
      const { device } = locked;
      if (device.pairingStep !== null) return { kind: "pairing", device } as const;
      const holding = await locked.holding();
      if (holding !== undefined) return { kind: "held", device, holding } as const;
      await locked.remove();
      return { kind: "removed", device } as const;
    });
    if (removed.kind === "missing") throw new ProjectDeviceNotFound(id);
    if (removed.kind === "pairing") throw new ProjectDeviceRefused([beingPaired(removed.device)]);
    if (removed.kind === "held") await this.refuseHeld(removed.device, removed.holding);
    await this.events.publish(new ProjectDeviceChanged(removed.device.projectId, id));
  }

  /**
   * Pairs a phone over wireless debugging again, at the address and Port given, in a pairing
   * environment. Refused as adding is, while it is in use, naming the holder, and while it pairs.
   */
  async pair(id: string, given: WirelessPhoneToPair): Promise<SeenProjectDevice> {
    const kept = await this.find(id);
    const problems = await this.projectProblemsOf(kept.projectId);
    const address = await this.phoneAddressOf(given.address, problems);
    const place = placeOf(address, given.port);
    const updated = await this.repository.withDeviceLocked(id, async (locked) => {
      if (locked === undefined) return { kind: "missing" } as const;
      const holding = await locked.holding();
      if (holding !== undefined) return { kind: "held", device: locked.device, holding } as const;
      return locked.update((device) => pairingStarted(device, place));
    });
    if (updated.kind === "missing") throw new ProjectDeviceNotFound(id);
    if (updated.kind === "held") await this.refuseHeld(updated.device, updated.holding);
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
   * Holds the device for an Action run or a test instance while it runs (spec §2.13, "In use"), in
   * the run's own environment: refused (ProjectDeviceRefused) unless the Project's Run environment
   * is On, Connected devices switched on, the device one of the Project's, the helper built and
   * the device at rest, not pairing nor held, naming the holder (409); then held, with the adb
   * serial and the variables for the run's commands, or not held, with why in 2.13's words.
   */
  async hold(request: DeviceHoldRequest): Promise<DeviceHold> {
    const device = await this.checkedFree(request.projectId, request.projectDeviceId);
    return this.devices.hold(request, {
      projectDeviceId: device.id,
      kind: device.kind,
      name: device.name,
      deviceKey: device.deviceKey,
      wirelessEndpoint: wirelessEndpointOf(device),
    });
  }

  /**
   * The run lets go of its hold, as run ended, once it ends whatever way: `adb disconnect` first
   * while its environment runs; nothing for a hold already Disconnected.
   */
  letGo(holdId: string): Promise<void> {
    return this.devices.letGo(holdId);
  }

  /**
   * Checks as `hold` does, holding nothing, for a run's start: answers the device's id, name and
   * kind, or refuses (ProjectDeviceRefused), naming the holder while one holds it.
   */
  async checkFree(projectId: string, projectDeviceId: string): Promise<HeldDeviceOf> {
    const device = await this.checkedFree(projectId, projectDeviceId);
    return { id: device.id, name: device.name, kind: device.kind };
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
      androidPhone: ANDROID_KINDS.has(device.kind),
    }));
  }

  /**
   * A lent or held record changed: Disconnected gives the device back, at rest again with its
   * last use, Paired once its record was ever Connected (kept on the record). Either way the
   * Project's devices changed, as In use came or went. Never throws, as the bus waits for it
   * inside the change.
   */
  private async lentDeviceChanged(event: ConnectedDeviceChanged): Promise<void> {
    const { projectDeviceId, deviceId } = event;
    if (projectDeviceId === null) return;
    try {
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
    const holder = await this.devices.holderOf(ended);
    const updated = await this.repository.update(projectDeviceId, (device) =>
      projectDeviceGivenBack(device, ended, holder),
    );
    if (updated.kind === "changed") await this.events.publish(updated.change.event);
  }

  /**
   * Pairs in a pairing environment, detached from the request: the base branch's definition
   * written out, the environment started within `PAIRING_ENVIRONMENT_START_TIMEOUT_MS`, then adb's
   * check, the Project's key, `adb pair` with the code on its standard input, `adb connect`, the
   * model and `adb disconnect`, bounded as a Task's pairing. Cut off by the Run environment turned
   * Off or Connected devices switched off. The environment and the definition are removed however
   * it ends.
   */
  private followPairing(device: ProjectDevice, target: PhoneToPair, pairingCode: string): void {
    const running: RunningPairing = {
      projectId: device.projectId,
      controller: new AbortController(),
    };
    this.running.set(device.id, running);
    const pairing = this.pairIn(device, target, pairingCode, running)
      .catch(async (error: unknown) => {
        this.logger.error(`The Project device ${device.id} wasn't paired.`, error);
        await this.pairingEnded(device.id, running, {
          kind: "failed",
          problem: wordsOf(error),
        }).catch(() => undefined);
      })
      .finally(() => {
        if (this.running.get(device.id) === running) this.running.delete(device.id);
      });
    this.pairings.add(pairing);
    void pairing.finally(() => this.pairings.delete(pairing));
  }

  private async pairIn(
    device: ProjectDevice,
    target: PhoneToPair,
    pairingCode: string,
    running: RunningPairing,
  ): Promise<void> {
    const logFolder = await mkdtemp(join(tmpdir(), "office-pairing-log-"));
    let definition: PairingDefinition | undefined;
    try {
      const exported = await this.definitions.exportDefinition(device.projectId);
      if ("problems" in exported) {
        await this.pairingEnded(device.id, running, {
          kind: "failed",
          problem: exported.problems.join(" "),
        });
        return;
      }
      definition = exported;
      const started = await this.startWithinLimit(device, definition, logFolder, running);
      if (started === undefined) return;
      if ("problems" in started) {
        await this.pairingEnded(device.id, running, {
          kind: "failed",
          problem: started.problems.join(" "),
        });
        return;
      }
      const place: AdbPlace = {
        projectId: device.projectId,
        label: `the pairing environment of the Project device ${device.id}`,
        attach: (attachment) => started.attach(attachment),
      };
      await this.stepTo(device.id, running, "pairing");
      const end = await this.wireless.pairIn(place, target, pairingCode, () =>
        this.stepTo(device.id, running, "reading-model"),
      );
      if (end.kind === "connected") await this.wireless.disconnectIn(place, end.endpoint);
      await this.pairingEnded(device.id, running, end);
    } finally {
      await running.removeEnvironment?.();
      await definition?.remove();
      await rm(logFolder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Starts the pairing environment, cut off after `PAIRING_ENVIRONMENT_START_TIMEOUT_MS`: the
   * device is then Not paired, saying so, and the start is stopped through its signal. Undefined
   * once the pairing was cut off, its environment removed.
   */
  private async startWithinLimit(
    device: ProjectDevice,
    definition: PairingDefinition,
    logFolder: string,
    running: RunningPairing,
  ): Promise<RunningPairingEnvironment | { readonly problems: readonly string[] } | undefined> {
    const limit = this.schedule.once(
      "project-device-pairing-start",
      new Date(this.schedule.now().getTime() + PAIRING_ENVIRONMENT_START_TIMEOUT_MS),
      () => this.cutOff(device.id, running, PAIRING_ENVIRONMENT_DIDNT_START),
    );
    let started: RunningPairingEnvironment | { readonly problems: readonly string[] };
    try {
      started = await this.pairingEnvironments.start({
        projectId: device.projectId,
        projectDeviceId: device.id,
        definitionFolder: definition.folder,
        logFile: join(logFolder, "pairing.log"),
        signal: running.controller.signal,
      });
    } finally {
      limit.cancel();
    }
    if ("problems" in started) return running.controller.signal.aborted ? undefined : started;
    running.removeEnvironment = once(() => started.remove());
    if (!running.controller.signal.aborted) return started;
    await running.removeEnvironment();
    return undefined;
  }

  /**
   * Every pairing of the Project running now is cut off, Not paired with why; never throws, as the
   * bus waits for it.
   */
  private async pairingsCutOff(projectId: string, problem: string): Promise<void> {
    for (const [id, running] of this.running) {
      if (running.projectId !== projectId) continue;
      await this.cutOff(id, running, problem).catch((error: unknown) => {
        this.logger.error(`The pairing of the Project device ${id} wasn't cut off.`, error);
      });
    }
  }

  /**
   * Cuts the pairing off: its start or adb's steps stopped, the device Not paired with why at
   * once, its environment removed in the background; nothing for a pairing that already ended.
   */
  private async cutOff(id: string, running: RunningPairing, problem: string): Promise<void> {
    if (this.running.get(id) !== running) return;
    this.running.delete(id);
    running.controller.abort();
    void running.removeEnvironment?.().catch((error: unknown) => {
      this.logger.warn(
        `The pairing environment of the Project device ${id} wasn't removed.`,
        error,
      );
    });
    await this.update(id, (device) => pairingCutOff(device, problem));
  }

  /** The pairing got to the step, unless it was cut off meanwhile. */
  private async stepTo(
    id: string,
    running: RunningPairing,
    step: ProjectDevicePairingStep,
  ): Promise<void> {
    if (this.running.get(id) !== running) return;
    await this.update(id, (device) => pairingStepped(device, step));
  }

  /** The pairing ended, unless it was cut off meanwhile, which said why already. */
  private async pairingEnded(id: string, running: RunningPairing, end: WirelessEnd): Promise<void> {
    if (this.running.get(id) !== running) return;
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

  /**
   * The device as a run names it, refused unless it is one of the Project's, the Project takes
   * devices now, the helper is built, and it is at rest: not pairing, nor held, naming the holder.
   */
  private async checkedFree(projectId: string, id: string): Promise<ProjectDevice> {
    const device = await this.repository.find(id);
    if (device === undefined || device.projectId !== projectId) {
      throw new ProjectDeviceRefused([NOT_ONE_OF_THE_PROJECTS]);
    }
    const problems = await this.projectProblemsOf(projectId);
    if (
      problems.length === 0 &&
      (await this.helperFiles.executableFor(hostHelperArchitecture())) === undefined
    ) {
      problems.push(DEVICE_HELPER_NOT_BUILT);
    }
    if (problems.length > 0) throw new ProjectDeviceRefused(problems);
    if (device.pairingStep !== null) throw new ProjectDeviceRefused([beingPaired(device)]);
    const holding = await this.connectedDevices.openOfProjectDevice(device.id);
    if (holding !== undefined) await this.refuseHeld(device, holding);
    return device;
  }

  /** Refuses, naming the holder of the record holding the device. */
  private async refuseHeld(device: ProjectDevice, holding: ConnectedDevice): Promise<never> {
    const holder = await this.devices.holderOf(holding);
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
    return { device, state, inUseBy: await this.devices.holderOf(holding, titles) };
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
  if (state === "in-use") return `In use by ${holder === null ? "a Task" : holderNameOf(holder)}`;
  const words = STATE_WORDS[state];
  return device.pairingStep === null ? words : `${words}, being paired now`;
}

function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The work run the first time it is asked, the same promise answered after. */
function once(work: () => Promise<void>): () => Promise<void> {
  let done: Promise<void> | undefined;
  return () => (done ??= work());
}
