import {
  controlFrame,
  controlPayload,
  DEVICE_FRAME_TYPES,
  devicePingSchema,
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
    release: () => heard.push("released"),
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

  it("tells the service the device's problem when the transport fails, then closes, once", () => {
    let sink: DeviceRelaySink | undefined;
    const loopback = loopbackDevice();
    const { socket, states } = opened({
      ...loopback.device,
      attach: (relay) => {
        sink = relay;
        return loopback.device.attach(relay);
      },
    });

    sink?.fail("The browser couldn't open the board.");
    sink?.fail("A later problem.");
    loopback.unplug();

    expect(socket.sent).toEqual([
      JSON.stringify({ type: "error", problem: "The browser couldn't open the board." }),
    ]);
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

  it("carries SETTINGS, SIGNALS and PING to the transport in order with DATA, leaving out malformed ones", () => {
    const heard: string[] = [];
    let sink: DeviceRelaySink | undefined;
    const { socket } = opened({
      ...loopbackDevice().device,
      attach: (relay) => {
        sink = relay;
        return {
          opened: () => {},
          received: (channel, bytes) => heard.push(`data ${channel} ${[...bytes].join(",")}`),
          closed: () => {},
          end: () => {},
          settings: (settings) => heard.push(`settings ${settings.baudRate}`),
          signals: (signals) =>
            heard.push(`signals ${signals.dataTerminalReady} ${signals.requestToSend}`),
          ping: (id) => {
            heard.push(`ping ${id}`);
            sink?.pong(id);
          },
        };
      },
    });
    const settings = {
      baudRate: 57_600,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
    } as const;

    socket.receives(
      new Uint8Array([
        ...encodeFrame(controlFrame(DEVICE_FRAME_TYPES.settings, settings)),
        ...encodeFrame({ type: DEVICE_FRAME_TYPES.data, channel: 1, payload: new Uint8Array([7]) }),
        ...encodeFrame(
          controlFrame(DEVICE_FRAME_TYPES.signals, {
            dataTerminalReady: true,
            requestToSend: false,
          }),
        ),
        ...encodeFrame(controlFrame(DEVICE_FRAME_TYPES.settings, { baudRate: "fast" })),
        ...encodeFrame({
          type: DEVICE_FRAME_TYPES.ping,
          channel: 0,
          payload: new TextEncoder().encode("not json"),
        }),
        ...encodeFrame(controlFrame(DEVICE_FRAME_TYPES.ping, { id: 4 })),
      ]),
    );

    expect(heard).toEqual(["settings 57600", "data 1 7", "signals true false", "ping 4"]);
    const [pong] = socket.framesSent();
    expect(pong?.type).toBe(DEVICE_FRAME_TYPES.pong);
    expect(pong?.channel).toBe(0);
    expect(pong === undefined ? undefined : controlPayload(pong, devicePingSchema)).toEqual({
      id: 4,
    });
  });

  it("leaves control frames out for a transport that has no handler for them", () => {
    const loopback = loopbackDevice();
    const { socket } = opened(loopback.device);

    socket.receives(encodeFrame(controlFrame(DEVICE_FRAME_TYPES.ping, { id: 1 })));

    expect(loopback.heard).toEqual([]);
    expect(socket.framesSent()).toEqual([]);
    expect(socket.closedWith).toBeUndefined();
  });

  it("ends on a frame it can't read", () => {
    const loopback = loopbackDevice();
    const { socket } = opened(loopback.device);

    socket.receives(new Uint8Array([99, 0, 0, 0, 1, 0, 0, 0, 0]));

    expect(socket.closedWith).toBe(1003);
    expect(loopback.heard).toEqual(["ended"]);
  });
});
