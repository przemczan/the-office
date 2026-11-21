import { describe, expect, it } from "vitest";
import {
  controlFrame,
  controlPayload,
  deviceNoticeFrameSchema,
  serialSettingsFrameSchema,
  serialSettingsSchema,
  serialSignalsFrameSchema,
  serialSignalsSchema,
} from "./device-control.js";
import {
  DEVICE_CONTROL_CHANNEL,
  DEVICE_FRAME_TYPES,
  encodeFrame,
  FrameReader,
  readyEndpoints,
  textFrame,
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

  it("read the helper's stamps on SETTINGS and SIGNALS, in microseconds", () => {
    const signals = {
      type: DEVICE_FRAME_TYPES.signals,
      channel: DEVICE_CONTROL_CHANNEL,
      payload: new TextEncoder().encode(
        '{"dataTerminalReady":true,"requestToSend":false,"at":1250000}',
      ),
    };

    expect(controlPayload(signals, serialSignalsFrameSchema)).toEqual({
      dataTerminalReady: true,
      requestToSend: false,
      at: 1_250_000,
    });
    expect(
      controlPayload(
        controlFrame(DEVICE_FRAME_TYPES.settings, settings),
        serialSettingsFrameSchema,
      ),
    ).toBeUndefined();
    expect(
      controlPayload(
        controlFrame(DEVICE_FRAME_TYPES.settings, { ...settings, at: -1 }),
        serialSettingsFrameSchema,
      ),
    ).toBeUndefined();
  });

  it("read the port-busy notice", () => {
    expect(
      controlPayload(
        controlFrame(DEVICE_FRAME_TYPES.notice, { code: "port-busy" }),
        deviceNoticeFrameSchema,
      ),
    ).toEqual({ code: "port-busy" });
  });
});

describe("readyEndpoints", () => {
  it("reads a relayed device's endpoint alone", () => {
    expect(readyEndpoints(textFrame(DEVICE_FRAME_TYPES.ready, "127.0.0.1:41234"))).toEqual({
      endpoint: "127.0.0.1:41234",
      rfc2217Url: null,
    });
  });

  it("reads a serial board's path and its RFC 2217 address", () => {
    const ready = textFrame(DEVICE_FRAME_TYPES.ready, "/dev/ttyACM1\nrfc2217://127.0.0.1:2218");

    expect(readyEndpoints(ready)).toEqual({
      endpoint: "/dev/ttyACM1",
      rfc2217Url: "rfc2217://127.0.0.1:2218",
    });
  });

  it("leaves out a second line that isn't a loopback rfc2217:// address", () => {
    const ready = textFrame(DEVICE_FRAME_TYPES.ready, "/dev/ttyACM0\nrfc2217://0.0.0.0:2217");

    expect(readyEndpoints(ready)).toEqual({ endpoint: "/dev/ttyACM0", rfc2217Url: null });
  });
});
