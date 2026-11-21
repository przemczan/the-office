// The frames the Office device helper speaks on its standard input and output (spec 2.13, "The
// relay"). tools/device-helper/frames.go mirrors this layout; change both together.
//
// A frame is `u8 type | u32 channel | u32 length | payload`, big-endian. Channel 0 carries the
// helper's own frames (HELLO, READY, ENDED) and the control frames (SETTINGS, SIGNALS, PING, PONG,
// NOTICE, whose JSON payloads `device-control.ts` defines); each relayed connection gets a channel
// from 1 up. Frames travel in order on one stream, so a SETTINGS reaches the browser before the
// DATA written after it.

export const DEVICE_FRAME_TYPES = {
  /** Helper → service, first frame: the helper's version, UTF-8. */
  hello: 1,
  /**
   * Helper → service: the endpoint it listens on, UTF-8 (`127.0.0.1:<port>`, or a serial board's
   * path), and for a serial board a second line with its RFC 2217 address (`readyEndpoints`).
   */
  ready: 2,
  /** Helper → service: a connection was accepted on the frame's channel. */
  open: 3,
  /** Either way: bytes on the frame's channel. */
  data: 4,
  /** Either way: the frame's channel is closed. */
  close: 5,
  /** Helper → service, last frame: why it ends, UTF-8. */
  ended: 6,
  /** Helper → browser, channel 0: a serial port's new line settings, JSON (`device-control.ts`). */
  settings: 7,
  /** Helper → browser, channel 0: a serial port's DTR and RTS to set, JSON. */
  signals: 8,
  /** Helper → browser, channel 0: answer with PONG and the same id, JSON. */
  ping: 9,
  /** Browser → service, channel 0: the answer to a PING, JSON; the service measures the round trip. */
  pong: 10,
  /** Helper → service, channel 0: something the Devices section says in words, JSON. */
  notice: 11,
} as const;

export type DeviceFrameType = (typeof DEVICE_FRAME_TYPES)[keyof typeof DEVICE_FRAME_TYPES];

export const DEVICE_FRAME_HEADER_BYTES = 9;
/** The largest payload a frame may carry; a larger one is refused on both sides. */
export const DEVICE_FRAME_MAX_PAYLOAD_BYTES = 1024 * 1024;
/** The channel of the helper's own frames. */
export const DEVICE_CONTROL_CHANNEL = 0;
const MAX_CHANNEL = 0xffff_ffff;

export interface DeviceFrame {
  readonly type: DeviceFrameType;
  readonly channel: number;
  readonly payload: Uint8Array;
}

export class DeviceFrameRefused extends Error {}

const FRAME_TYPE_VALUES = new Set<number>(Object.values(DEVICE_FRAME_TYPES));

function isFrameType(value: number): value is DeviceFrameType {
  return FRAME_TYPE_VALUES.has(value);
}

export function encodeFrame(frame: DeviceFrame): Uint8Array {
  if (!isFrameType(frame.type)) throw new DeviceFrameRefused(`Unknown frame type ${frame.type}.`);
  if (!Number.isInteger(frame.channel) || frame.channel < 0 || frame.channel > MAX_CHANNEL) {
    throw new DeviceFrameRefused(`Channel ${frame.channel} is not a u32.`);
  }
  if (frame.payload.byteLength > DEVICE_FRAME_MAX_PAYLOAD_BYTES) {
    throw new DeviceFrameRefused(oversizeWords(frame.payload.byteLength));
  }
  const bytes = new Uint8Array(DEVICE_FRAME_HEADER_BYTES + frame.payload.byteLength);
  const header = new DataView(bytes.buffer);
  header.setUint8(0, frame.type);
  header.setUint32(1, frame.channel);
  header.setUint32(5, frame.payload.byteLength);
  bytes.set(frame.payload, DEVICE_FRAME_HEADER_BYTES);
  return bytes;
}

export function textFrame(type: DeviceFrameType, text: string): DeviceFrame {
  return { type, channel: DEVICE_CONTROL_CHANNEL, payload: new TextEncoder().encode(text) };
}

export function frameText(frame: DeviceFrame): string {
  return new TextDecoder().decode(frame.payload);
}

/** What a READY says: the device's endpoint and, for a serial board, its `rfc2217://` address. */
export interface HelperEndpoints {
  readonly endpoint: string;
  readonly rfc2217Url: string | null;
}

const RFC2217_URL = /^rfc2217:\/\/127\.0\.0\.1:\d{1,5}$/;

/** A READY's endpoints; a second line that isn't a loopback `rfc2217://` address is left out. */
export function readyEndpoints(frame: DeviceFrame): HelperEndpoints {
  const [endpoint = "", second] = frameText(frame).split("\n");
  return {
    endpoint,
    rfc2217Url: second !== undefined && RFC2217_URL.test(second) ? second : null,
  };
}

/**
 * Reads frames from a byte stream however it is chunked: `push` each chunk as it comes and get
 * every frame it completes. A frame of an unknown type or over the maximum payload throws
 * `DeviceFrameRefused`, after which the stream can't be read on.
 */
export class FrameReader {
  private buffered: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): DeviceFrame[] {
    this.buffered = concat(this.buffered, chunk);
    const frames: DeviceFrame[] = [];
    let offset = 0;
    while (this.buffered.byteLength - offset >= DEVICE_FRAME_HEADER_BYTES) {
      const header = new DataView(
        this.buffered.buffer,
        this.buffered.byteOffset + offset,
        DEVICE_FRAME_HEADER_BYTES,
      );
      const type = header.getUint8(0);
      const channel = header.getUint32(1);
      const length = header.getUint32(5);
      if (!isFrameType(type)) throw new DeviceFrameRefused(`Unknown frame type ${type}.`);
      if (length > DEVICE_FRAME_MAX_PAYLOAD_BYTES) {
        throw new DeviceFrameRefused(oversizeWords(length));
      }
      const end = offset + DEVICE_FRAME_HEADER_BYTES + length;
      if (end > this.buffered.byteLength) break;
      frames.push({
        type,
        channel,
        payload: this.buffered.slice(offset + DEVICE_FRAME_HEADER_BYTES, end),
      });
      offset = end;
    }
    this.buffered = this.buffered.slice(offset);
    return frames;
  }

  /** Bytes of a frame not complete yet. */
  get pendingBytes(): number {
    return this.buffered.byteLength;
  }
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  if (first.byteLength === 0) return second;
  const joined = new Uint8Array(first.byteLength + second.byteLength);
  joined.set(first);
  joined.set(second, first.byteLength);
  return joined;
}

function oversizeWords(length: number): string {
  return `A frame of ${length} bytes is over the ${DEVICE_FRAME_MAX_PAYLOAD_BYTES}-byte maximum.`;
}
