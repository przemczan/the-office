import type {
  ConnectedDevice,
  ConnectedDeviceKind,
  DeviceUser,
  DisconnectedBecause,
} from "./connected-device.js";
import { ProjectDeviceChanged } from "./project-device-events.js";
import { ProjectDeviceRefused, type ProjectDeviceHolder } from "./project-device-refused.js";

export type { ProjectDeviceHolder } from "./project-device-refused.js";

/** The longest name the user gives a Project device (spec §2.13, "A Project's device"). */
export const PROJECT_DEVICE_NAME_MAX_LENGTH = 60;

/** The states a Project device keeps at rest (spec §2.13, "At rest and in use"). */
export type ProjectDeviceRestState = "paired" | "didnt-answer" | "not-paired" | "over-usb";

/** Its state as the user sees it: at rest, or In use while an open Connected device names it. */
export type ProjectDeviceState = ProjectDeviceRestState | "in-use";

/** A pairing's steps as they pass, which the pairing window shows. */
export type ProjectDevicePairingStep = "starting-environment" | "pairing" | "reading-model";

/** A Project device's last use: who held it, when it was let go of, and why. */
export interface ProjectDeviceLastUse {
  readonly holder: ProjectDeviceHolder;
  /** ISO 8601, as it is kept in jsonb. */
  readonly endedAt: string;
  readonly endedBecause: DisconnectedBecause;
}

/** A device kept for a Project between uses (spec §2.13, "A Project's device"). */
export interface ProjectDevice {
  readonly id: string;
  readonly projectId: string;
  readonly kind: ConnectedDeviceKind;
  /** The same rules as a Connected device's; unique among the Project's devices. */
  readonly deviceKey: string;
  readonly name: string;
  /** A phone over wireless debugging's IP address and Port; null for a device over USB. */
  readonly address: string | null;
  readonly port: number | null;
  readonly state: ProjectDeviceRestState;
  /** The step a pairing running now is at; null while none runs. */
  readonly pairingStep: ProjectDevicePairingStep | null;
  /** Why the last pairing failed, in the service's or adb's words; null once paired. */
  readonly pairingProblem: string | null;
  readonly addedBy: DeviceUser;
  readonly addedAt: Date;
  readonly lastUse: ProjectDeviceLastUse | null;
}

/** A change to a Project device with its event; undefined when nothing would change. */
export type ProjectDeviceChange =
  { readonly device: ProjectDevice; readonly event: ProjectDeviceChanged } | undefined;

/** Said while the Project's Run environment isn't On, as the Project page's Devices section warns. */
export const NEEDS_RUN_ENVIRONMENT_ON =
  "Needs Run environment On: a device is paired and used in the run environment.";
export const NAME_LENGTH = `A device's name is 1 to ${PROJECT_DEVICE_NAME_MAX_LENGTH} characters.`;
export const PORT_RANGE = "A port is a number from 1 to 65535.";
export const ONLY_WIRELESS_HAS_A_PORT = "Only a phone over wireless debugging has a Port.";
export const ONLY_WIRELESS_IS_PAIRED =
  "Only a phone over wireless debugging is paired; a device over USB is remembered by its device key.";
/** A pairing's `pairingProblem` when an Office restart cut it off. */
export const PAIRING_CUT_OFF_BY_RESTART = "The pairing was cut off by a restart; pair it again.";
/** A pairing's `pairingProblem` when the Project's Run environment turned Off under it. */
export const PAIRING_CUT_OFF_BY_RUN_ENVIRONMENT_OFF =
  "The pairing was cut off: Run environment turned Off.";
/** A pairing's `pairingProblem` when the Project's Connected devices were switched off under it. */
export const PAIRING_CUT_OFF_BY_SWITCH =
  "The pairing was cut off: Connected devices were switched off.";
/** A pairing's `pairingProblem` when its environment didn't start within its time limit. */
export const PAIRING_ENVIRONMENT_DIDNT_START = "The pairing environment didn't start in time.";
/** Said when a run names a device that isn't, or is no longer, one of its Project's. */
export const NOT_ONE_OF_THE_PROJECTS = "The device isn't one of this Project's devices.";

/** The state a device starts at rest with: Not paired until a phone pairs, Over USB otherwise. */
export function firstRestStateOf(kind: ConnectedDeviceKind): ProjectDeviceRestState {
  return kind === "android-wireless" ? "not-paired" : "over-usb";
}

/** A name as kept: trimmed and cut to `PROJECT_DEVICE_NAME_MAX_LENGTH`. */
export function projectDeviceNameOf(name: string): string {
  return name.trim().slice(0, PROJECT_DEVICE_NAME_MAX_LENGTH).trim();
}

interface NewProjectDevice {
  readonly id: string;
  readonly projectId: string;
  readonly addedBy: DeviceUser;
  readonly addedAt: Date;
}

/** A device over USB the browser reached, remembered by its device key, its name the browser's. */
export function usbProjectDevice(
  given: NewProjectDevice & {
    readonly kind: ConnectedDeviceKind;
    readonly name: string;
    readonly deviceKey: string;
  },
): { readonly device: ProjectDevice; readonly event: ProjectDeviceChanged } {
  const name = projectDeviceNameOf(given.name);
  if (name === "") throw new ProjectDeviceRefused([NAME_LENGTH]);
  return withChange({
    ...given,
    name,
    address: null,
    port: null,
    state: firstRestStateOf(given.kind),
    pairingStep: null,
    pairingProblem: null,
    lastUse: null,
  });
}

/** Where a phone over wireless debugging is paired at and reached: its address, key and Port. */
export interface PhonePlace {
  /** Canonical, IPv6 in its shortest lower-case form. */
  readonly address: string;
  readonly deviceKey: string;
  readonly port: number;
}

/** A phone over wireless debugging, added Not paired, named by its address, its pairing starting. */
export function wirelessProjectDevice(given: NewProjectDevice & PhonePlace): {
  readonly device: ProjectDevice;
  readonly event: ProjectDeviceChanged;
} {
  return withChange({
    ...given,
    kind: "android-wireless",
    name: given.address,
    state: "not-paired",
    pairingStep: "starting-environment",
    pairingProblem: null,
    lastUse: null,
  });
}

/** Renamed, trimmed; refused when empty or longer than `PROJECT_DEVICE_NAME_MAX_LENGTH`. */
export function projectDeviceRenamed(device: ProjectDevice, given: string): ProjectDeviceChange {
  const name = given.trim();
  if (name === "" || name.length > PROJECT_DEVICE_NAME_MAX_LENGTH) {
    throw new ProjectDeviceRefused([NAME_LENGTH]);
  }
  return name === device.name ? undefined : withChange({ ...device, name });
}

/**
 * A phone over wireless debugging's new Port, needing no pairing: the phone trusts the key. One
 * that Didn't answer at its old Port is Paired again, as its last connect wasn't at this one.
 */
export function projectDevicePortChanged(device: ProjectDevice, port: number): ProjectDeviceChange {
  if (device.kind !== "android-wireless")
    throw new ProjectDeviceRefused([ONLY_WIRELESS_HAS_A_PORT]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProjectDeviceRefused([PORT_RANGE]);
  }
  if (port === device.port) return undefined;
  return withChange({
    ...device,
    port,
    state: device.state === "didnt-answer" ? "paired" : device.state,
  });
}

/**
 * A pairing starts at the place given, its address possibly a new one, hence its device key;
 * refused while one runs. A name that was still the old address becomes the new one.
 */
export function pairingStarted(device: ProjectDevice, place: PhonePlace): ProjectDeviceChange {
  if (device.kind !== "android-wireless") throw new ProjectDeviceRefused([ONLY_WIRELESS_IS_PAIRED]);
  if (device.pairingStep !== null) throw new ProjectDeviceRefused([beingPaired(device)]);
  return withChange({
    ...device,
    ...place,
    name: device.name === device.address ? place.address : device.name,
    pairingStep: "starting-environment",
    pairingProblem: null,
  });
}

/** The pairing running now got to the step; nothing once it ended. */
export function pairingStepped(
  device: ProjectDevice,
  step: ProjectDevicePairingStep,
): ProjectDeviceChange {
  if (device.pairingStep === null || device.pairingStep === step) return undefined;
  return withChange({ ...device, pairingStep: step });
}

/** Paired: the phone trusts the Project's adb key; a name still its address becomes the model. */
export function pairingSucceeded(
  device: ProjectDevice,
  model: string | undefined,
): ProjectDeviceChange {
  const modelName = model === undefined ? "" : projectDeviceNameOf(model);
  return withChange({
    ...device,
    name: device.name === device.address && modelName !== "" ? modelName : device.name,
    state: "paired",
    pairingStep: null,
    pairingProblem: null,
  });
}

/** Not paired, with why in adb's or the service's words. */
export function pairingFailed(device: ProjectDevice, problem: string): ProjectDeviceChange {
  return withChange({
    ...device,
    state: "not-paired",
    pairingStep: null,
    pairingProblem: problem,
  });
}

/**
 * A pairing cut off (by an Office restart unless `problem` says otherwise) is Not paired, with why;
 * nothing for none.
 */
export function pairingCutOff(
  device: ProjectDevice,
  problem: string = PAIRING_CUT_OFF_BY_RESTART,
): ProjectDeviceChange {
  return device.pairingStep === null ? undefined : pairingFailed(device, problem);
}

/** In use while an open Connected device record names it, else its state at rest. */
export function projectDeviceStateOf(
  device: ProjectDevice,
  holding: ConnectedDevice | undefined,
): ProjectDeviceState {
  return holding !== undefined && holding.state !== "disconnected" ? "in-use" : device.state;
}

/**
 * The state at rest once a use's record ended: a phone that didn't answer at its address and
 * Port is Didn't answer, one that connected is Paired; a device over USB stays Over USB, and a
 * phone that never got as far as connecting keeps what it was.
 */
export function restStateAfter(
  device: ProjectDevice,
  ended: ConnectedDevice,
): ProjectDeviceRestState {
  if (device.kind !== "android-wireless") return "over-usb";
  if (ended.disconnectedBecause === "device-unplugged") return "didnt-answer";
  return ended.everConnected ? "paired" : device.state;
}

/** Its last use, as the lend's record ended. */
export function lastUseOf(
  ended: ConnectedDevice,
  holder: ProjectDeviceHolder,
): ProjectDeviceLastUse {
  return {
    holder,
    endedAt: (ended.disconnectedAt ?? new Date()).toISOString(),
    endedBecause: ended.disconnectedBecause ?? "by-user",
  };
}

/** The holder let go of it: at rest again, with its last use (spec §2.13, "At rest and in use"). */
export function projectDeviceGivenBack(
  device: ProjectDevice,
  ended: ConnectedDevice,
  holder: ProjectDeviceHolder,
): ProjectDeviceChange {
  return withChange({
    ...device,
    state: restStateAfter(device, ended),
    lastUse: lastUseOf(ended, holder),
  });
}

/** The holder as the UI names it: a Task by its title, a run by its name. */
export function holderNameOf(holder: ProjectDeviceHolder): string {
  return holder.kind === "task" ? holder.title : holder.name;
}

/**
 * Why a device can't be lent, held, paired or removed while something holds it, in the UI's
 * words.
 */
export function inUseBy(device: Pick<ProjectDevice, "name">, holder: ProjectDeviceHolder): string {
  return `${device.name} is in use by ${holderNameOf(holder)}.`;
}

/** Said when a pairing, a lend or a removal is asked of a device a pairing runs for. */
export function beingPaired(device: Pick<ProjectDevice, "name">): string {
  return `${device.name} is being paired; wait for it to end.`;
}

/** Said when a device key is the Project's already. */
export function alreadyAmongTheProjects(name: string): string {
  return `${name} is already among this Project's devices.`;
}

/** Said when a Task is lent a device of another Project. */
export function notOfTheTasksProject(device: Pick<ProjectDevice, "name">): string {
  return `${device.name} isn't one of this Task's Project's devices.`;
}

function withChange(device: ProjectDevice): {
  readonly device: ProjectDevice;
  readonly event: ProjectDeviceChanged;
} {
  return { device, event: new ProjectDeviceChanged(device.projectId, device.id) };
}
