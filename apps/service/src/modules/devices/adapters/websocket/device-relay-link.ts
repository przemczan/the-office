import { finished } from "node:stream/promises";
import {
  DEVICE_FRAME_TYPES,
  DEVICE_RELAY_ENDED_CLOSE_CODE,
  DEVICE_RELAY_TAKEN_CLOSE_CODE,
  deviceRelayClientMessageSchema,
  encodeFrame,
  FrameReader,
  frameText,
  type DeviceFrame,
  type DeviceRelayServerMessage,
} from "@the-office/contracts";
import type { ConnectedDeviceState } from "../../domain/connected-device.js";
import type {
  HelperOpening,
  HelperProcess,
  RelayClose,
  RelayLink,
} from "../../ports/relay-link.js";

/** What the relay needs of `ws`'s WebSocket, so a test can stand in for it. */
export interface RelaySocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array | string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  pause?(): void;
  resume?(): void;
  on(
    event: "message",
    listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void,
  ): unknown;
  on(event: "close", listener: () => void): unknown;
}

/** `WebSocket.OPEN`. */
const SOCKET_OPEN = 1;
/** The close code of a socket that sent what the relay can't read (RFC 6455, 1007). */
const INVALID_DATA_CLOSE_CODE = 1007;
/** Past this many bytes queued on the socket, the helper's output waits. */
export const SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
const SOCKET_LOW_WATER_BYTES = 256 * 1024;
/** A close reason is at most 123 bytes; the words are cut to fit. */
const CLOSE_REASON_MAX_BYTES = 123;

/** The frames the browser may send on to the helper. */
const BROWSER_FRAMES: ReadonlySet<number> = new Set([
  DEVICE_FRAME_TYPES.open,
  DEVICE_FRAME_TYPES.data,
  DEVICE_FRAME_TYPES.close,
]);

const HELPER_STOPPED = "The Office device helper was stopped.";

/** A helper while the link relays it. */
interface RelayedHelper {
  readonly process: HelperProcess;
  readonly reader: FrameReader;
  version: string | undefined;
  ready: boolean;
  stopped: boolean;
  /** Its ENDED frame's words, or why the link ended it. */
  endedWords: string | undefined;
  /** Whether its start was answered. */
  settled: boolean;
  settle: (opening: HelperOpening) => void;
}

/**
 * One device's relay over `ws` (spec §2.13, "The relay"): the browser's binary messages are read
 * as device frames, and only OPEN, DATA and CLOSE go on to the helper's standard input; the
 * helper's HELLO, READY and ENDED are the service's own, and its OPEN, DATA and CLOSE go to the
 * browser. Each side waits for the other: the helper's output pauses while the socket holds more
 * than `SOCKET_HIGH_WATER_BYTES`, and the socket pauses while the helper's input is full.
 */
export class DeviceRelayLink implements RelayLink {
  private readonly fromBrowser = new FrameReader();
  private helper: RelayedHelper | undefined;
  private closedListener: ((close: RelayClose) => void) | undefined;
  private closedAs: RelayClose | undefined;
  private closedByService = false;
  private unplugged = false;
  private problem: string | undefined;
  private helperPaused = false;

  constructor(private readonly socket: RelaySocket) {
    socket.on("message", (data, isBinary) => {
      if (isBinary) this.fromSocket(bytesOf(data));
      else this.controlMessage(bytesOf(data).toString("utf8"));
    });
    socket.on("close", () => this.socketClosed());
  }

  get relaysHelper(): boolean {
    return this.helper !== undefined;
  }

  onClosed(listener: (close: RelayClose) => void): void {
    this.closedListener = listener;
    const closedAs = this.closedAs;
    if (closedAs !== undefined) queueMicrotask(() => listener(closedAs));
  }

  sendState(state: ConnectedDeviceState, endpoint: string | null): void {
    if (this.socket.readyState !== SOCKET_OPEN) return;
    const message: DeviceRelayServerMessage = { type: "state", state, endpoint };
    this.socket.send(JSON.stringify(message));
  }

  closeAsTaken(): void {
    this.closeByService(DEVICE_RELAY_TAKEN_CLOSE_CODE, "The device's relay is open elsewhere.");
  }

  closeAsEnded(reason: string): void {
    this.closeByService(DEVICE_RELAY_ENDED_CLOSE_CODE, reason);
  }

  startHelper(process: HelperProcess, ended: (why: string) => void): Promise<HelperOpening> {
    this.stopHelper();
    const opening = deferred<HelperOpening>();
    const helper: RelayedHelper = {
      process,
      reader: new FrameReader(),
      version: undefined,
      ready: false,
      stopped: false,
      endedWords: undefined,
      settled: false,
      settle: (answer) => {
        if (helper.settled) return;
        helper.settled = true;
        opening.resolve(answer);
      },
    };
    this.helper = helper;
    process.stdout.on("data", (chunk: Buffer) => this.fromHelper(helper, chunk));
    void this.untilEnded(helper, ended);
    return opening.promise;
  }

  /** Once the helper exited and its output was read: why it ended, to whoever waits for it. */
  private async untilEnded(helper: RelayedHelper, ended: (why: string) => void): Promise<void> {
    const outputRead = finished(helper.process.stdout).catch(() => undefined);
    const [end] = await Promise.all([helper.process.ended, outputRead]);
    if (this.helper === helper) this.helper = undefined;
    if (helper.stopped) {
      helper.settle({ kind: "ended", why: HELPER_STOPPED });
      return;
    }
    const why = helper.endedWords ?? exitWords(end);
    if (helper.settled) ended(why);
    else helper.settle({ kind: "ended", why });
  }

  stopHelper(): void {
    const helper = this.helper;
    if (helper === undefined) return;
    this.helper = undefined;
    helper.stopped = true;
    this.helperPaused = false;
    helper.process.stop();
    helper.settle({ kind: "ended", why: HELPER_STOPPED });
  }

  private fromHelper(helper: RelayedHelper, chunk: Buffer): void {
    if (helper.stopped) return;
    let frames: DeviceFrame[];
    try {
      frames = helper.reader.push(chunk);
    } catch (error) {
      this.failHelper(
        helper,
        `The Office device helper sent what can't be read: ${wordsOf(error)}`,
      );
      return;
    }
    for (const frame of frames) {
      switch (frame.type) {
        case DEVICE_FRAME_TYPES.hello:
          helper.version = frameText(frame);
          break;
        case DEVICE_FRAME_TYPES.ready:
          if (helper.version === undefined) {
            this.failHelper(helper, "The Office device helper was ready before it said hello.");
            return;
          }
          helper.ready = true;
          helper.settle({ kind: "ready", version: helper.version, endpoint: frameText(frame) });
          break;
        case DEVICE_FRAME_TYPES.ended:
          helper.endedWords = frameText(frame);
          break;
        default:
          if (helper.ready) this.toSocket(helper, encodeFrame(frame));
      }
    }
  }

  /** Ends the helper as it misbehaved: its end tells why. */
  private failHelper(helper: RelayedHelper, why: string): void {
    helper.endedWords = why;
    helper.process.stop();
  }

  private toSocket(helper: RelayedHelper, bytes: Uint8Array): void {
    if (this.socket.readyState !== SOCKET_OPEN) return;
    this.socket.send(bytes, () => this.socketDrained(helper));
    if (!this.helperPaused && this.socket.bufferedAmount > SOCKET_HIGH_WATER_BYTES) {
      this.helperPaused = true;
      helper.process.stdout.pause();
    }
  }

  private socketDrained(helper: RelayedHelper): void {
    if (!this.helperPaused || this.helper !== helper) return;
    if (this.socket.bufferedAmount > SOCKET_LOW_WATER_BYTES) return;
    this.helperPaused = false;
    helper.process.stdout.resume();
  }

  private fromSocket(bytes: Buffer): void {
    let frames: DeviceFrame[];
    try {
      frames = this.fromBrowser.push(bytes);
    } catch (error) {
      this.problem = `The browser sent what the relay can't read: ${wordsOf(error)}`;
      this.socket.close(INVALID_DATA_CLOSE_CODE, cutToCloseReason(this.problem));
      return;
    }
    const helper = this.helper;
    // Bytes for a device whose run environment isn't running have nowhere to go.
    if (helper === undefined) return;
    for (const frame of frames) {
      if (!BROWSER_FRAMES.has(frame.type)) continue;
      if (!helper.process.stdin.write(encodeFrame(frame))) {
        this.socket.pause?.();
        helper.process.stdin.once("drain", () => this.socket.resume?.());
      }
    }
  }

  private controlMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    const message = deviceRelayClientMessageSchema.safeParse(parsed);
    if (message.success && message.data.type === "unplugged") this.unplugged = true;
  }

  private closeByService(code: number, reason: string): void {
    this.closedByService = true;
    this.stopHelper();
    if (this.socket.readyState === SOCKET_OPEN) this.socket.close(code, cutToCloseReason(reason));
  }

  private socketClosed(): void {
    this.stopHelper();
    if (this.closedByService || this.closedAs !== undefined) return;
    const closedAs: RelayClose =
      this.problem !== undefined
        ? { kind: "error", problem: this.problem }
        : this.unplugged
          ? { kind: "unplugged" }
          : { kind: "tab-closed" };
    this.closedAs = closedAs;
    this.closedListener?.(closedAs);
  }
}

function bytesOf(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function exitWords(end: { readonly exitCode: number | undefined }): string {
  return end.exitCode === undefined
    ? "The Office device helper ended."
    : `The Office device helper ended with exit code ${end.exitCode}.`;
}

function cutToCloseReason(reason: string): string {
  let cut = reason;
  while (Buffer.byteLength(cut) > CLOSE_REASON_MAX_BYTES) cut = cut.slice(0, -1);
  return cut;
}

function wordsOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A promise and its resolve, as `Promise.withResolvers` (ES2024) gives. */
function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  const settles: { resolve?: (value: Value) => void } = {};
  const promise = new Promise<Value>((resolve) => {
    settles.resolve = resolve;
  });
  return { promise, resolve: (value) => settles.resolve?.(value) };
}
