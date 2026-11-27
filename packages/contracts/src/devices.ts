import { z } from "zod";
import { API_PATH } from "./api.js";
import { helperNoticeCodeSchema } from "./device-control.js";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";
import { userRefSchema } from "./users.js";

/** A Connected device's kinds (spec 2.13, "Connected device"). */
export const connectedDeviceKindSchema = z.enum(["android-usb", "serial-usb", "android-wireless"]);
export type ConnectedDeviceKind = z.infer<typeof connectedDeviceKindSchema>;

/** A Connected device's states (spec 2.13, "States"). */
export const connectedDeviceStateSchema = z.enum([
  "connecting",
  "connected",
  "waiting-for-run-environment",
  "disconnected",
]);
export type ConnectedDeviceState = z.infer<typeof connectedDeviceStateSchema>;

/** Why a Connected device is Disconnected (spec 2.13, "States"). */
export const disconnectedBecauseSchema = z.enum([
  "by-user",
  "tab-closed",
  "task-ended",
  "device-unplugged",
  "run-environment-turned-off",
  "connected-devices-switched-off",
  "error",
  /** The Action run or test instance that held a Project device let go of it as it ended. */
  "run-ended",
]);
export type DisconnectedBecause = z.infer<typeof disconnectedBecauseSchema>;

/**
 * What the Devices section says in words about a device (spec 2.13, "Serial boards"): the
 * helper's notices, and `slow-round-trip` while the round trip is over `SLOW_ROUND_TRIP_MS`.
 */
export const deviceNoticeSchema = z.enum(["slow-round-trip", ...helperNoticeCodeSchema.options]);
export type DeviceNotice = z.infer<typeof deviceNoticeSchema>;

/** A round trip over this slows uploads enough to say so. */
export const SLOW_ROUND_TRIP_MS = 250;
/** How often the helper pings the browser to measure the round trip. */
export const DEVICE_PING_INTERVAL_MS = 5_000;

/** The longest name a device may report; a longer one is cut. */
export const CONNECTED_DEVICE_NAME_MAX_LENGTH = 200;
/** The longest device key the browser may report. */
export const DEVICE_KEY_MAX_LENGTH = 500;
/** The longest error in words the browser may report about its device. */
export const DEVICE_RELAY_PROBLEM_MAX_LENGTH = 500;

/**
 * The id a tab gives itself as it starts a run that may hold a Project device over USB (spec 2.13,
 * "A Project device over USB"): the run's Connecting record names it, and that tab alone opens the
 * device and relays it until the run lets go.
 */
export const relayTabSchema = z.uuid();
export type RelayTab = z.infer<typeof relayTabSchema>;

/**
 * One device connected, or once connected, to one Task's run environment, or held by an Action run
 * or a test instance in its own.
 */
export const connectedDeviceSchema = z.object({
  id: z.uuid(),
  /** The Task it is connected to; null for an Action run's or a test instance's hold. */
  taskId: z.string().nullable(),
  /** The Project device it was lent from (spec 2.13, "Lent to a Task"); null for one the Task connected itself. */
  projectDeviceId: z.uuid().nullable(),
  kind: connectedDeviceKindSchema,
  /** Its name, as the device reports it. */
  name: z.string(),
  state: connectedDeviceStateSchema,
  /** Null unless Disconnected. */
  disconnectedBecause: disconnectedBecauseSchema.nullable(),
  /** Who disconnected it, when `by-user`; null otherwise. */
  disconnectedBy: userRefSchema.nullable(),
  /** The error in words, when `error`, or what to do, when `device-unplugged`; null otherwise. */
  problem: z.string().nullable(),
  /**
   * While Connected, where commands reach it: where the relayed bytes come out inside the run
   * environment (`127.0.0.1:<port>`), a serial board's path (`/dev/ttyACM0`), or a phone over
   * wireless debugging's `<address>:<port>`, which it keeps while Waiting too; null otherwise.
   */
  endpoint: z.string().nullable(),
  /**
   * While Connected, a serial board's RFC 2217 address in the run environment
   * (`rfc2217://127.0.0.1:<port>`), where esptool, pyserial and PlatformIO also set its baud, DTR
   * and RTS; null for every other kind and otherwise.
   */
  rfc2217Url: z.string().nullable(),
  /** A serial board's baud rate, as the Project's tool last set it; null until it reports one. */
  baudRate: z.number().int().positive().nullable(),
  /** The last round trip measured between the helper and the browser, in ms; null until measured. */
  roundTripMs: z.number().int().nonnegative().nullable(),
  /** What the Devices section says about it, in this order. */
  notices: z.array(deviceNoticeSchema),
  /** Who connected it; for a lend by a person, `person` is their Role's key and the user the one who asked. */
  connectedBy: userRefSchema.extend({ person: z.string().optional() }),
  connectedAt: z.iso.datetime(),
  /** Null until Disconnected. */
  disconnectedAt: z.iso.datetime().nullable(),
});
export type ConnectedDevice = z.infer<typeof connectedDeviceSchema>;

/** GET /tasks/:taskId/devices: the Task's devices, the newest connected first, Disconnected ones kept as history. */
export const connectedDeviceListSchema = z.object({ devices: z.array(connectedDeviceSchema) });
export type ConnectedDeviceList = z.infer<typeof connectedDeviceListSchema>;

/**
 * POST /tasks/:taskId/devices: connect a device the browser reached. The device key is opaque:
 * each kind's Task defines it (USB vendor, product and serial number; the phone's address), and
 * the service never reads into it. It answers the new record, Connecting, whose relay the browser
 * then opens.
 */
export const connectDeviceSchema = z.object({
  kind: connectedDeviceKindSchema,
  name: z.string().trim().min(1).max(CONNECTED_DEVICE_NAME_MAX_LENGTH),
  deviceKey: z.string().min(1).max(DEVICE_KEY_MAX_LENGTH),
});
export type ConnectDevice = z.infer<typeof connectDeviceSchema>;

/** A TCP port on the phone. */
const phonePortSchema = z.number().int().min(1).max(65_535);

/**
 * POST /tasks/:taskId/devices/wireless: pair an Android phone over wireless debugging (spec 2.13).
 * `address` is an IPv4 or IPv6 literal; the service refuses loopback, unspecified, multicast and
 * link-local ones in words. `port` is the connect port on the phone's Wireless debugging screen,
 * `pairingPort` and `pairingCode` those of its "Pair device with pairing code". It answers the
 * new record, Connecting. The code goes to adb's standard input only: no response, event or
 * record carries it.
 */
export const pairWirelessDeviceSchema = z.object({
  address: z.union([z.ipv4(), z.ipv6()]),
  port: phonePortSchema,
  pairingPort: phonePortSchema,
  pairingCode: z.string().regex(/^\d{6}$/, "The pairing code is 6 digits."),
});
export type PairWirelessDevice = z.infer<typeof pairWirelessDeviceSchema>;

/**
 * A refused connect or pairing: 409 when the device is already connected to another Task, naming
 * it in `otherTask`; 422 otherwise (the Run environment Off, the Task Done or Dropped, an address
 * the run environment can't reach, no helper built). Every reason is also joined into Nest's
 * `message`.
 */
export const connectDeviceRefusalSchema = z.object({
  statusCode: z.union([z.literal(409), z.literal(422)]),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
  otherTask: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type ConnectDeviceRefusal = z.infer<typeof connectDeviceRefusalSchema>;

/** The longest name the user gives a Project device. */
export const PROJECT_DEVICE_NAME_MAX_LENGTH = 60;

/**
 * A Project device's state (spec 2.13, "At rest and in use"): at rest `paired`, `didnt-answer`,
 * `not-paired` or `over-usb`; `in-use` while a Connected device record not Disconnected names it.
 */
export const projectDeviceStateSchema = z.enum([
  "paired",
  "didnt-answer",
  "not-paired",
  "over-usb",
  "in-use",
]);
export type ProjectDeviceState = z.infer<typeof projectDeviceStateSchema>;

/** The states a Project device keeps at rest; `in-use` is worked out, never kept. */
export const projectDeviceRestStateSchema = projectDeviceStateSchema.exclude(["in-use"]);
export type ProjectDeviceRestState = z.infer<typeof projectDeviceRestStateSchema>;

/**
 * What holds a Project device, or last held it: a Task it is lent to, an Action run or a test
 * instance, each with its name as "<device> is in use by <name>." says it.
 */
export const projectDeviceHolderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), taskId: z.string(), title: z.string() }),
  z.object({ kind: z.literal("action-run"), actionRunId: z.uuid(), name: z.string() }),
  z.object({ kind: z.literal("test-instance"), testInstanceId: z.uuid(), name: z.string() }),
]);
export type ProjectDeviceHolder = z.infer<typeof projectDeviceHolderSchema>;

/** A Project device's last use: who held it, when it was let go of, and why. */
export const projectDeviceLastUseSchema = z.object({
  holder: projectDeviceHolderSchema,
  endedAt: z.iso.datetime(),
  endedBecause: disconnectedBecauseSchema,
});
export type ProjectDeviceLastUse = z.infer<typeof projectDeviceLastUseSchema>;

/** A pairing's steps as they pass, which the pairing window shows. */
export const projectDevicePairingStepSchema = z.enum([
  "starting-environment",
  "pairing",
  "reading-model",
]);
export type ProjectDevicePairingStep = z.infer<typeof projectDevicePairingStepSchema>;

/** A device kept for a Project between uses (spec 2.13, "A Project's device"). */
export const projectDeviceSchema = z.object({
  id: z.uuid(),
  projectId: z.string(),
  kind: connectedDeviceKindSchema,
  /**
   * Its device key, as the browser or the pairing made it, so a tab lending one over USB opens the
   * device this browser allowed before without its picker.
   */
  deviceKey: z.string(),
  /** The user's name for it, first the model or the name the browser reports. */
  name: z.string(),
  /** A phone over wireless debugging's IP address and Port; null for a device over USB. */
  address: z.string().nullable(),
  port: z.number().int().positive().nullable(),
  state: projectDeviceStateSchema,
  /** While `in-use`, what holds it; null otherwise. */
  inUseBy: projectDeviceHolderSchema.nullable(),
  /** While a pairing runs, the step it is at; null otherwise. */
  pairingStep: projectDevicePairingStepSchema.nullable(),
  /** Why the last pairing failed, in the service's or adb's words; null once paired. */
  pairingProblem: z.string().nullable(),
  addedBy: userRefSchema,
  addedAt: z.iso.datetime(),
  lastUse: projectDeviceLastUseSchema.nullable(),
});
export type ProjectDevice = z.infer<typeof projectDeviceSchema>;

/** GET /projects/:id/devices: the Project's devices in the order added. */
export const projectDeviceListSchema = z.object({ devices: z.array(projectDeviceSchema) });
export type ProjectDeviceList = z.infer<typeof projectDeviceListSchema>;

/**
 * POST /projects/:id/devices: add a device over USB the browser reached, by its device key, or a
 * phone over wireless debugging, which is added Not paired and paired at once in a pairing
 * environment. It answers the new Project device.
 */
export const addProjectDeviceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["android-usb", "serial-usb"]),
    name: z.string().trim().min(1).max(CONNECTED_DEVICE_NAME_MAX_LENGTH),
    deviceKey: z.string().min(1).max(DEVICE_KEY_MAX_LENGTH),
  }),
  pairWirelessDeviceSchema.extend({ kind: z.literal("android-wireless") }),
]);
export type AddProjectDevice = z.infer<typeof addProjectDeviceSchema>;

/** PATCH /project-devices/:id: rename it, or give a phone over wireless debugging a new Port. */
export const changeProjectDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(PROJECT_DEVICE_NAME_MAX_LENGTH).optional(),
    port: phonePortSchema.optional(),
  })
  .refine((change) => change.name !== undefined || change.port !== undefined, {
    message: "Give a name or a Port.",
  });
export type ChangeProjectDevice = z.infer<typeof changeProjectDeviceSchema>;

/**
 * POST /project-devices/:id/pair: pair a phone over wireless debugging again, its address and
 * Port as the user gives them. It answers the device, its pairing started.
 */
export const pairProjectDeviceSchema = pairWirelessDeviceSchema;
export type PairProjectDevice = PairWirelessDevice;

/** POST /tasks/:id/devices/lend: Use a Project device; it answers the new Connected device record. */
export const lendProjectDeviceSchema = z.object({ projectDeviceId: z.uuid() });
export type LendProjectDevice = z.infer<typeof lendProjectDeviceSchema>;

/**
 * A refused change to a Project device or a lend: 409 when another environment holds it, naming
 * the holder in `holder`; 422 otherwise (Run environment not On, Connected devices switched off,
 * an address the run environment can't reach, a device already among the Project's). Every reason
 * is also joined into Nest's `message`.
 */
export const projectDeviceRefusalSchema = z.object({
  statusCode: z.union([z.literal(409), z.literal(422)]),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
  holder: projectDeviceHolderSchema.nullable(),
});
export type ProjectDeviceRefusal = z.infer<typeof projectDeviceRefusalSchema>;

/** GET and POST under a Project. */
export function projectDevicesPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/devices`;
}

/** PATCH and DELETE one Project device. */
export function projectDevicePath(projectDeviceId: string): string {
  return `/project-devices/${encodeURIComponent(projectDeviceId)}`;
}

/** POST: pair a Project device again. */
export function projectDevicePairPath(projectDeviceId: string): string {
  return `${projectDevicePath(projectDeviceId)}/pair`;
}

/** POST under a Task: Use a Project device. */
export function taskLendDevicePath(taskId: string): string {
  return `${taskDevicesPath(taskId)}/lend`;
}

/** GET and POST under a Task. */
export function taskDevicesPath(taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}/devices`;
}

/** POST under a Task: pair an Android phone over wireless debugging. */
export function taskWirelessDevicesPath(taskId: string): string {
  return `${taskDevicesPath(taskId)}/wireless`;
}

/** POST /devices/:id/disconnect: Disconnect, by the signed-in user; answers the record. */
export function disconnectDevicePath(deviceId: string): string {
  return `/devices/${encodeURIComponent(deviceId)}/disconnect`;
}

/** The pattern the service registers its relay socket under. */
export const DEVICE_RELAY_PATH_PATTERN = `${API_PATH}/devices/:id/relay`;

/**
 * The signed-in WebSocket that carries one device's bytes: binary messages are device frames
 * (`device-frames.ts`), the browser sending only OPEN, DATA and CLOSE; text messages are the
 * control messages below. One socket per device: a second is closed with
 * `DEVICE_RELAY_TAKEN_CLOSE_CODE`.
 */
export function deviceRelayPath(deviceId: string): string {
  return `${API_PATH}/devices/${encodeURIComponent(deviceId)}/relay`;
}

/** The close code of a second relay socket for a device that has one. */
export const DEVICE_RELAY_TAKEN_CLOSE_CODE = 4409;
/** The close code of a relay socket for a device that isn't there or is Disconnected. */
export const DEVICE_RELAY_ENDED_CLOSE_CODE = 4410;

/**
 * Browser → service: the device went away (unplugged), so it ends as device unplugged; or the
 * browser can't reach it any more (`error`), so it ends as error with the problem in words.
 */
export const deviceRelayClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unplugged") }),
  z.object({
    type: z.literal("error"),
    problem: z.string().min(1).max(DEVICE_RELAY_PROBLEM_MAX_LENGTH),
  }),
]);
export type DeviceRelayClientMessage = z.infer<typeof deviceRelayClientMessageSchema>;

/** Service → browser: the device's state changed. */
export const deviceRelayServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("state"),
    state: connectedDeviceStateSchema,
    endpoint: z.string().nullable(),
  }),
]);
export type DeviceRelayServerMessage = z.infer<typeof deviceRelayServerMessageSchema>;

/**
 * A Connected device changed (connected, its state, disconnected): a Task's, so its Devices section
 * reads them again, or a run's hold, so the tab named by `relayTab` opens the device's relay while
 * it is Connecting and lets go of it once Disconnected.
 */
export const connectedDeviceWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({
    type: z.literal("connected-device.changed"),
    /** Null for a run's hold. */
    taskId: z.string().nullable(),
    deviceId: z.uuid(),
    /** The tab that relays a run's device over USB; null otherwise. */
    relayTab: relayTabSchema.nullable(),
    /** The Project device it came from; null for one a Task connected itself. */
    projectDeviceId: z.uuid().nullable(),
    state: connectedDeviceStateSchema,
  }),
]);
export type ConnectedDeviceWebEvent = z.infer<typeof connectedDeviceWebEventSchema>;

/** A Project's devices changed (added, renamed, paired, lent, let go of, removed), so its Devices section reads them again. */
export const projectDeviceWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({
    type: z.literal("project-device.changed"),
    projectId: z.string(),
  }),
]);
export type ProjectDeviceWebEvent = z.infer<typeof projectDeviceWebEventSchema>;

/** Office action: lend a Project device to a Task. */
export const LEND_PROJECT_DEVICE_ACTION = officeAction({
  name: "lend_project_device",
  title: "Lend a Project device to a Task",
  description:
    "Lends one of the Project's devices to a Task, so its run environment reaches it (Use a Project device on the Task page), and answers the Connected device. Refused while the device is pairing or held by another environment, which it names, and unless the Project's Run environment is On and Connected devices are switched on. A device over USB is relayed by the user's browser: the user lends it from the Task page.",
  input: z.object({
    taskId: z.uuid().describe("The id of the Task the device is lent to."),
    ...lendProjectDeviceSchema.shape,
  }),
  answer: connectedDeviceSchema,
  route: { method: "POST", path: "/tasks/:taskId/devices/lend" },
  status: 201,
  area: "testInstancesAndDevices",
  group: "projectDevices",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Project devices' Office actions, each declared above. */
export const DEVICE_OFFICE_ACTIONS = [LEND_PROJECT_DEVICE_ACTION] as const;
