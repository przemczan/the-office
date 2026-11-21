// The JSON payloads of the device frames on channel 0 that aren't the helper's own (spec 2.13,
// "Serial boards"): SETTINGS, SIGNALS, PING, PONG and NOTICE. tools/device-helper/pty.go writes
// the same JSON; change both together.
import { z } from "zod";
import {
  DEVICE_CONTROL_CHANNEL,
  DEVICE_FRAME_TYPES,
  type DeviceFrame,
  type DeviceFrameType,
} from "./device-frames.js";

/** SETTINGS: the line settings the Project's tool set on the serial port in the run environment. */
export const serialSettingsSchema = z.object({
  baudRate: z.number().int().positive(),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  parity: z.enum(["none", "even", "odd"]),
  stopBits: z.union([z.literal(1), z.literal(2)]),
});
export type SerialSettings = z.infer<typeof serialSettingsSchema>;

/** SIGNALS: the modem lines to set on the board, as a real port's open and close set them. */
export const serialSignalsSchema = z.object({
  dataTerminalReady: z.boolean(),
  requestToSend: z.boolean(),
});
export type SerialSignals = z.infer<typeof serialSignalsSchema>;

/** PING and PONG: the browser answers each PING with a PONG of the same id. */
export const devicePingSchema = z.object({ id: z.number().int().nonnegative() });
export type DevicePing = z.infer<typeof devicePingSchema>;

/** What the helper notices about a serial board, each said in words in the Devices section. */
export const helperNoticeCodeSchema = z.enum([
  "no-answer-after-reset",
  "touch-1200",
  "esptool-sync-no-answer",
  "no-upload-tool",
]);
export type HelperNoticeCode = z.infer<typeof helperNoticeCodeSchema>;

/** NOTICE: one thing the helper noticed. */
export const deviceNoticeFrameSchema = z.object({ code: helperNoticeCodeSchema });
export type DeviceNoticeFrame = z.infer<typeof deviceNoticeFrameSchema>;

/** A control frame of a JSON payload on channel 0. */
export function controlFrame(type: DeviceFrameType, value: unknown): DeviceFrame {
  return {
    type,
    channel: DEVICE_CONTROL_CHANNEL,
    payload: new TextEncoder().encode(JSON.stringify(value)),
  };
}

/** A control frame's payload read by `schema`; undefined when it isn't JSON or doesn't match. */
export function controlPayload<T>(frame: DeviceFrame, schema: z.ZodType<T>): T | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(frame.payload));
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** The frame types that carry a serial port's control toward the browser, in order with DATA. */
export const BROWSER_CONTROL_FRAME_TYPES: ReadonlySet<DeviceFrameType> = new Set([
  DEVICE_FRAME_TYPES.settings,
  DEVICE_FRAME_TYPES.signals,
  DEVICE_FRAME_TYPES.ping,
]);
