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

/** What the helper notices about a serial board (spec §2.13, "Serial boards"). */
export const HELPER_NOTICE_CODES = [
  "no-answer-after-reset",
  "touch-1200",
  "esptool-sync-no-answer",
  "no-upload-tool",
] as const;
export type HelperNoticeCode = (typeof HELPER_NOTICE_CODES)[number];

/** What the Devices section says about a device in words: a slow round trip, or the helper's. */
export type DeviceNotice = "slow-round-trip" | HelperNoticeCode;

/** A round trip over this slows uploads enough to say so. */
export const SLOW_ROUND_TRIP_MS = 250;
/** A round trip that moved less than this from the one kept isn't kept: pings come every 5 s. */
export const ROUND_TRIP_STEP_MS = 25;

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
  /**
   * Where its bytes come out inside the run environment while Connected: `127.0.0.1:<port>`, or a
   * serial board's path (`/dev/ttyACM0`).
   */
  readonly endpoint: string | null;
  /** A serial board's baud rate, as the Project's tool last set it; null until it set one. */
  readonly baudRate: number | null;
  /** The round trip last measured between the helper and the browser, in ms; null until then. */
  readonly roundTripMs: number | null;
  /** What the helper noticed last, since its READY; null when nothing. */
  readonly notice: HelperNoticeCode | null;
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
    baudRate: null,
    roundTripMs: null,
    notice: null,
    disconnectedAt: null,
  };
  return { device, event: changed(device) };
}

export function isOpen(device: ConnectedDevice): boolean {
  return device.state !== "disconnected";
}

/**
 * Commands reach it at the endpoint: from Connecting or Waiting, or at a new endpoint. A new
 * helper's READY is a new connection, so the round trip and the notice start again; the baud rate
 * stays, as the board keeps it.
 */
export function deviceConnected(device: ConnectedDevice, endpoint: string): ConnectedDeviceChange {
  if (!isOpen(device)) return undefined;
  if (
    device.state === "connected" &&
    device.endpoint === endpoint &&
    device.roundTripMs === null &&
    device.notice === null
  ) {
    return undefined;
  }
  return withChange({ ...device, state: "connected", endpoint, roundTripMs: null, notice: null });
}

/** The Project's tool set the serial port's baud rate; nothing when it is the one kept. */
export function deviceBaudRateSet(
  device: ConnectedDevice,
  baudRate: number,
): ConnectedDeviceChange {
  if (!isOpen(device) || device.baudRate === baudRate) return undefined;
  return withChange({ ...device, baudRate });
}

/**
 * A round trip measured, kept only when it matters: the first one, one crossing
 * `SLOW_ROUND_TRIP_MS` either way, or one at least `ROUND_TRIP_STEP_MS` from the one kept.
 */
export function deviceRoundTripMeasured(
  device: ConnectedDevice,
  measuredMs: number,
): ConnectedDeviceChange {
  if (!isOpen(device)) return undefined;
  const roundTripMs = Math.max(0, Math.round(measuredMs));
  const kept = device.roundTripMs;
  const matters =
    kept === null ||
    kept > SLOW_ROUND_TRIP_MS !== roundTripMs > SLOW_ROUND_TRIP_MS ||
    Math.abs(roundTripMs - kept) >= ROUND_TRIP_STEP_MS;
  if (!matters) return undefined;
  return withChange({ ...device, roundTripMs });
}

/** The helper noticed something; nothing when it is the notice kept. */
export function deviceNoticed(
  device: ConnectedDevice,
  notice: HelperNoticeCode,
): ConnectedDeviceChange {
  if (!isOpen(device) || device.notice === notice) return undefined;
  return withChange({ ...device, notice });
}

/** What the Devices section says about it, in order: a slow round trip, then the helper's notice. */
export function noticesOf(device: ConnectedDevice): DeviceNotice[] {
  const notices: DeviceNotice[] = [];
  if (device.roundTripMs !== null && device.roundTripMs > SLOW_ROUND_TRIP_MS) {
    notices.push("slow-round-trip");
  }
  if (device.notice !== null) notices.push(device.notice);
  return notices;
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

/** The kinds adb reaches, each by its adb serial. */
export const ANDROID_KINDS: ReadonlySet<ConnectedDeviceKind> = new Set([
  "android-usb",
  "android-wireless",
]);

/**
 * The adb serial `adb devices` lists a Connected Android phone under: an Android phone over USB is
 * the helper's endpoint, as adb connects to it; undefined for any other device.
 */
export function adbSerialOf(device: ConnectedDevice): string | undefined {
  if (device.state !== "connected" || !ANDROID_KINDS.has(device.kind)) return undefined;
  return device.endpoint ?? undefined;
}

/**
 * `ANDROID_SERIAL` (spec §2.13, "What Agents see"): the adb serial of the one Android phone
 * Connected; undefined with none or several, so adb asks which.
 */
export function androidSerialOf(devices: readonly ConnectedDevice[]): string | undefined {
  const serials = devices.flatMap((device) => adbSerialOf(device) ?? []);
  return serials.length === 1 ? serials[0] : undefined;
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

/** Each notice in short words, for `read_task` and the Briefs. */
export const NOTICE_WORDS: Readonly<Record<DeviceNotice, string>> = {
  "slow-round-trip": "uploads will be slow, each step waiting for the round trip",
  "no-answer-after-reset": "the board didn't answer after its reset",
  "touch-1200": "its 1200-baud touch isn't carried through the browser",
  "esptool-sync-no-answer": "esptool's automatic reset isn't carried on this port",
  "no-upload-tool": "neither avrdude nor arduino-cli is in the run environment",
};

/**
 * What a device's line says after its state and endpoint: its baud rate and round trip once
 * known, then each notice in words.
 */
export function detailsOf(device: ConnectedDevice): string[] {
  return [
    ...(device.baudRate === null ? [] : [`${device.baudRate} baud`]),
    ...(device.roundTripMs === null ? [] : [`round trip ${device.roundTripMs} ms`]),
    ...noticesOf(device).map((notice) => NOTICE_WORDS[notice]),
  ];
}

function withChange(device: ConnectedDevice): ConnectedDeviceChange {
  return { device, event: changed(device) };
}

function changed(device: ConnectedDevice): ConnectedDeviceChanged {
  return new ConnectedDeviceChanged(device.taskId, device.id);
}
