import type { Readable, Writable } from "node:stream";
import type { ConnectedDeviceState, HelperNoticeCode } from "../domain/connected-device.js";

/** The Office device helper running in the Task's run environment, its bytes on stdin and stdout. */
export interface HelperProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  /** Resolves once it ended, never rejects. */
  readonly ended: Promise<{ readonly exitCode: number | undefined; readonly endedBy?: string }>;
  stop(): void;
}

/** How a helper's start went: its HELLO's version and its READY's endpoint, or why it ended first. */
export type HelperOpening =
  | { readonly kind: "ready"; readonly version: string; readonly endpoint: string }
  | { readonly kind: "ended"; readonly why: string };

/**
 * What a relayed helper tells the service after its READY, each as it comes. `ended` is told once
 * if it ends by itself, with why (its ENDED frame's words, or how it exited), never after
 * `stopHelper`; the others are a serial board's, never told for a stopped helper.
 */
export interface HelperListener {
  ended(why: string): void;
  /** The Project's tool set the serial port's line settings, at this baud rate. */
  settingsChanged(baudRate: number): void;
  /** The browser answered a PING the link passed on, this many ms after it was sent. */
  roundTripMeasured(roundTripMs: number): void;
  /** The helper noticed something about the board. */
  noticed(notice: HelperNoticeCode): void;
}

/** How the browser's relay socket closed. */
export type RelayClose =
  | { readonly kind: "tab-closed" }
  /** The browser said the device went away before it closed. */
  | { readonly kind: "unplugged" }
  /** The browser sent what the relay can't read. */
  | { readonly kind: "error"; readonly problem: string };

/**
 * One device's relay (spec §2.13, "The relay"): the browser's signed-in socket on one side, the
 * helper's standard input and output on the other, each frame passed on as the contract's frames
 * allow. The socket outlives helpers: a run environment's stop ends the helper, and its next
 * start runs a new one on the same socket.
 */
export interface RelayLink {
  /** Told once, as the browser's socket closes by itself, never after `closeAs…`. */
  onClosed(listener: (close: RelayClose) => void): void;
  /**
   * Told each time the helper's last open channel closes, from either side, as when adb in the run
   * environment drops its connection; never as the helper stops.
   */
  onChannelsClosed(listener: () => void): void;
  /** Tells the browser the device's state. */
  sendState(state: ConnectedDeviceState, endpoint: string | null): void;
  /** Closes the socket as a second one for a device that has one. */
  closeAsTaken(): void;
  /** Closes the socket as one for a device that isn't there or is Disconnected. */
  closeAsEnded(reason: string): void;
  /**
   * Relays the helper's frames: answers once it said HELLO and READY, or ended first, then tells
   * the listener what comes after READY.
   */
  startHelper(helper: HelperProcess, listener: HelperListener): Promise<HelperOpening>;
  /** Stops the helper it relays, if any; the socket stays open. */
  stopHelper(): void;
  /** Whether it relays a helper now. */
  readonly relaysHelper: boolean;
}
