import { z } from "zod";
import { API_PATH } from "./api.js";
import { helperNoticeCodeSchema } from "./device-control.js";
import { webEventSchema } from "./events.js";
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
  "error",
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

/** One device connected, or once connected, to one Task's run environment. */
export const connectedDeviceSchema = z.object({
  id: z.uuid(),
  taskId: z.string(),
  kind: connectedDeviceKindSchema,
  /** Its name, as the device reports it. */
  name: z.string(),
  state: connectedDeviceStateSchema,
  /** Null unless Disconnected. */
  disconnectedBecause: disconnectedBecauseSchema.nullable(),
  /** Who disconnected it, when `by-user`; null otherwise. */
  disconnectedBy: userRefSchema.nullable(),
  /** The error in words, when `error`; null otherwise. */
  problem: z.string().nullable(),
  /** Where the relayed bytes come out inside the run environment while Connected: `127.0.0.1:<port>`, or a serial board's path (`/dev/ttyACM0`); null otherwise. */
  endpoint: z.string().nullable(),
  /** A serial board's baud rate, as the Project's tool last set it; null until it reports one. */
  baudRate: z.number().int().positive().nullable(),
  /** The last round trip measured between the helper and the browser, in ms; null until measured. */
  roundTripMs: z.number().int().nonnegative().nullable(),
  /** What the Devices section says about it, in this order. */
  notices: z.array(deviceNoticeSchema),
  connectedBy: userRefSchema,
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

/**
 * A refused connect: 409 when the device is already connected to another Task, naming it in
 * `otherTask`; 422 otherwise (the Run environment Off, the Task Done or Dropped, a kind with no
 * relay yet, no helper built). Every reason is also joined into Nest's `message`.
 */
export const connectDeviceRefusalSchema = z.object({
  statusCode: z.union([z.literal(409), z.literal(422)]),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
  otherTask: z.object({ id: z.string(), title: z.string() }).nullable(),
});
export type ConnectDeviceRefusal = z.infer<typeof connectDeviceRefusalSchema>;

/** GET and POST under a Task. */
export function taskDevicesPath(taskId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}/devices`;
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

/** A Task's Connected device changed (connected, its state, disconnected), so its Devices section reads them again. */
export const connectedDeviceWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({
    type: z.literal("connected-device.changed"),
    taskId: z.string(),
    deviceId: z.uuid(),
  }),
]);
export type ConnectedDeviceWebEvent = z.infer<typeof connectedDeviceWebEventSchema>;
