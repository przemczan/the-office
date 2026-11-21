import { describe, expect, it } from "vitest";
import {
  DEVICE_FRAME_HEADER_BYTES,
  DEVICE_FRAME_MAX_PAYLOAD_BYTES,
  DEVICE_FRAME_TYPES,
  DeviceFrameRefused,
  encodeFrame,
  frameText,
  FrameReader,
  textFrame,
} from "./device-frames.js";

const data = (channel: number, bytes: number[]) => ({
  type: DEVICE_FRAME_TYPES.data,
  channel,
  payload: Uint8Array.from(bytes),
});

describe("encodeFrame", () => {
  it("writes type, channel and length big-endian before the payload", () => {
    expect([...encodeFrame(data(0x01020304, [9, 8]))]).toEqual([4, 1, 2, 3, 4, 0, 0, 0, 2, 9, 8]);
  });

  it("refuses a payload over the maximum", () => {
    const payload = new Uint8Array(DEVICE_FRAME_MAX_PAYLOAD_BYTES + 1);
    expect(() => encodeFrame({ type: DEVICE_FRAME_TYPES.data, channel: 1, payload })).toThrow(
      DeviceFrameRefused,
    );
  });

  it("refuses a channel that isn't a u32", () => {
    expect(() => encodeFrame(data(-1, []))).toThrow(DeviceFrameRefused);
    expect(() => encodeFrame(data(2 ** 32, []))).toThrow(DeviceFrameRefused);
  });
});

describe("FrameReader", () => {
  it("reads a frame split across chunks", () => {
    const bytes = encodeFrame(data(7, [1, 2, 3, 4, 5]));
    const reader = new FrameReader();
    expect(reader.push(bytes.slice(0, 3))).toEqual([]);
    expect(reader.push(bytes.slice(3, 11))).toEqual([]);
    expect(reader.push(bytes.slice(11))).toEqual([data(7, [1, 2, 3, 4, 5])]);
    expect(reader.pendingBytes).toBe(0);
  });

  it("reads several frames merged in one chunk, keeping a partial one for later", () => {
    const hello = textFrame(DEVICE_FRAME_TYPES.hello, "1.2.3");
    const first = encodeFrame(hello);
    const second = encodeFrame(data(1, [42]));
    const third = encodeFrame({
      type: DEVICE_FRAME_TYPES.close,
      channel: 1,
      payload: new Uint8Array(),
    });
    const merged = new Uint8Array([...first, ...second, ...third.slice(0, 4)]);
    const reader = new FrameReader();

    const frames = reader.push(merged);

    expect(frames).toHaveLength(2);
    expect(frameText(frames[0]!)).toBe("1.2.3");
    expect(frames[1]).toEqual(data(1, [42]));
    expect(reader.pendingBytes).toBe(4);
    expect(reader.push(third.slice(4))).toEqual([
      { type: DEVICE_FRAME_TYPES.close, channel: 1, payload: new Uint8Array() },
    ]);
  });

  it("refuses a header announcing a payload over the maximum before it arrives", () => {
    const header = new Uint8Array(DEVICE_FRAME_HEADER_BYTES);
    const view = new DataView(header.buffer);
    view.setUint8(0, DEVICE_FRAME_TYPES.data);
    view.setUint32(5, DEVICE_FRAME_MAX_PAYLOAD_BYTES + 1);
    expect(() => new FrameReader().push(header)).toThrow(DeviceFrameRefused);
  });

  it("refuses an unknown frame type", () => {
    const header = new Uint8Array(DEVICE_FRAME_HEADER_BYTES);
    header[0] = 99;
    expect(() => new FrameReader().push(header)).toThrow(DeviceFrameRefused);
  });
});
