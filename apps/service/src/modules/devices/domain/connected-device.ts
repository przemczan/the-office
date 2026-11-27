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
  | "connected-devices-switched-off"
  | "error"
  /** The Action run or test instance that held a Project device let go of it. */
  | "run-ended";

/** What the helper notices about a serial board (spec §2.13, "Serial boards"). */
export const HELPER_NOTICE_CODES = [
  "no-answer-after-reset",
  "touch-1200",
  "esptool-sync-no-answer",
  "no-upload-tool",
  "port-busy",
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

/**
 * Who connected a device: the user, and for a device a person lent, the person by their Role's key,
 * the user being the one who asked them (or allowed the call), so a record keeps a user as before.
 */
export interface DeviceConnector extends DeviceUser {
  readonly person?: string;
}

/**
 * What holds a Project device other than a Task (spec §2.13, "One environment at a time"): an
 * Action run or a test instance, with its name as "<device> is in use by <name>." says it. The run
 * gives the name, so Devices never reads Actions or Test instances.
 */
export type RunHolder =
  | { readonly kind: "action-run"; readonly actionRunId: string; readonly name: string }
  | { readonly kind: "test-instance"; readonly testInstanceId: string; readonly name: string };

/**
 * One device connected, or once connected, to one Task's run environment, or a run's hold of a
 * Project device in the run's own environment: exactly one of `taskId` and `runHolder`.
 */
export interface ConnectedDevice {
  readonly id: string;
  /** The Task it is connected to; null for a run's hold. */
  readonly taskId: string | null;
  /** The Action run or test instance holding the Project device; null for a Task's device. */
  readonly runHolder: RunHolder | null;
  /** The tab that relays a run's device over USB, which opens it as it sees this record; else null. */
  readonly relayTab: string | null;
  /** Whether it was ever Connected, kept so a restart doesn't forget it. */
  readonly everConnected: boolean;
  /** The holder's Project, whose Run environment setting it needs On. */
  readonly projectId: string;
  /** The Project device it was lent from (spec §2.13, "Lent to a Task"); null for one the Task connected itself. */
  readonly projectDeviceId: string | null;
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
  /** The error in words, when `error`; what to do, when a phone over wireless debugging is `device-unplugged`. */
  readonly problem: string | null;
  /**
   * While Connected, where commands reach it: where its bytes come out inside the run environment,
   * `127.0.0.1:<port>`, a serial board's path (`/dev/ttyACM0`), or a phone over wireless
   * debugging's adb serial, `<address>:<port>`, which it keeps while Waiting too.
   */
  readonly endpoint: string | null;
  /**
   * While Connected, a serial board's RFC 2217 address in the run environment
   * (`rfc2217://127.0.0.1:<port>`), beside its path; null for every other kind and otherwise.
   */
  readonly rfc2217Url: string | null;
  /** A serial board's baud rate, as the Project's tool last set it; null until it set one. */
  readonly baudRate: number | null;
  /** The round trip last measured between the helper and the browser, in ms; null until then. */
  readonly roundTripMs: number | null;
  /** What the helper noticed last, since its READY; null when nothing. */
  readonly notice: HelperNoticeCode | null;
  readonly connectedBy: DeviceConnector;
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
export const WIRELESS_IS_PAIRED =
  "An Android phone over wireless debugging is paired with its pairing code, not connected through the browser.";

export const ALREADY_IN_THIS_TASK =
  "This device is already in this Task's devices. Disconnect it there first, then connect it again.";

/** Why the Task's other device holds the key, in the UI's words. */
export function alreadyConnectedTo(task: OtherTask): string {
  return `Already connected to the Task «${task.title}».`;
}

/** What any device's connect or pairing is weighed on, besides the device key. */
export interface TaskOfDevice {
  /** "done" or "dropped" for a Task that ended; anything else for an open one. */
  readonly taskState: string;
  readonly runEnvironmentOn: boolean;
}

/** What a connect through the browser is weighed on, besides the helper and the device key. */
export interface ConnectRequest extends TaskOfDevice {
  readonly kind: ConnectedDeviceKind;
}

/** Every reason the Task takes no device, in the UI's words; none when it may. */
export function taskProblemsOf(task: TaskOfDevice): string[] {
  const problems: string[] = [];
  if (task.taskState === "done") problems.push(TASK_DONE);
  if (task.taskState === "dropped") problems.push(TASK_DROPPED);
  if (!task.runEnvironmentOn) problems.push(RUN_ENVIRONMENT_OFF);
  return problems;
}

/** Every reason the connect is refused, in the UI's words; none when it may go on. */
export function connectProblemsOf(request: ConnectRequest): string[] {
  const problems = taskProblemsOf(request);
  if (!RELAYED_KINDS.has(request.kind)) problems.push(WIRELESS_IS_PAIRED);
  return problems;
}

export interface NewConnectedDevice {
  readonly id: string;
  readonly taskId: string;
  readonly projectId: string;
  /** The Project device lent to the Task, when it is one. */
  readonly projectDeviceId?: string;
  readonly kind: ConnectedDeviceKind;
  readonly name: string;
  readonly deviceKey: string;
  readonly connectedBy: DeviceConnector;
  readonly connectedAt: Date;
}

/** A device the browser reached, Connecting until its relay and helper are up. */
export function connectingDevice(given: NewConnectedDevice): {
  readonly device: ConnectedDevice;
  readonly event: ConnectedDeviceChanged;
} {
  const device: ConnectedDevice = {
    ...given,
    projectDeviceId: given.projectDeviceId ?? null,
    runHolder: null,
    relayTab: null,
    everConnected: false,
    state: "connecting",
    disconnectedBecause: null,
    disconnectedBy: null,
    problem: null,
    endpoint: null,
    rfc2217Url: null,
    baudRate: null,
    roundTripMs: null,
    notice: null,
    disconnectedAt: null,
  };
  return { device, event: changed(device) };
}

/**
 * A Project device lent to the Task (spec §2.13, "Lent to a Task"), with no pairing: a device over
 * USB Connecting until the browser's relay and helper are up; a phone over wireless debugging
 * Waiting for the run environment at its adb serial `<address>:<port>`, which its start, or a
 * reconnect at once while it runs, connects to with the Project's adb key.
 */
export function lentDevice(
  given: NewConnectedDevice & { readonly projectDeviceId: string },
  wirelessEndpoint: string | null,
): { readonly device: ConnectedDevice; readonly event: ConnectedDeviceChanged } {
  const { device } = connectingDevice(given);
  if (device.kind !== "android-wireless" || wirelessEndpoint === null) {
    return { device, event: changed(device) };
  }
  const waiting: ConnectedDevice = {
    ...device,
    state: "waiting-for-run-environment",
    endpoint: wirelessEndpoint,
  };
  return { device: waiting, event: changed(waiting) };
}

/** A run's hold of a Project device, made as the run's step that needs it starts. */
export interface NewHeldDevice {
  readonly id: string;
  readonly runHolder: RunHolder;
  readonly projectId: string;
  readonly projectDeviceId: string;
  readonly kind: ConnectedDeviceKind;
  readonly name: string;
  readonly deviceKey: string;
  /** The tab relaying a device over USB; null for a phone over wireless debugging. */
  readonly relayTab: string | null;
  readonly connectedBy: DeviceConnector;
  readonly connectedAt: Date;
}

/**
 * A Project device held by a run (spec §2.13, "In use"), Connecting in the run's environment,
 * which already runs: a device over USB until the starting tab's relay and the helper are up, a
 * phone over wireless debugging until adb connects to it with the Project's key.
 */
export function heldDevice(given: NewHeldDevice): {
  readonly device: ConnectedDevice;
  readonly event: ConnectedDeviceChanged;
} {
  const device: ConnectedDevice = {
    ...given,
    taskId: null,
    everConnected: false,
    state: "connecting",
    disconnectedBecause: null,
    disconnectedBy: null,
    problem: null,
    endpoint: null,
    rfc2217Url: null,
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
 * Commands reach it at the endpoint: from Connecting or Waiting, or at a new endpoint; `name` is
 * what it reports once connected, when it reports one only then; `rfc2217Url` a serial board's
 * RFC 2217 address beside its path, as its helper's READY says it. A new helper's READY is a new
 * connection, so the round trip and the notice start again; the baud rate stays, as the board
 * keeps it.
 */
export function deviceConnected(
  device: ConnectedDevice,
  endpoint: string,
  name: string = device.name,
  rfc2217Url: string | null = null,
): ConnectedDeviceChange {
  if (!isOpen(device)) return undefined;
  if (
    device.state === "connected" &&
    device.endpoint === endpoint &&
    device.rfc2217Url === rfc2217Url &&
    device.name === name &&
    device.roundTripMs === null &&
    device.notice === null
  ) {
    return undefined;
  }
  return withChange({
    ...device,
    state: "connected",
    everConnected: true,
    endpoint,
    rfc2217Url,
    name,
    roundTripMs: null,
    notice: null,
  });
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

/**
 * The run environment isn't running: from Connecting or Connected. A phone over wireless debugging
 * keeps its `<address>:<port>`, which its next start connects to again. A run's hold never waits,
 * as the run starts its environment first: nothing for one.
 */
export function deviceWaiting(device: ConnectedDevice): ConnectedDeviceChange {
  if (device.runHolder !== null) return undefined;
  if (device.state !== "connecting" && device.state !== "connected") return undefined;
  const endpoint = device.kind === "android-wireless" ? device.endpoint : null;
  return withChange({
    ...device,
    state: "waiting-for-run-environment",
    endpoint,
    rfc2217Url: null,
  });
}

/**
 * A phone over wireless debugging that adb paired and connected to at `endpoint`, `<address>:<port>`,
 * with the model it reports: Connected there while its run environment runs; Waiting to connect
 * there at its next start when it stopped meanwhile.
 */
export function phonePaired(
  device: ConnectedDevice,
  endpoint: string,
  name: string,
  environmentRunning: boolean,
): ConnectedDeviceChange {
  if (device.state === "connecting" && environmentRunning) {
    return deviceConnected(device, endpoint, name);
  }
  if (device.state !== "connecting" && device.state !== "waiting-for-run-environment") {
    return undefined;
  }
  return withChange({ ...device, state: "waiting-for-run-environment", endpoint, name });
}

export interface Disconnection {
  readonly because: DisconnectedBecause;
  /** Who, for `by-user`. */
  readonly by?: DeviceUser;
  /** The error, for `error`; what to do, for `device-unplugged`. */
  readonly problem?: string;
  readonly at: Date;
}

/** The reasons a Disconnected device keeps words for. */
const KEEPS_PROBLEM: ReadonlySet<DisconnectedBecause> = new Set(["error", "device-unplugged"]);

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
    problem: KEEPS_PROBLEM.has(disconnection.because) ? (disconnection.problem ?? null) : null,
    endpoint: null,
    rfc2217Url: null,
    disconnectedAt: disconnection.at,
  });
}

/**
 * `OFFICE_CONNECTED_DEVICES` (spec §2.13, "What Agents see"): the Connected ones only, as a JSON
 * array of `{ id, kind, name, endpoint, rfc2217Url }`, `rfc2217Url` null but for a serial board;
 * `[]` with none.
 */
export function connectedDevicesVariable(devices: readonly ConnectedDevice[]): string {
  return JSON.stringify(
    devices
      .filter((device) => device.state === "connected")
      .map(({ id, kind, name, endpoint, rfc2217Url }) => ({
        id,
        kind,
        name,
        endpoint,
        rfc2217Url,
      })),
  );
}

/** The kinds adb reaches, each by its adb serial. */
export const ANDROID_KINDS: ReadonlySet<ConnectedDeviceKind> = new Set([
  "android-usb",
  "android-wireless",
]);

/**
 * The adb serial `adb devices` lists a Connected Android phone under: the helper's endpoint for an
 * Android phone over USB, as adb connects to it, and the phone's `<address>:<port>` over wireless
 * debugging; undefined for any other device.
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

/** Said when a run's phone over wireless debugging doesn't answer at its address and Port. */
export function didntAnswer(device: Pick<ConnectedDevice, "name">): string {
  return `${device.name} didn't answer.`;
}

/** Said when the tab that starts a run can't find or open its device over USB. */
export function notPluggedIn(device: Pick<ConnectedDevice, "name">): string {
  return `${device.name} isn't plugged into this computer, or the browser can't open it.`;
}

/** Said when the tab relaying a run's device over USB closed. */
export function relayTabClosed(device: Pick<ConnectedDevice, "name">): string {
  return `The tab relaying ${device.name} was closed.`;
}

/** Said when a run let go of its device before it connected. */
export function letGoBeforeConnecting(device: Pick<ConnectedDevice, "name">): string {
  return `The run let go of ${device.name} before it connected.`;
}

/** Said when a run's environment isn't running as its device connects. */
export const RUN_ENVIRONMENT_NOT_RUNNING = "The run's environment isn't running.";

/** Said when the Project's Connected devices were switched off under a run's hold. */
export const CONNECTED_DEVICES_SWITCHED_OFF = "The Project's Connected devices were switched off.";

/** Why a run's hold ended before it was held, in 2.13's words, from its Disconnected record. */
export function holdProblemOf(device: ConnectedDevice): string {
  switch (device.disconnectedBecause) {
    case "device-unplugged":
      return device.kind === "android-wireless" ? didntAnswer(device) : notPluggedIn(device);
    case "tab-closed":
      return relayTabClosed(device);
    case "run-environment-turned-off":
      return RUN_ENVIRONMENT_OFF;
    case "connected-devices-switched-off":
      return CONNECTED_DEVICES_SWITCHED_OFF;
    case "by-user":
      return `${device.disconnectedBy?.name ?? "A user"} disconnected ${device.name}.`;
    case "error":
      return device.problem ?? `${device.name} couldn't be connected.`;
    default:
      return letGoBeforeConnecting(device);
  }
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
  "port-busy":
    "the board is busy, as one tool at a time can have it open, at its path or its rfc2217:// port",
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
  return new ConnectedDeviceChanged(
    device.taskId,
    device.id,
    device.projectDeviceId,
    device.state,
    device.runHolder,
    device.relayTab,
  );
}
