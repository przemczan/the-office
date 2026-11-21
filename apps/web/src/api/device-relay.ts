// A Connected device's relay in the browser (spec 2.13, "The relay"): one signed-in WebSocket per
// device, carrying device frames (`device-frames.ts`) between the device's transport (WebUSB, Web
// Serial) and the Office device helper in the Task's run environment.
import {
  DEVICE_FRAME_TYPES,
  deviceRelayPath,
  deviceRelayServerMessageSchema,
  encodeFrame,
  FrameReader,
  type ConnectedDeviceKind,
  type ConnectedDeviceState,
  type DeviceFrameType,
  type DeviceRelayClientMessage,
} from "@the-office/contracts";

/** What a transport gives the relay: the device's side of each channel, toward the run environment. */
export interface DeviceRelaySink {
  /** Bytes the device sent on `channel`. */
  send(channel: number, bytes: Uint8Array): void;
  /** The device closed `channel`. */
  close(channel: number): void;
  /** The device opened `channel` itself, for a transport whose device starts connections. */
  open(channel: number): void;
}

/** A device attached to a relay: what the run environment does on each channel reaches it here. */
export interface DeviceTransport {
  /** The run environment opened a connection on `channel`. */
  opened(channel: number): void;
  /** Bytes for the device on `channel`. */
  received(channel: number, bytes: Uint8Array): void;
  /** The run environment closed `channel`. */
  closed(channel: number): void;
  /** The relay ended: release the device. */
  end(): void;
}

/** A device the user picked in the browser's own picker, not attached yet. */
export interface RequestedDevice {
  /** Its name, as the device reports it. */
  readonly name: string;
  /** The opaque key its kind defines, such as its USB vendor, product and serial number. */
  readonly deviceKey: string;
  /** Attaches it to a relay, which then carries its channels. */
  attach(relay: DeviceRelaySink): DeviceTransport;
  /** Calls `listener` when the device goes away; answers a function that stops listening. */
  onUnplugged(listener: () => void): () => void;
}

/** The kinds the browser reaches over USB through the relay; wireless debugging needs no relay. */
export type UsbDeviceKind = Exclude<ConnectedDeviceKind, "android-wireless">;

/** One kind's way to reach a device, as WebUSB for an Android phone. */
export interface DeviceTransportProvider {
  readonly kind: UsbDeviceKind;
  /** Opens the browser's picker; undefined when the user picked none. */
  request(): Promise<RequestedDevice | undefined>;
}

// The kinds' own Tasks register their transports; none is registered in this build.
const providers = new Map<UsbDeviceKind, DeviceTransportProvider>();
const providerListeners = new Set<() => void>();
let providersShown: readonly DeviceTransportProvider[] = [];

/** Registers a kind's transport; answers a function that takes it away again. */
export function registerDeviceTransport(provider: DeviceTransportProvider): () => void {
  providers.set(provider.kind, provider);
  providersChanged();
  return () => {
    if (providers.get(provider.kind) !== provider) return;
    providers.delete(provider.kind);
    providersChanged();
  };
}

/** The registered transports, one per kind; the same array until one is registered or removed. */
export function deviceTransportProviders(): readonly DeviceTransportProvider[] {
  return providersShown;
}

/** For `useSyncExternalStore`: hears each change of the registered transports. */
export function subscribeToDeviceTransports(listener: () => void): () => void {
  providerListeners.add(listener);
  return () => providerListeners.delete(listener);
}

function providersChanged(): void {
  providersShown = [...providers.values()];
  for (const listener of providerListeners) listener();
}

/** What the relay says: the device's state as the service sends it, or that the socket ended. */
export type DeviceRelayState =
  | {
      readonly type: "state";
      readonly state: ConnectedDeviceState;
      readonly endpoint: string | null;
    }
  | { readonly type: "ended"; readonly code: number };

export interface DeviceRelay {
  /** Closes the socket; the service ends the device as tab closed. */
  close(): void;
  /** Tells the service the device went away, so it ends as device unplugged, then closes. */
  unplugged(): void;
  /** Hears the relay's states; answers a function that stops listening. */
  onState(listener: (state: DeviceRelayState) => void): () => void;
}

export interface DeviceRelayOptions {
  /** Where the page is, for the socket's address; the browser's own by default. */
  readonly location?: Pick<Location, "protocol" | "host">;
  /** Opens the socket; the browser's `WebSocket` by default (tests give their own). */
  readonly openWebSocket?: (url: string) => WebSocket;
}

// A socket's ready states, as `WebSocket` numbers them.
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const NORMAL_CLOSE = 1000;
const UNSUPPORTED_DATA_CLOSE = 1003;

/**
 * Opens the device's relay and attaches the device to it: OPEN, DATA and CLOSE from the service go
 * to its transport, and what the transport sends goes back as frames. What is sent before the
 * socket opens waits for it.
 */
export function openDeviceRelay(
  deviceId: string,
  device: RequestedDevice,
  options: DeviceRelayOptions = {},
): DeviceRelay {
  const socket = (options.openWebSocket ?? ((url) => new WebSocket(url)))(
    relayUrl(options.location ?? window.location, deviceId),
  );
  socket.binaryType = "arraybuffer";
  const reader = new FrameReader();
  const listeners = new Set<(state: DeviceRelayState) => void>();
  const waiting: (Uint8Array<ArrayBuffer> | string)[] = [];
  let closeWhenSent = false;
  let ended = false;

  const sendNow = (message: Uint8Array<ArrayBuffer> | string): void => {
    if (socket.readyState === SOCKET_OPEN) socket.send(message);
    else if (socket.readyState === SOCKET_CONNECTING) waiting.push(message);
  };
  const sendFrame = (type: DeviceFrameType, channel: number, payload: Uint8Array): void => {
    // A frame of its own buffer, as the socket sends only an ArrayBuffer's bytes.
    if (!ended) sendNow(new Uint8Array(encodeFrame({ type, channel, payload })));
  };
  let transport: DeviceTransport;
  try {
    transport = device.attach({
      send: (channel, bytes) => sendFrame(DEVICE_FRAME_TYPES.data, channel, bytes),
      close: (channel) => sendFrame(DEVICE_FRAME_TYPES.close, channel, new Uint8Array(0)),
      open: (channel) => sendFrame(DEVICE_FRAME_TYPES.open, channel, new Uint8Array(0)),
    });
  } catch (error) {
    // A device that can't be attached leaves no socket open behind it.
    socket.close(NORMAL_CLOSE);
    throw error;
  }
  const close = (code = NORMAL_CLOSE): void => {
    if (socket.readyState === SOCKET_CONNECTING) closeWhenSent = true;
    else socket.close(code);
  };
  const unplugged = (): void => {
    if (ended) return;
    const message: DeviceRelayClientMessage = { type: "unplugged" };
    sendNow(JSON.stringify(message));
    close();
  };
  const stopHearingUnplugged = device.onUnplugged(unplugged);

  socket.addEventListener("open", () => {
    for (const message of waiting.splice(0)) socket.send(message);
    if (closeWhenSent) socket.close(NORMAL_CLOSE);
  });
  socket.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
    if (typeof data === "string") {
      const parsed = deviceRelayServerMessageSchema.safeParse(jsonOf(data));
      if (parsed.success) tell(parsed.data);
      return;
    }
    if (!(data instanceof ArrayBuffer)) return;
    try {
      for (const frame of reader.push(new Uint8Array(data))) {
        if (frame.type === DEVICE_FRAME_TYPES.open) transport.opened(frame.channel);
        else if (frame.type === DEVICE_FRAME_TYPES.data) {
          transport.received(frame.channel, frame.payload);
        } else if (frame.type === DEVICE_FRAME_TYPES.close) transport.closed(frame.channel);
      }
    } catch {
      // A frame the relay can't read ends it: the stream can't be read on.
      close(UNSUPPORTED_DATA_CLOSE);
    }
  });
  socket.addEventListener("close", ({ code }: CloseEvent) => {
    if (ended) return;
    ended = true;
    stopHearingUnplugged();
    transport.end();
    tell({ type: "ended", code });
  });

  function tell(state: DeviceRelayState): void {
    for (const listener of listeners) listener(state);
  }

  return {
    close: () => close(),
    unplugged,
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function relayUrl(location: Pick<Location, "protocol" | "host">, deviceId: string): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}${deviceRelayPath(deviceId)}`;
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
