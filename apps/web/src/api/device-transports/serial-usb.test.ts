import { describe, expect, it } from "vitest";
import type { DeviceRelaySink, DeviceTransport, RequestedDevice } from "../device-relay.ts";
import {
  type MonotonicClock,
  NEEDS_SECURE_CONTEXT,
  NEEDS_WEB_SERIAL,
  SERIAL_PORT_BUSY,
  serialReopenFailedWords,
  serialUsbTransport,
} from "./serial-usb.ts";

/**
 * A serial port the test drives: its opens, closes, signals and writes, and what reaches the
 * relay, go into one ordered log; `board` is the board sending bytes.
 */
class FakePort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  openFails: string | undefined;
  /** How many of the next opens fail, as a driver refusing a rate does. */
  opensToFail = 0;
  /** How many of the next writes fail; each leaves the port a new writable, as Web Serial does. */
  writesToFail = 0;
  signalsFail = false;
  private boardSide: ReadableStreamDefaultController<Uint8Array> | undefined;

  constructor(
    readonly log: string[],
    private readonly info: SerialPortInfo = { usbVendorId: 0x2341, usbProductId: 0x0043 },
  ) {
    super();
  }

  getInfo(): SerialPortInfo {
    return this.info;
  }

  open(options: SerialOptions): Promise<void> {
    if (this.openFails !== undefined) {
      return Promise.reject(new DOMException("Failed to open serial port.", this.openFails));
    }
    if (this.readable !== null)
      return Promise.reject(new DOMException("Open", "InvalidStateError"));
    if (this.opensToFail > 0) {
      this.opensToFail -= 1;
      this.log.push(`open fails ${options.baudRate}`);
      return Promise.reject(new DOMException("Failed to open serial port.", "NetworkError"));
    }
    this.log.push(`open ${options.baudRate} ${options.bufferSize}`);
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.boardSide = controller;
      },
    });
    this.writable = this.newWritable();
    return Promise.resolve();
  }

  setSignals(signals: SerialOutputSignals): Promise<void> {
    if (this.signalsFail) {
      this.log.push("signals refused");
      return Promise.reject(new DOMException("Failed to set control signals.", "NetworkError"));
    }
    this.log.push(`signals ${signals.dataTerminalReady} ${signals.requestToSend}`);
    return Promise.resolve();
  }

  close(): Promise<void> {
    if (this.readable?.locked === true || this.writable?.locked === true) {
      return Promise.reject(new TypeError("A stream is locked."));
    }
    this.log.push("close");
    this.readable = null;
    this.writable = null;
    this.boardSide = undefined;
    return Promise.resolve();
  }

  board(...bytes: number[]): void {
    this.boardSide?.enqueue(new Uint8Array(bytes));
  }

  private newWritable(): WritableStream<Uint8Array> {
    return new WritableStream<Uint8Array>({
      // A write that takes a moment, as a real one does, so what is queued after it must wait.
      write: async (chunk) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (this.writesToFail > 0) {
          this.writesToFail -= 1;
          this.log.push("write fails");
          this.writable = this.newWritable();
          throw new DOMException("Failed to write.", "NetworkError");
        }
        this.log.push(`write ${[...chunk].join(",")}`);
      },
    });
  }
}

/** A clock the test moves on; each wait ends when the time passes it. */
class FakeClock implements MonotonicClock {
  time = 0;
  private waits: { time: number; resolve: () => void }[] = [];

  now(): number {
    return this.time;
  }

  waitUntil(time: number): Promise<void> {
    if (time <= this.time) return Promise.resolve();
    return new Promise((resolve) => this.waits.push({ time, resolve }));
  }

  /** Moves the time on to `until`, ending each wait on the way at its own time. */
  async advance(until: number): Promise<void> {
    for (;;) {
      await settle();
      const next = Math.min(...this.waits.map((wait) => wait.time));
      if (!(next <= until)) break;
      this.time = next;
      const due = this.waits.filter((wait) => wait.time <= next);
      this.waits = this.waits.filter((wait) => wait.time > next);
      for (const wait of due) wait.resolve();
    }
    this.time = until;
    await settle();
  }
}

class FakeSerial extends EventTarget {
  picked: FakePort | undefined;
  /** The ports this browser allowed before. */
  allowed: FakePort[] = [];

  getPorts(): Promise<SerialPort[]> {
    return Promise.resolve(this.allowed as unknown as SerialPort[]);
  }

  requestPort(): Promise<SerialPort> {
    if (this.picked === undefined) {
      return Promise.reject(new DOMException("No port selected by the user.", "NotFoundError"));
    }
    return Promise.resolve(this.picked as unknown as SerialPort);
  }
}

/** Lets the queue, the streams and their timers run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 2));
}

async function picked(
  info?: SerialPortInfo,
  clock?: MonotonicClock,
): Promise<{ port: FakePort; serial: FakeSerial; device: RequestedDevice; log: string[] }> {
  const log: string[] = [];
  const serial = new FakeSerial();
  const port = new FakePort(log, info);
  serial.picked = port;
  const device = await serialUsbTransport(serial as unknown as Serial, undefined, clock).request();
  if (device === undefined) throw new Error("No board picked.");
  return { port, serial, device, log };
}

function attached(device: RequestedDevice, log: string[]): DeviceTransport {
  const sink: DeviceRelaySink = {
    send: (channel, bytes) => log.push(`send ${channel} ${[...bytes].join(",")}`),
    close: (channel) => log.push(`sink close ${channel}`),
    open: (channel) => log.push(`sink open ${channel}`),
    pong: (id) => log.push(`pong ${id}`),
    fail: (problem) => log.push(`fail ${problem}`),
    writable: () => Promise.resolve(),
  };
  return device.attach(sink);
}

const SETTINGS = { baudRate: 115_200, dataBits: 8, parity: "none", stopBits: 1 } as const;
// One stamp for every change, so each runs as soon as it reaches the queue's head.
const AT = 0;

// A stamp far from 0, as the helper's monotonic clock has run a while, in µs.
const T = 7_000_000_000;
/**
 * esptool's classic reset as the helper stamps it: DTR off, RTS on (each its own SET-CONTROL,
 * each frame with both lines), 100 ms, DTR on, RTS off, 50 ms, DTR off.
 */
const ESPTOOL_RESET = [
  { signals: { dataTerminalReady: false, requestToSend: true }, at: T },
  { signals: { dataTerminalReady: false, requestToSend: true }, at: T + 40 },
  { signals: { dataTerminalReady: true, requestToSend: true }, at: T + 100_080 },
  { signals: { dataTerminalReady: true, requestToSend: false }, at: T + 100_120 },
  { signals: { dataTerminalReady: false, requestToSend: false }, at: T + 150_200 },
] as const;

/** Each setSignals the port hears, as the clock's ms from `from` (to the µs) and the two lines. */
function timedSignals(port: FakePort, clock: FakeClock, from: number): string[] {
  const heard: string[] = [];
  const set = port.setSignals.bind(port);
  port.setSignals = (signals) => {
    const ms = Math.round((clock.now() - from) * 1000) / 1000;
    heard.push(`${ms} ${signals.dataTerminalReady} ${signals.requestToSend}`);
    return set(signals);
  };
  return heard;
}

describe("a serial board over USB", () => {
  it("opens the picked board at 115200 baud, named by its USB ids", async () => {
    const { device, log } = await picked();

    expect(log).toEqual(["open 115200 4096"]);
    expect(device.name).toBe("Arduino Uno");
    expect(device.deviceKey).toMatch(/^serial:2341:0043:[0-9a-f-]{36}$/);
    const other = await picked({ usbVendorId: 0x1234, usbProductId: 0xabcd });
    expect(other.device.name).toBe("USB serial device 1234:abcd");
    // A second identical board is another port, so another device.
    expect((await picked()).device.deviceKey).not.toBe(device.deviceKey);
    const bare = await picked({});
    expect(bare.device.name).toBe("USB serial device");
    expect(bare.device.deviceKey).toMatch(/^serial:unknown:/);
  });

  it("opens a board this browser allowed before, by its key or else its only port with its USB ids", async () => {
    const log: string[] = [];
    const serial = new FakeSerial();
    serial.allowed = [new FakePort(log)];
    const transport = serialUsbTransport(serial as unknown as Serial);

    const board = await transport.remembered?.("serial:2341:0043:from-another-tab");
    expect(board?.name).toBe("Arduino Uno");
    expect(log).toEqual(["open 115200 4096"]);
    board?.release?.();
    expect(await transport.remembered?.("serial:1234:abcd:from-another-tab")).toBeUndefined();

    serial.allowed = [new FakePort(log), new FakePort(log)];
    expect(await transport.remembered?.("serial:2341:0043:from-another-tab")).toBeUndefined();
  });

  it("answers no board when the user closes the picker", async () => {
    await expect(serialUsbTransport(new FakeSerial() as unknown as Serial).request()).resolves.toBe(
      undefined,
    );
  });

  it("says the board is open elsewhere when it can't be opened", async () => {
    const serial = new FakeSerial();
    for (const name of ["InvalidStateError", "NetworkError"]) {
      const port = new FakePort([]);
      port.openFails = name;
      serial.picked = port;
      await expect(serialUsbTransport(serial as unknown as Serial).request()).rejects.toThrow(
        SERIAL_PORT_BUSY,
      );
    }
  });

  it("is offered greyed in a browser without Web Serial", () => {
    expect(serialUsbTransport(undefined, () => true).unavailable).toBe(NEEDS_WEB_SERIAL);
    expect(serialUsbTransport(undefined, () => false).unavailable).toBe(NEEDS_SECURE_CONTEXT);
  });

  it("reopens the port at the new baud, after the writes before it, and sets the signals again", async () => {
    const { device, log } = await picked();
    const board = attached(device, log);

    board.signals?.({ dataTerminalReady: true, requestToSend: true }, AT);
    board.received(1, new Uint8Array([1]));
    board.settings?.(SETTINGS, AT);
    board.settings?.({ ...SETTINGS, baudRate: 57_600 }, AT);
    board.received(1, new Uint8Array([2]));
    board.settings?.({ ...SETTINGS, baudRate: 57_600 }, AT);
    await settle();

    expect(log).toEqual([
      "open 115200 4096",
      "signals true true",
      "write 1",
      "close",
      "open 57600 4096",
      "signals true true",
      "write 2",
    ]);
  });

  it("reopens at the baud it had when the new one fails, and tries the new one again on the next SETTINGS", async () => {
    const { port, device, log } = await picked();
    const board = attached(device, log);
    board.opened(1);
    board.signals?.({ dataTerminalReady: true, requestToSend: true }, AT);
    port.opensToFail = 1;

    board.settings?.({ ...SETTINGS, baudRate: 57_600 }, AT);
    await settle();
    port.board(4);
    await settle();
    board.settings?.({ ...SETTINGS, baudRate: 57_600 }, AT);
    await settle();

    expect(log).toEqual([
      "open 115200 4096",
      "signals true true",
      "close",
      "open fails 57600",
      "open 115200 4096",
      "signals true true",
      "send 1 4",
      "close",
      "open 57600 4096",
      "signals true true",
    ]);
  });

  it("ends the relay as error, once, when the board opens at neither baud", async () => {
    const { port, device, log } = await picked();
    const board = attached(device, log);
    port.opensToFail = 2;

    board.settings?.({ ...SETTINGS, baudRate: 57_600 }, AT);
    await settle();

    expect(log.filter((line) => line.startsWith("fail "))).toEqual([
      "fail The browser couldn't open the board at 57600 baud, nor again at 115200 baud: " +
        "Failed to open serial port.",
    ]);
    expect(serialReopenFailedWords({ ...SETTINGS, baudRate: 9600 }, SETTINGS, undefined)).toBe(
      "The browser couldn't open the board at 9600 baud, nor again at 115200 baud.",
    );
  });

  it("reads on from the board when the port refuses its signals", async () => {
    const { port, device, log } = await picked();
    const board = attached(device, log);
    board.opened(1);
    port.signalsFail = true;

    board.signals?.({ dataTerminalReady: true, requestToSend: true }, AT);
    board.settings?.({ ...SETTINGS, baudRate: 57_600 }, AT);
    await settle();
    port.board(5);
    await settle();

    expect(log.slice(1)).toEqual([
      "signals refused",
      "close",
      "open 57600 4096",
      "signals refused",
      "send 1 5",
    ]);
  });

  it("writes on with a fresh writer after a write fails", async () => {
    const { port, device, log } = await picked();
    const board = attached(device, log);
    port.writesToFail = 1;

    board.received(1, new Uint8Array([1]));
    board.received(1, new Uint8Array([2]));
    await settle();

    expect(log.slice(1)).toEqual(["write fails", "write 2"]);
  });

  it("closes the port it opened when a refused board is let go, once", async () => {
    const { device, log } = await picked();

    device.release?.();
    device.release?.();
    await settle();

    expect(log).toEqual(["open 115200 4096", "close"]);
  });

  it("leaves a held port open when it is picked again and let go", async () => {
    const { serial, device, log } = await picked();
    const board = attached(device, log);
    board.opened(1);
    const again = await serialUsbTransport(serial as unknown as Serial).request();

    again?.release?.();
    board.received(1, new Uint8Array([3]));
    await settle();

    expect(log).toEqual(["open 115200 4096", "write 3"]);
  });

  it("keeps SIGNALS in order with DATA", async () => {
    const { device, log } = await picked();
    const board = attached(device, log);

    board.received(1, new Uint8Array([1]));
    board.signals?.({ dataTerminalReady: false, requestToSend: false }, AT);
    board.signals?.({ dataTerminalReady: true, requestToSend: true }, AT);
    board.received(1, new Uint8Array([2, 3]));
    await settle();

    expect(log.slice(1)).toEqual([
      "write 1",
      "signals false false",
      "signals true true",
      "write 2,3",
    ]);
  });

  it("answers a PING with its PONG after the writes queued before it", async () => {
    const { device, log } = await picked();
    const board = attached(device, log);

    board.received(1, new Uint8Array([1]));
    board.ping?.(3);
    await settle();

    expect(log.slice(1)).toEqual(["write 1", "pong 3"]);
  });

  it("sends the board's bytes on the latest open channel, and drops them with none open", async () => {
    const { port, device, log } = await picked();
    const board = attached(device, log);

    port.board(9);
    await settle();
    board.opened(2);
    port.board(5);
    await settle();
    board.opened(3);
    port.board(6);
    await settle();
    board.closed(3);
    port.board(7);
    await settle();
    board.closed(2);
    port.board(8);
    await settle();

    expect(log.slice(1)).toEqual(["send 2 5", "send 3 6", "send 2 7"]);
  });

  it("hears the board unplugged, once", async () => {
    const { port, device } = await picked();
    let unplugged = 0;
    const stop = device.onUnplugged(() => (unplugged += 1));

    port.dispatchEvent(new Event("disconnect"));
    port.dispatchEvent(new Event("disconnect"));
    stop();

    expect(unplugged).toBe(1);
  });

  it("closes the port when the relay ends", async () => {
    const { device, log } = await picked();
    const board = attached(device, log);

    board.end();
    board.received(1, new Uint8Array([1]));
    await settle();

    expect(log).toEqual(["open 115200 4096", "close"]);
  });
  it("replays esptool's reset at its stamps when the frames arrive bunched", async () => {
    const clock = new FakeClock();
    clock.time = 1_000;
    const { port, device } = await picked(undefined, clock);
    const heard = timedSignals(port, clock, 1_000);
    const board = attached(device, []);

    for (const { signals, at } of ESPTOOL_RESET) board.signals?.(signals, at);
    await clock.advance(1_200);

    expect(heard).toEqual([
      "0 false true",
      "0.04 false true",
      "100.08 true true",
      "100.12 true false",
      "150.2 false false",
    ]);
  });

  it("applies a change already late at once and spaces the ones after it from it", async () => {
    const clock = new FakeClock();
    clock.time = 1_000;
    const { port, device } = await picked(undefined, clock);
    const heard = timedSignals(port, clock, 1_000);
    const board = attached(device, []);
    const [first, second, ...rest] = ESPTOOL_RESET;

    board.signals?.(first.signals, first.at);
    await clock.advance(1_030);
    // Due 0.04 ms after the first, it comes 30 ms late.
    board.signals?.(second.signals, second.at);
    await clock.advance(1_031);
    for (const { signals, at } of rest) board.signals?.(signals, at);
    await clock.advance(1_300);

    expect(heard).toEqual([
      "0 false true",
      "30 false true",
      "130.04 true true",
      "130.08 true false",
      "180.16 false false",
    ]);
  });

  it("keeps DATA and PING behind the changes queued before them", async () => {
    const clock = new FakeClock();
    clock.time = 1_000;
    const { device, log } = await picked(undefined, clock);
    const board = attached(device, log);
    const [first, , third] = ESPTOOL_RESET;

    board.signals?.(first.signals, first.at);
    board.signals?.(third.signals, third.at);
    board.received(1, new Uint8Array([1]));
    board.ping?.(2);
    board.settings?.({ ...SETTINGS, baudRate: 57_600 }, third.at + 1_000);
    board.received(1, new Uint8Array([2]));
    await clock.advance(1_050);

    expect(log.slice(1)).toEqual(["signals false true"]);

    await clock.advance(1_100.5);
    expect(log.slice(1)).toEqual(["signals false true", "signals true true", "write 1", "pong 2"]);

    await clock.advance(1_200);
    expect(log.slice(1)).toEqual([
      "signals false true",
      "signals true true",
      "write 1",
      "pong 2",
      "close",
      "open 57600 4096",
      "signals true true",
      "write 2",
    ]);
  });

  it("closes the port when the relay ends while a change waits for its time", async () => {
    const clock = new FakeClock();
    const { device, log } = await picked(undefined, clock);
    const board = attached(device, log);
    const [first, , third] = ESPTOOL_RESET;

    board.signals?.(first.signals, first.at);
    board.signals?.(third.signals, third.at);
    board.received(1, new Uint8Array([1]));
    await settle();
    board.end();
    await settle();

    expect(log).toEqual(["open 115200 4096", "signals false true", "close"]);
  });
});
