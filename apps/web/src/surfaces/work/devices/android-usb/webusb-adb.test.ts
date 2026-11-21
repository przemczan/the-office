import { describe, expect, it } from "vitest";
import type { DeviceRelaySink, RequestedDevice } from "../../../../api/device-relay.ts";
import { ADB_AUTH_TYPES, ADB_COMMANDS, adbPacketBytes } from "./adb-packets.ts";
import {
  ALLOW_USB_DEBUGGING,
  NEEDS_SECURE_CONTEXT,
  NEEDS_WEBUSB,
  NO_SERIAL_NUMBER,
  PHONE_IN_USE,
} from "./android-usb-words.ts";
import { androidUsbTransport } from "./webusb-adb.ts";

const IN = 1;
const OUT = 2;
const PACKET_SIZE = 512;
const WRTE = 0x45545257;
const OKAY = 0x59414b4f;
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0";

/** A phone with an ADB interface: its transfers out are kept, its transfers in are scripted. */
class FakePhone {
  vendorId = 0x18d1;
  productId = 0x4ee7;
  manufacturerName: string | null = "Google";
  productName: string | null = "Pixel 8";
  serialNumber: string | null = "35161FDH2000GL";
  configuration: { configurationValue: number } | null = null;
  readonly configurations = [
    {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            {
              alternateSetting: 0,
              interfaceClass: 0xff,
              interfaceSubclass: 0x42,
              interfaceProtocol: 1,
              endpoints: [
                { endpointNumber: IN, direction: "in", type: "bulk", packetSize: PACKET_SIZE },
                { endpointNumber: OUT, direction: "out", type: "bulk", packetSize: PACKET_SIZE },
              ],
            },
          ],
        },
      ],
    },
  ];
  readonly calls: string[] = [];
  readonly out: Uint8Array[] = [];
  failOpen: Error | undefined;
  failClaim: Error | undefined;
  private readonly inTransfers: Uint8Array[] = [];
  private waiting: { resolve: (bytes: Uint8Array) => void; reject: (e: Error) => void }[] = [];

  open(): Promise<void> {
    this.calls.push("open");
    return this.failOpen === undefined ? Promise.resolve() : Promise.reject(this.failOpen);
  }

  close(): Promise<void> {
    this.calls.push("close");
    for (const { reject } of this.waiting.splice(0)) reject(new Error("closed"));
    return Promise.resolve();
  }

  selectConfiguration(value: number): Promise<void> {
    this.calls.push(`configuration ${value}`);
    this.configuration = { configurationValue: value };
    return Promise.resolve();
  }

  claimInterface(number: number): Promise<void> {
    this.calls.push(`claim ${number}`);
    return this.failClaim === undefined ? Promise.resolve() : Promise.reject(this.failClaim);
  }

  releaseInterface(number: number): Promise<void> {
    this.calls.push(`release ${number}`);
    return Promise.resolve();
  }

  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string }> {
    if (endpoint !== OUT) throw new Error(`Written to endpoint ${endpoint}.`);
    this.out.push(data.slice());
    return Promise.resolve({ status: "ok", bytesWritten: data.byteLength });
  }

  async transferIn(endpoint: number, length: number): Promise<{ status: string; data: DataView }> {
    if (endpoint !== IN) throw new Error(`Read from endpoint ${endpoint}.`);
    const next =
      this.inTransfers.shift() ??
      (await new Promise<Uint8Array>((resolve, reject) => this.waiting.push({ resolve, reject })));
    if (next.byteLength > length) throw new Error(`${next.byteLength} bytes for ${length}.`);
    return { status: "ok", data: new DataView(next.buffer, next.byteOffset, next.byteLength) };
  }

  /** The phone sends a packet: its header, then its payload, as transfers of their own. */
  sends(command: number, arg0 = 0, payload = new Uint8Array(0)): Uint8Array {
    const bytes = adbPacketBytes({ command, arg0, arg1: 0, dataLength: 0 }, payload);
    this.transfer(bytes.slice(0, 24));
    if (payload.byteLength > 0) this.transfer(bytes.slice(24));
    return bytes;
  }

  private transfer(bytes: Uint8Array): void {
    const waiter = this.waiting.shift();
    if (waiter === undefined) this.inTransfers.push(bytes);
    else waiter.resolve(bytes);
  }
}

class FakeUsb extends EventTarget {
  picked: FakePhone | DOMException;

  constructor(picked: FakePhone | DOMException) {
    super();
    this.picked = picked;
  }

  requestDevice(): Promise<FakePhone> {
    return this.picked instanceof FakePhone
      ? Promise.resolve(this.picked)
      : Promise.reject(this.picked);
  }

  unplugs(device: FakePhone): void {
    this.dispatchEvent(Object.assign(new Event("disconnect"), { device }));
  }
}

function transportFor(
  usb: FakeUsb | undefined,
  options: { secureContext?: boolean; userAgent?: string } = {},
) {
  return androidUsbTransport({
    usb: () => usb as unknown as USB | undefined,
    secureContext: () => options.secureContext ?? true,
    userAgent: () => options.userAgent ?? LINUX,
  });
}

/** What the relay was told: a line per call, with DATA's bytes kept. */
function recordingSink(): {
  readonly sink: DeviceRelaySink;
  readonly told: string[];
  readonly sent: Uint8Array[];
} {
  const told: string[] = [];
  const sent: Uint8Array[] = [];
  return {
    told,
    sent,
    sink: {
      send: (channel, bytes) => {
        told.push(`send ${channel}`);
        sent.push(bytes.slice());
      },
      close: (channel) => told.push(`close ${channel}`),
      open: (channel) => told.push(`open ${channel}`),
      pong: (id) => told.push(`pong ${id}`),
      fail: (problem) => told.push(`fail ${problem}`),
    },
  };
}

async function requested(phone = new FakePhone()): Promise<{
  readonly usb: FakeUsb;
  readonly phone: FakePhone;
  readonly device: RequestedDevice;
}> {
  const usb = new FakeUsb(phone);
  const device = await transportFor(usb).request();
  if (device === undefined) throw new Error("No phone picked.");
  return { usb, phone, device };
}

const settled = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function packet(command: number, arg0 = 0, payload = new Uint8Array(0)): Uint8Array {
  return adbPacketBytes({ command, arg0, arg1: 0, dataLength: 0 }, payload);
}

describe("an Android phone over USB", () => {
  it("opens the phone and claims its ADB interface as it is picked, naming and keying it", async () => {
    const { phone, device } = await requested();

    expect(phone.calls).toEqual(["open", "configuration 1", "claim 0"]);
    expect(device.name).toBe("Google Pixel 8");
    expect(device.deviceKey).toBe("usb:18d1:4ee7:35161FDH2000GL");
  });

  it("names a phone that names nothing Android phone", async () => {
    const phone = new FakePhone();
    phone.manufacturerName = null;
    phone.productName = null;

    expect((await requested(phone)).device.name).toBe("Android phone");
  });

  it("answers no phone when the picker closes with none picked", async () => {
    const usb = new FakeUsb(new DOMException("No device selected.", "NotFoundError"));

    await expect(transportFor(usb).request()).resolves.toBeUndefined();
  });

  it("refuses a phone with no serial number, before opening it", async () => {
    const phone = new FakePhone();
    phone.serialNumber = null;

    await expect(transportFor(new FakeUsb(phone)).request()).rejects.toThrow(NO_SERIAL_NUMBER);
    expect(phone.calls).toEqual([]);
  });

  it("says the phone is in use by adb when its interface can't be claimed, and lets it go", async () => {
    const phone = new FakePhone();
    phone.failClaim = new DOMException("Unable to claim interface.", "NetworkError");

    await expect(transportFor(new FakeUsb(phone)).request()).rejects.toThrow(PHONE_IN_USE);
    expect(phone.calls).toContain("close");
  });

  it("names the udev rule on Linux, or the WinUSB driver on Windows, when access is denied", async () => {
    const phone = new FakePhone();
    phone.failOpen = new DOMException("Access denied.", "SecurityError");

    const onLinux = transportFor(new FakeUsb(phone), { userAgent: LINUX }).request();
    await expect(onLinux).rejects.toThrow(
      'SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0660", GROUP="plugdev"',
    );
    const onWindows = transportFor(new FakeUsb(phone), { userAgent: WINDOWS }).request();
    await expect(onWindows).rejects.toThrow("the Google USB Driver");
    await expect(onWindows).rejects.not.toThrow("udev");
  });

  it("is greyed without WebUSB, as needing Chrome or Edge, or HTTPS on an insecure page", () => {
    expect(transportFor(undefined).unavailable).toBe(NEEDS_WEBUSB);
    expect(transportFor(undefined, { secureContext: false }).unavailable).toBe(
      NEEDS_SECURE_CONTEXT,
    );
    expect(transportFor(new FakeUsb(new FakePhone())).unavailable).toBeUndefined();
  });

  it("writes each of adb's packets to the phone as a header and a payload transfer", async () => {
    const { phone, device } = await requested();
    const { sink } = recordingSink();
    const transport = device.attach(sink);
    const write = packet(WRTE, 0, new Uint8Array(100).fill(1));
    const ready = packet(OKAY);

    transport.opened(1);
    // One packet and a half in a chunk, then the rest.
    const stream = new Uint8Array([...write, ...ready]);
    transport.received(1, stream.subarray(0, 140));
    transport.received(1, stream.subarray(140));
    await settled();

    expect(phone.out).toEqual([write.slice(0, 24), write.slice(24), ready]);
  });

  it("ends a payload on a whole USB packet with a zero-length transfer", async () => {
    const { phone, device } = await requested();
    const transport = device.attach(recordingSink().sink);
    const write = packet(WRTE, 0, new Uint8Array(PACKET_SIZE * 2).fill(2));

    transport.opened(1);
    transport.received(1, write);
    await settled();

    expect(phone.out.map(({ byteLength }) => byteLength)).toEqual([24, PACKET_SIZE * 2, 0]);
  });

  it("ends a connection whose header is garbled, sending none of it to the phone", async () => {
    const { phone, device } = await requested();
    const { sink, told } = recordingSink();
    const transport = device.attach(sink);

    transport.opened(1);
    transport.received(1, new TextEncoder().encode("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
    await settled();

    expect(told).toEqual(["close 1"]);
    expect(phone.out).toEqual([]);
  });

  it("sends the phone's packets, header and payload, into the live connection", async () => {
    const { phone, device } = await requested();
    const { sink, told, sent } = recordingSink();
    const transport = device.attach(sink);

    phone.sends(OKAY);
    await settled();
    expect(told).toEqual([]);

    transport.opened(1);
    const write = phone.sends(WRTE, 0, new TextEncoder().encode("shell output"));
    await settled();

    expect(told).toEqual(["send 1"]);
    expect(sent).toEqual([write]);
  });

  it("carries only the newest connection, closing the one before", async () => {
    const { phone, device } = await requested();
    const { sink, told } = recordingSink();
    const transport = device.attach(sink);

    transport.opened(1);
    transport.opened(2);
    transport.received(1, packet(OKAY));
    phone.sends(OKAY);
    await settled();

    expect(told).toEqual(["close 1", "send 2"]);
    expect(phone.out).toEqual([]);
    expect(phone.calls.filter((call) => call.startsWith("release"))).toEqual([]);
  });

  it("asks the user to allow USB debugging while the phone waits, until it lets adb in", async () => {
    const { phone, device } = await requested();
    const notices: (string | undefined)[] = [];
    device.onNotice?.((notice) => notices.push(notice));
    const transport = device.attach(recordingSink().sink);
    transport.opened(1);

    // adb says hello; the phone asks for a signature it doesn't know, then for adb's key.
    transport.received(1, packet(ADB_COMMANDS.connect, 0x01000001));
    phone.sends(ADB_COMMANDS.auth, ADB_AUTH_TYPES.token, new Uint8Array(20));
    await settled();
    transport.received(1, packet(ADB_COMMANDS.auth, ADB_AUTH_TYPES.signature, new Uint8Array(256)));
    phone.sends(ADB_COMMANDS.auth, ADB_AUTH_TYPES.token, new Uint8Array(20));
    await settled();
    expect(notices).toEqual([]);

    transport.received(
      1,
      packet(ADB_COMMANDS.auth, ADB_AUTH_TYPES.rsaPublicKey, new Uint8Array(700)),
    );
    expect(notices).toEqual([ALLOW_USB_DEBUGGING]);

    phone.sends(ADB_COMMANDS.connect, 0x01000001, new TextEncoder().encode("device::"));
    await settled();
    expect(notices).toEqual([ALLOW_USB_DEBUGGING, undefined]);
  });

  it("tells the relay when the phone is unplugged, and lets the phone go", async () => {
    const { usb, phone, device } = await requested();
    let unplugged = 0;
    device.onUnplugged(() => (unplugged += 1));
    device.attach(recordingSink().sink);

    usb.unplugs(new FakePhone());
    expect(unplugged).toBe(0);
    usb.unplugs(phone);
    await settled();

    expect(unplugged).toBe(1);
    expect(phone.calls.slice(-2)).toEqual(["release 0", "close"]);
  });

  it("releases the interface and closes the phone as the relay ends", async () => {
    const { phone, device } = await requested();
    const transport = device.attach(recordingSink().sink);

    transport.end();
    await settled();

    expect(phone.calls.slice(-2)).toEqual(["release 0", "close"]);
  });
});
