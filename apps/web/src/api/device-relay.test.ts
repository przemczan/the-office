import {
  DEVICE_FRAME_TYPES,
  encodeFrame,
  FrameReader,
  type DeviceFrame,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  openDeviceRelay,
  type DeviceRelaySink,
  type DeviceRelayState,
  type DeviceTransport,
  type RequestedDevice,
} from "./device-relay.ts";

const DEVICE_ID = "00000000-0000-4000-8000-0000000000d1";

/** A socket the test drives: what the page sends is kept, what the service sends is given. */
class FakeSocket extends EventTarget {
  readyState = 0;
  binaryType = "blob";
  readonly sent: (string | Uint8Array)[] = [];
  closedWith: number | undefined;

  constructor(readonly url: string) {
    super();
  }

  send(message: string | Uint8Array): void {
    if (this.readyState !== 1) throw new Error("The socket isn't open.");
    this.sent.push(message);
  }

  close(code?: number): void {
    this.closedWith = code;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code: code ?? 1005 }));
  }

  opens(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  receives(data: string | Uint8Array): void {
    const sentData = typeof data === "string" ? data : data.slice().buffer;
    this.dispatchEvent(new MessageEvent("message", { data: sentData }));
  }

  framesSent(): DeviceFrame[] {
    const reader = new FrameReader();
    return this.sent.flatMap((message) =>
      typeof message === "string" ? [] : reader.push(message),
    );
  }
}

/** A device that sends back whatever reaches it, on the channel it came on. */
function loopbackDevice(): {
  readonly device: RequestedDevice;
  readonly heard: string[];
  readonly unplug: () => void;
} {
  const heard: string[] = [];
  let unplugged: (() => void) | undefined;
  const device: RequestedDevice = {
    name: "Pixel 8",
    deviceKey: "18d1:4ee7:serial",
    attach: (relay: DeviceRelaySink): DeviceTransport => ({
      opened: (channel) => heard.push(`opened ${channel}`),
      received: (channel, bytes) => {
        heard.push(`received ${channel}`);
        relay.send(channel, bytes);
      },
      closed: (channel) => heard.push(`closed ${channel}`),
      end: () => heard.push("ended"),
    }),
    onUnplugged: (listener) => {
      unplugged = listener;
      return () => (unplugged = undefined);
    },
  };
  return { device, heard, unplug: () => unplugged?.() };
}

function opened(device: RequestedDevice): { socket: FakeSocket; states: DeviceRelayState[] } {
  let socket: FakeSocket | undefined;
  const relay = openDeviceRelay(DEVICE_ID, device, {
    location: { protocol: "https:", host: "office.example" },
    openWebSocket: (url) => {
      socket = new FakeSocket(url);
      return socket as unknown as WebSocket;
    },
  });
  const states: DeviceRelayState[] = [];
  relay.onState((state) => states.push(state));
  if (socket === undefined) throw new Error("No socket opened.");
  socket.opens();
  return { socket, states };
}

describe("a device's relay", () => {
  it("opens the device's signed-in socket on the page's own host, reading bytes", () => {
    const { socket } = opened(loopbackDevice().device);

    expect(socket.url).toBe(`wss://office.example/api/devices/${DEVICE_ID}/relay`);
    expect(socket.binaryType).toBe("arraybuffer");
  });

  it("carries OPEN, DATA and CLOSE to the transport, and its bytes back as a DATA frame", () => {
    const loopback = loopbackDevice();
    const { socket } = opened(loopback.device);
    const bytes = new Uint8Array([0x43, 0x4e, 0x58, 0x4e, 0, 1, 2, 255]);

    socket.receives(
      encodeFrame({ type: DEVICE_FRAME_TYPES.open, channel: 3, payload: new Uint8Array(0) }),
    );
    const frame = encodeFrame({ type: DEVICE_FRAME_TYPES.data, channel: 3, payload: bytes });
    // Split across two messages: the reader joins them.
    socket.receives(frame.slice(0, 5));
    socket.receives(frame.slice(5));
    socket.receives(
      encodeFrame({ type: DEVICE_FRAME_TYPES.close, channel: 3, payload: new Uint8Array(0) }),
    );

    expect(loopback.heard).toEqual(["opened 3", "received 3", "closed 3"]);
    const [echoed] = socket.framesSent();
    expect(echoed?.type).toBe(DEVICE_FRAME_TYPES.data);
    expect(echoed?.channel).toBe(3);
    expect([...(echoed?.payload ?? [])]).toEqual([...bytes]);
  });

  it("sends what the device sends before the socket opens once it opens", () => {
    let socket: FakeSocket | undefined;
    let sink: DeviceRelaySink | undefined;
    openDeviceRelay(
      DEVICE_ID,
      {
        ...loopbackDevice().device,
        attach: (relay) => {
          sink = relay;
          return { opened: () => {}, received: () => {}, closed: () => {}, end: () => {} };
        },
      },
      {
        location: { protocol: "http:", host: "localhost:4310" },
        openWebSocket: (url) => {
          socket = new FakeSocket(url);
          return socket as unknown as WebSocket;
        },
      },
    );

    sink?.open(7);
    socket?.opens();

    expect(socket?.url).toBe(`ws://localhost:4310/api/devices/${DEVICE_ID}/relay`);
    expect(socket?.framesSent().map(({ type, channel }) => [type, channel])).toEqual([
      [DEVICE_FRAME_TYPES.open, 7],
    ]);
  });

  it("tells the service when the device is unplugged, then closes and ends the transport", () => {
    const loopback = loopbackDevice();
    const { socket, states } = opened(loopback.device);

    loopback.unplug();

    expect(socket.sent).toEqual([JSON.stringify({ type: "unplugged" })]);
    expect(socket.closedWith).toBe(1000);
    expect(loopback.heard).toEqual(["ended"]);
    expect(states).toEqual([{ type: "ended", code: 1000 }]);
  });

  it("passes on the device's state as the service sends it, ignoring what it can't read", () => {
    const { socket, states } = opened(loopbackDevice().device);

    socket.receives("not json");
    socket.receives(
      JSON.stringify({ type: "state", state: "connected", endpoint: "127.0.0.1:5037" }),
    );

    expect(states).toEqual([{ type: "state", state: "connected", endpoint: "127.0.0.1:5037" }]);
  });

  it("ends on a frame it can't read", () => {
    const loopback = loopbackDevice();
    const { socket } = opened(loopback.device);

    socket.receives(new Uint8Array([99, 0, 0, 0, 1, 0, 0, 0, 0]));

    expect(socket.closedWith).toBe(1003);
    expect(loopback.heard).toEqual(["ended"]);
  });
});
