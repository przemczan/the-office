// A serial board over USB, reached with Web Serial (spec 2.13, "Serial boards"). The Office device
// helper gives the run environment a serial port (the device's endpoint, such as /dev/ttyACM0) and
// relays what the Project's tool does on it: each open as OPEN on a channel, its bytes as DATA,
// the last close as CLOSE, and on channel 0 its line settings (SETTINGS), the modem lines it sets
// (SIGNALS) and a PING every few seconds. Everything that touches the port runs in one queue, in
// the order the frames came. The helper stamps each SETTINGS and SIGNALS with when it saw the
// change, and the queue replays each at its stamp's offset, so a reset such as esptool's keeps its
// spacing whatever the relay's jitter; DATA and PING run as soon as they reach the queue's head.
import type { SerialSettings, SerialSignals } from "@the-office/contracts";
import {
  type DeviceRelaySink,
  type DeviceTransport,
  type DeviceTransportProvider,
  type RequestedDevice,
} from "../device-relay.ts";

/** Said when the board can't be opened, as another tab or program holds it. */
export const SERIAL_PORT_BUSY = "This board is open in another tab or program.";

/** The port's settings until the Project's tool sets its own. */
export const DEFAULT_SERIAL_SETTINGS: SerialSettings = {
  baudRate: 115_200,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
};
const BUFFER_SIZE = 4096;
// A port with no USB ids, as a board on a built-in serial port.
const UNKNOWN_USB_IDS = "unknown";

/** Boards known by their USB vendor and product, `vvvv:pppp` in hex. */
const KNOWN_BOARDS: Readonly<Record<string, string>> = {
  "2341:0043": "Arduino Uno",
  "2341:0001": "Arduino Uno",
  "2341:0042": "Arduino Mega 2560",
  "2341:0010": "Arduino Mega 2560",
  "2341:8036": "Arduino Leonardo",
  "2341:8037": "Arduino Micro",
  "2341:0058": "Arduino Nano Every",
  "1a86:7523": "USB serial (CH340)",
  "0403:6001": "USB serial (FTDI)",
  "10c4:ea60": "USB serial (CP210x)",
};

// A random id per SerialPort object in this tab, so two identical boards get two device keys.
const portIds = new WeakMap<SerialPort, string>();
// The ports this tab holds open: a port picked again while held isn't opened twice.
const heldPorts = new WeakSet<SerialPort>();

/** The one clock the queue replays stamped changes by, in ms. */
export interface MonotonicClock {
  now(): number;
  /** Resolves once `now()` reaches `time`. */
  waitUntil(time: number): Promise<void>;
}

const PERFORMANCE_CLOCK: MonotonicClock = {
  now: () => performance.now(),
  waitUntil: (time) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, time - performance.now()))),
};

/** Why the kind is greyed in a browser without Web Serial, as Firefox and Safari. */
export const NEEDS_WEB_SERIAL = "Needs Chrome or Edge";
/** Why the kind is greyed on a page that isn't a secure one, where Web Serial is hidden. */
export const NEEDS_SECURE_CONTEXT = "Needs The Office over HTTPS or localhost";

/**
 * The serial board's transport over `serial` (the browser's own Web Serial by default); with none,
 * the kind is offered greyed with why. `clock` times the replay of stamped changes.
 */
export function serialUsbTransport(
  serial: Serial | undefined = browserSerial(),
  secureContext: () => boolean = () => globalThis.isSecureContext !== false,
  clock: MonotonicClock = PERFORMANCE_CLOCK,
): DeviceTransportProvider {
  if (serial === undefined) {
    const unavailable = secureContext() ? NEEDS_WEB_SERIAL : NEEDS_SECURE_CONTEXT;
    return {
      kind: "serial-usb",
      unavailable,
      request: () => Promise.reject(new Error(unavailable)),
    };
  }
  return {
    kind: "serial-usb",
    request: async () => {
      let port: SerialPort;
      try {
        port = await serial.requestPort();
      } catch (error) {
        // The user closed the picker without picking a board.
        if (isDomError(error, "NotFoundError")) return undefined;
        throw error;
      }
      // A port picked again while held belongs to another relay: this pick mustn't close it.
      const openedHere = !heldPorts.has(port);
      if (openedHere) {
        try {
          await port.open(serialOptions(DEFAULT_SERIAL_SETTINGS));
        } catch (error) {
          if (isDomError(error, "InvalidStateError") || isDomError(error, "NetworkError")) {
            throw new Error(SERIAL_PORT_BUSY, { cause: error });
          }
          throw error;
        }
        heldPorts.add(port);
      }
      return requestedBoard(serial, port, openedHere, clock);
    },
  };
}

/** Why the relay ends when the board opens neither at the tool's new baud nor at the one it had. */
export function serialReopenFailedWords(
  next: SerialSettings,
  before: SerialSettings,
  error: unknown,
): string {
  const reason = messageOf(error);
  return (
    `The browser couldn't open the board at ${next.baudRate} baud, ` +
    `nor again at ${before.baudRate} baud` +
    (reason === "" ? "." : `: ${reason}`)
  );
}

/** The board's name, from its USB vendor and product. */
export function serialBoardName(info: SerialPortInfo): string {
  const ids = usbIds(info);
  if (ids === UNKNOWN_USB_IDS) return "USB serial device";
  return KNOWN_BOARDS[ids] ?? `USB serial device ${ids}`;
}

/** `serial:<vid>:<pid>:<id of this SerialPort in this tab>`, "unknown" for a port with no USB ids. */
export function serialDeviceKey(port: SerialPort): string {
  let id = portIds.get(port);
  if (id === undefined) {
    id = crypto.randomUUID();
    portIds.set(port, id);
  }
  return `serial:${usbIds(port.getInfo())}:${id}`;
}

function requestedBoard(
  serial: Serial,
  port: SerialPort,
  openedHere: boolean,
  clock: MonotonicClock,
): RequestedDevice {
  // Only a port this pick opened, and never attached, is this pick's to close.
  let closesOnRelease = openedHere;
  return {
    name: serialBoardName(port.getInfo()),
    deviceKey: serialDeviceKey(port),
    attach: (sink) => {
      closesOnRelease = false;
      return attachBoard(port, sink, clock);
    },
    release: () => {
      if (!closesOnRelease) return;
      closesOnRelease = false;
      heldPorts.delete(port);
      port.close().catch(() => {});
    },
    onUnplugged: (listener) => {
      let heard = false;
      const unplugged = (event: Event): void => {
        if (heard || event.target !== port) return;
        heard = true;
        listener();
      };
      port.addEventListener("disconnect", unplugged);
      serial.addEventListener("disconnect", unplugged);
      return () => {
        port.removeEventListener("disconnect", unplugged);
        serial.removeEventListener("disconnect", unplugged);
      };
    },
  };
}

/** One step of the queue: a stamped change carries `at`, µs on the helper's clock. */
interface QueuedStep {
  readonly at?: number;
  readonly run: () => Promise<void> | void;
}

function attachBoard(
  port: SerialPort,
  sink: DeviceRelaySink,
  clock: MonotonicClock,
): DeviceTransport {
  // The channels the run environment has open, the latest last: the board's bytes go to it.
  const openChannels: number[] = [];
  // The settings the port is open at, changed only by an open that succeeded.
  let openAt = DEFAULT_SERIAL_SETTINGS;
  let signals: SerialSignals | undefined;
  const steps: QueuedStep[] = [];
  // The loop running the steps, while there are any.
  let queue: Promise<void> = Promise.resolve();
  let draining = false;
  // Replay's origin: the clock's time a stamped change ran at, and its stamp.
  let anchor: { time: number; at: number } | undefined;
  let ended = false;
  // Aborted by `end`, so a step waiting for its time doesn't hold the port's close.
  const ending = new AbortController();
  const endHeard = new Promise<void>((resolve) =>
    ending.signal.addEventListener("abort", () => resolve(), { once: true }),
  );
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let reading: { stop: () => Promise<void> } | undefined = readBoard();

  function enqueue(run: () => Promise<void> | void, at?: number): void {
    if (ended) return;
    steps.push(at === undefined ? { run } : { run, at });
    if (draining) return;
    draining = true;
    queue = drain();
  }

  async function drain(): Promise<void> {
    // Run after the call that queued the first step, as each step always has.
    await Promise.resolve();
    for (;;) {
      const step = ended ? undefined : steps.shift();
      if (step === undefined) break;
      if (step.at !== undefined) await dueTime(step.at);
      if (ended) break;
      try {
        await step.run();
      } catch {
        // A step that fails (the board gone, a write refused) leaves the next ones to try.
      }
    }
    draining = false;
  }

  // Waits until a change stamped `at` is due, reckoned from the anchor each time, so delays never
  // add up; the first change, and one already late, runs at once and anchors the ones after it.
  async function dueTime(at: number): Promise<void> {
    const now = clock.now();
    const due = anchor === undefined ? undefined : anchor.time + (at - anchor.at) / 1000;
    if (due === undefined || due <= now) {
      // Re-anchored rather than kept: after an idle gap every change would be late, and a reset's
      // 100 ms and 50 ms gaps would shrink to the relay's jitter.
      anchor = { time: now, at };
      return;
    }
    await Promise.race([clock.waitUntil(due), endHeard]);
  }

  function readBoard(): { stop: () => Promise<void> } {
    // Set by `stop`, which runs while the loop awaits a read.
    const state = { stopped: false };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const loop = (async () => {
      // A framing or parity error gives the port a new readable; a lost board leaves none.
      while (!state.stopped && port.readable !== null) {
        reader = port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const channel = openChannels.at(-1);
            if (channel !== undefined && value.byteLength > 0) sink.send(channel, value);
          }
        } catch {
          // Read on from the new readable, if the port has one.
        } finally {
          reader.releaseLock();
          reader = undefined;
        }
      }
    })();
    return {
      stop: async () => {
        state.stopped = true;
        await reader?.cancel().catch(() => {});
        await loop;
      },
    };
  }

  async function release(): Promise<void> {
    await reading?.stop();
    reading = undefined;
    writer?.releaseLock();
    writer = undefined;
  }

  // Reading first, so signals the port refuses can't stop the board's bytes.
  async function readAgain(): Promise<void> {
    reading = readBoard();
    if (signals !== undefined) await port.setSignals(signals).catch(() => {});
  }

  async function reopen(next: SerialSettings): Promise<void> {
    if (sameSettings(openAt, next)) return;
    await release();
    try {
      await port.close();
      await port.open(serialOptions(next));
      openAt = next;
    } catch {
      // The board stays reachable at the settings it had, and the next SETTINGS tries again.
      if (port.readable === null) {
        try {
          await port.open(serialOptions(openAt));
        } catch (error) {
          if (!ended) sink.fail(serialReopenFailedWords(next, openAt, error));
          return;
        }
      }
    }
    await readAgain();
  }

  return {
    opened: (channel) => {
      if (!openChannels.includes(channel)) openChannels.push(channel);
    },
    closed: (channel) => {
      const at = openChannels.indexOf(channel);
      if (at !== -1) openChannels.splice(at, 1);
    },
    received: (_channel, bytes) =>
      enqueue(async () => {
        if (port.writable === null) return;
        const current = (writer ??= port.writable.getWriter());
        try {
          await current.write(bytes);
        } catch (error) {
          // A failed stream stays failed: the port's next writable needs a writer of its own.
          if (writer === current) {
            current.releaseLock();
            writer = undefined;
          }
          throw error;
        }
      }),
    settings: (next, at) => enqueue(() => reopen(next), at),
    signals: (next, at) =>
      enqueue(async () => {
        signals = next;
        await port.setSignals(next);
      }, at),
    ping: (id) => enqueue(() => sink.pong(id)),
    end: () => {
      // What is queued may wait on a board that is gone: reading stops now, then the port closes.
      const stopping = release();
      ended = true;
      steps.length = 0;
      ending.abort();
      queue = queue
        .then(() => stopping)
        .then(() => release())
        .then(() => port.close())
        .catch(() => {})
        .finally(() => heldPorts.delete(port));
    },
  };
}

function serialOptions(settings: SerialSettings): SerialOptions {
  return {
    baudRate: settings.baudRate,
    dataBits: settings.dataBits,
    parity: settings.parity,
    stopBits: settings.stopBits,
    bufferSize: BUFFER_SIZE,
  };
}

function sameSettings(a: SerialSettings, b: SerialSettings): boolean {
  return (
    a.baudRate === b.baudRate &&
    a.dataBits === b.dataBits &&
    a.parity === b.parity &&
    a.stopBits === b.stopBits
  );
}

function usbIds(info: SerialPortInfo): string {
  if (info.usbVendorId === undefined || info.usbProductId === undefined) return UNKNOWN_USB_IDS;
  return `${hex4(info.usbVendorId)}:${hex4(info.usbProductId)}`;
}

function hex4(value: number): string {
  return value.toString(16).padStart(4, "0");
}

// A DOMException, which isn't an Error in every environment.
function isDomError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}

// An error's message, or "" for a rejection without one; a DOMException's too.
function messageOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
}

function browserSerial(): Serial | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.serial;
}
