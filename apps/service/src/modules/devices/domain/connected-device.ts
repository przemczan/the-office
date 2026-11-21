import { ConnectedDeviceChanged } from "./connected-device-events.js";
import type { OtherTask } from "./connected-device-refused.js";

/** A Connected device's kinds (spec §2.13, "Connected device"). */
export const CONNECTED_DEVICE_KINDS = ["android-usb", "serial-usb", "android-wireless"] as const;
export type ConnectedDeviceKind = (typeof CONNECTED_DEVICE_KINDS)[number];

/** Spec §2.13, "States". */
export type ConnectedDeviceState =
  "connecting" | "connected" | "waiting-for-run-environment" | "disconnected";

/** Why a Connected device is Disconnected (spec §2.13, "States"). */
export type DisconnectedBecause =
  | "by-user"
  | "tab-closed"
  | "task-ended"
  | "device-unplugged"
  | "run-environment-turned-off"
  | "error";

/** A signed-in user, named as when they acted. */
export interface DeviceUser {
  readonly userId: string;
  readonly name: string;
}

/** One device connected, or once connected, to one Task's run environment. */
export interface ConnectedDevice {
  readonly id: string;
  readonly taskId: string;
  /** The Task's Project, whose Run environment setting it needs On. */
  readonly projectId: string;
  readonly kind: ConnectedDeviceKind;
  /** As the device reports it. */
  readonly name: string;
  /** What the browser reports to recognise it by; unique among the records not Disconnected. */
  readonly deviceKey: string;
  readonly state: ConnectedDeviceState;
  /** Null unless Disconnected. */
  readonly disconnectedBecause: DisconnectedBecause | null;
  /** Who disconnected it, when `by-user`. */
  readonly disconnectedBy: DeviceUser | null;
  /** The error in words, when `error`. */
  readonly problem: string | null;
  /** Where its bytes come out inside the run environment, `127.0.0.1:<port>`, while Connected. */
  readonly endpoint: string | null;
  readonly connectedBy: DeviceUser;
  readonly connectedAt: Date;
  readonly disconnectedAt: Date | null;
}

/** A change to a device with its event; undefined when nothing would change. */
export type ConnectedDeviceChange =
  { readonly device: ConnectedDevice; readonly event: ConnectedDeviceChanged } | undefined;

/** The kinds the service relays the bytes of; the others' own Tasks add them. */
export const RELAYED_KINDS: ReadonlySet<ConnectedDeviceKind> = new Set([
  "android-usb",
  "serial-usb",
]);

export const RUN_ENVIRONMENT_OFF = "The Project's Run environment is Off.";
export const TASK_DONE = "The Task is Done.";
export const TASK_DROPPED = "The Task is Dropped.";
export const WIRELESS_NOT_YET =
  "An Android phone over wireless debugging can't be connected yet: pairing over the network isn't built.";

/** Why the Task's other device holds the key, in the UI's words. */
export function alreadyConnectedTo(task: OtherTask): string {
  return `Already connected to the Task «${task.title}».`;
}

/** What a connect is weighed on, besides the helper and the device key. */
export interface ConnectRequest {
  /** "done" or "dropped" for a Task that ended; anything else for an open one. */
  readonly taskState: string;
  readonly runEnvironmentOn: boolean;
  readonly kind: ConnectedDeviceKind;
}

/** Every reason the connect is refused, in the UI's words; none when it may go on. */
export function connectProblemsOf(request: ConnectRequest): string[] {
  const problems: string[] = [];
  if (request.taskState === "done") problems.push(TASK_DONE);
  if (request.taskState === "dropped") problems.push(TASK_DROPPED);
  if (!request.runEnvironmentOn) problems.push(RUN_ENVIRONMENT_OFF);
  if (!RELAYED_KINDS.has(request.kind)) problems.push(WIRELESS_NOT_YET);
  return problems;
}

export interface NewConnectedDevice {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly kind: ConnectedDeviceKind;
  readonly name: string;
  readonly deviceKey: string;
  readonly connectedBy: DeviceUser;
  readonly connectedAt: Date;
}

/** A device the browser reached, Connecting until its relay and helper are up. */
export function connectingDevice(given: NewConnectedDevice): {
  readonly device: ConnectedDevice;
  readonly event: ConnectedDeviceChanged;
} {
  const device: ConnectedDevice = {
    ...given,
    state: "connecting",
    disconnectedBecause: null,
    disconnectedBy: null,
    problem: null,
    endpoint: null,
    disconnectedAt: null,
  };
  return { device, event: changed(device) };
}

export function isOpen(device: ConnectedDevice): boolean {
  return device.state !== "disconnected";
}

/** Commands reach it at the endpoint: from Connecting or Waiting, or at a new endpoint. */
export function deviceConnected(device: ConnectedDevice, endpoint: string): ConnectedDeviceChange {
  if (!isOpen(device)) return undefined;
  if (device.state === "connected" && device.endpoint === endpoint) return undefined;
  return withChange({ ...device, state: "connected", endpoint });
}

/** The run environment isn't running: from Connecting or Connected. */
export function deviceWaiting(device: ConnectedDevice): ConnectedDeviceChange {
  if (device.state !== "connecting" && device.state !== "connected") return undefined;
  return withChange({ ...device, state: "waiting-for-run-environment", endpoint: null });
}

export interface Disconnection {
  readonly because: DisconnectedBecause;
  /** Who, for `by-user`. */
  readonly by?: DeviceUser;
  /** The error, for `error`. */
  readonly problem?: string;
  readonly at: Date;
}

/** Ends any open device, for good; a Disconnected one stays as it ended. */
export function deviceDisconnected(
  device: ConnectedDevice,
  disconnection: Disconnection,
): ConnectedDeviceChange {
  if (!isOpen(device)) return undefined;
  return withChange({
    ...device,
    state: "disconnected",
    disconnectedBecause: disconnection.because,
    disconnectedBy: disconnection.because === "by-user" ? (disconnection.by ?? null) : null,
    problem: disconnection.because === "error" ? (disconnection.problem ?? null) : null,
    endpoint: null,
    disconnectedAt: disconnection.at,
  });
}

/**
 * `OFFICE_CONNECTED_DEVICES` (spec §2.13, "What Agents see"): the Connected ones only, as a JSON
 * array of `{ id, kind, name, endpoint }`; `[]` with none.
 */
export function connectedDevicesVariable(devices: readonly ConnectedDevice[]): string {
  return JSON.stringify(
    devices
      .filter((device) => device.state === "connected")
      .map(({ id, kind, name, endpoint }) => ({ id, kind, name, endpoint })),
  );
}

export const KIND_WORDS: Readonly<Record<ConnectedDeviceKind, string>> = {
  "android-usb": "Android phone over USB",
  "serial-usb": "Serial board over USB",
  "android-wireless": "Android phone over wireless debugging",
};

export const STATE_WORDS: Readonly<Record<ConnectedDeviceState, string>> = {
  connecting: "Connecting",
  connected: "Connected",
  "waiting-for-run-environment": "Waiting for the run environment",
  disconnected: "Disconnected",
};

function withChange(device: ConnectedDevice): ConnectedDeviceChange {
  return { device, event: changed(device) };
}

function changed(device: ConnectedDevice): ConnectedDeviceChanged {
  return new ConnectedDeviceChanged(device.taskId, device.id);
}
