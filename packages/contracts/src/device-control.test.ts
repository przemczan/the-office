import { describe, expect, it } from "vitest";
import {
  controlFrame,
  controlPayload,
  deviceNoticeFrameSchema,
  serialSettingsSchema,
  serialSignalsSchema,
} from "./device-control.js";
import {
  DEVICE_CONTROL_CHANNEL,
  DEVICE_FRAME_TYPES,
  encodeFrame,
  FrameReader,
} from "./device-frames.js";

const settings = { baudRate: 115200, dataBits: 8, parity: "none", stopBits: 1 } as const;

describe("control frames", () => {
  it("carry their JSON on channel 0 through the frame codec", () => {
    const frame = controlFrame(DEVICE_FRAME_TYPES.settings, settings);
    const [read] = new FrameReader().push(encodeFrame(frame));

    expect(read?.channel).toBe(DEVICE_CONTROL_CHANNEL);
    expect(read && controlPayload(read, serialSettingsSchema)).toEqual(settings);
  });

  it("read the helper's JSON as it writes it", () => {
    const frame = {
      type: DEVICE_FRAME_TYPES.signals,
      channel: DEVICE_CONTROL_CHANNEL,
      payload: new TextEncoder().encode('{"dataTerminalReady":false,"requestToSend":true}'),
    };

    expect(controlPayload(frame, serialSignalsSchema)).toEqual({
      dataTerminalReady: false,
      requestToSend: true,
    });
  });

  it("answer undefined for a payload that isn't JSON or doesn't match", () => {
    const notJson = {
      ...controlFrame(DEVICE_FRAME_TYPES.notice, {}),
      payload: Uint8Array.of(0x7b),
    };

    expect(controlPayload(notJson, deviceNoticeFrameSchema)).toBeUndefined();
    expect(
      controlPayload(
        controlFrame(DEVICE_FRAME_TYPES.notice, { code: "nope" }),
        deviceNoticeFrameSchema,
      ),
    ).toBeUndefined();
  });
});
