import type {
  DeviceRelaySink,
  DeviceTransport,
  DeviceTransportProvider,
  RequestedDevice,
} from "../../../api/device-relay.ts";
import {
  ADB_HEADER_LENGTH,
  AdbAuthorisation,
  adbHeaderOf,
  AdbPacketReader,
  needsZeroLengthTransfer,
  type AdbPacket,
} from "./adb-packets.ts";
import {
  accessDeniedWords,
  ALLOW_USB_DEBUGGING,
  ANDROID_PHONE,
  browserSystemOf,
  hex4,
  NEEDS_SECURE_CONTEXT,
  NEEDS_WEBUSB,
  NO_SERIAL_NUMBER,
  NO_USB_DEBUGGING,
  PHONE_IN_USE,
} from "./android-usb-words.ts";

/** The interface adbd offers over USB: vendor-specific class, ADB subclass, protocol 1. */
const ADB_INTERFACE = { classCode: 0xff, subclassCode: 0x42, protocolCode: 1 } as const;

/** What the transport reads of the browser; the browser's own by default (tests give theirs). */
export interface AndroidUsbOptions {
  /** WebUSB; undefined where the browser has none. */
  readonly usb?: () => USB | undefined;
  readonly secureContext?: () => boolean;
  readonly userAgent?: () => string;
}

/**
 * An Android phone over USB (spec 2.13, "The relay"): WebUSB opens the phone's ADB interface and
 * the browser passes ADB's packets unchanged between its bulk endpoints and the relay. Each
 * connection adb makes in the run environment is a channel; only the newest is carried.
 */
export function androidUsbTransport(options: AndroidUsbOptions = {}): DeviceTransportProvider {
  const usbOf = options.usb ?? browserUsb;
  const secureContextOf = options.secureContext ?? (() => globalThis.isSecureContext !== false);
  const userAgentOf = options.userAgent ?? (() => globalThis.navigator?.userAgent ?? "");
  return {
    kind: "android-usb",
    get unavailable() {
      if (usbOf() !== undefined) return undefined;
      return secureContextOf() ? NEEDS_WEBUSB : NEEDS_SECURE_CONTEXT;
    },
    request: async () => {
      const usb = usbOf();
      if (usb === undefined)
        throw new Error(secureContextOf() ? NEEDS_WEBUSB : NEEDS_SECURE_CONTEXT);
      let device: USBDevice;
      try {
        device = await usb.requestDevice({ filters: [ADB_INTERFACE] });
      } catch (error) {
        if (isNamed(error, "NotFoundError")) return undefined;
        throw error;
      }
      if (device.serialNumber === null || device.serialNumber === "") {
        throw new Error(NO_SERIAL_NUMBER);
      }
      const adb = await opened(device, userAgentOf());
      return requestedPhone(usb, device, device.serialNumber, adb);
    },
    remembered: async (deviceKey) => {
      const usb = usbOf();
      if (usb === undefined) return undefined;
      const device = (await usb.getDevices()).find(
        (allowed) =>
          allowed.serialNumber !== null &&
          allowed.serialNumber !== undefined &&
          phoneKeyOf(allowed, allowed.serialNumber) === deviceKey,
      );
      if (device?.serialNumber === undefined || device.serialNumber === null) return undefined;
      const adb = await opened(device, userAgentOf());
      return requestedPhone(usb, device, device.serialNumber, adb);
    },
  };
}

/** A phone's device key: `usb:<vendor>:<product>:<serial number>`. */
function phoneKeyOf(device: USBDevice, serialNumber: string): string {
  return `usb:${hex4(device.vendorId)}:${hex4(device.productId)}:${serialNumber}`;
}

function browserUsb(): USB | undefined {
  return (globalThis.navigator as Partial<Navigator> | undefined)?.usb ?? undefined;
}

/** The phone's ADB interface, claimed: its number and its bulk endpoints. */
interface AdbInterface {
  readonly interfaceNumber: number;
  readonly inEndpoint: number;
  readonly outEndpoint: number;
  readonly outPacketSize: number;
}

/** Opens the phone and claims its ADB interface, in words when the system or adb won't let it. */
async function opened(device: USBDevice, userAgent: string): Promise<AdbInterface> {
  try {
    await device.open();
  } catch (error) {
    if (isNamed(error, "SecurityError")) {
      throw new Error(accessDeniedWords(device.vendorId, browserSystemOf(userAgent)), {
        cause: error,
      });
    }
    if (isNamed(error, "NetworkError") || isNamed(error, "InvalidStateError")) {
      throw new Error(PHONE_IN_USE, { cause: error });
    }
    throw error;
  }
  try {
    const found = adbInterfaceOf(device);
    if (found === undefined) throw new Error(NO_USB_DEBUGGING);
    if (device.configuration?.configurationValue !== found.configurationValue) {
      await device.selectConfiguration(found.configurationValue);
    }
    try {
      await device.claimInterface(found.adb.interfaceNumber);
      if (found.alternateSetting !== 0) {
        await device.selectAlternateInterface(found.adb.interfaceNumber, found.alternateSetting);
      }
    } catch (error) {
      if (["SecurityError", "NetworkError", "InvalidStateError"].some((n) => isNamed(error, n))) {
        throw new Error(PHONE_IN_USE, { cause: error });
      }
      throw error;
    }
    return found.adb;
  } catch (error) {
    await device.close().catch(() => undefined);
    throw error;
  }
}

function adbInterfaceOf(
  device: USBDevice,
):
  | { readonly configurationValue: number; readonly alternateSetting: number; adb: AdbInterface }
  | undefined {
  for (const configuration of device.configurations) {
    for (const usbInterface of configuration.interfaces) {
      for (const alternate of usbInterface.alternates) {
        if (
          alternate.interfaceClass !== ADB_INTERFACE.classCode ||
          alternate.interfaceSubclass !== ADB_INTERFACE.subclassCode ||
          alternate.interfaceProtocol !== ADB_INTERFACE.protocolCode
        ) {
          continue;
        }
        const bulk = alternate.endpoints.filter(({ type }) => type === "bulk");
        const inEndpoint = bulk.find(({ direction }) => direction === "in");
        const outEndpoint = bulk.find(({ direction }) => direction === "out");
        if (inEndpoint === undefined || outEndpoint === undefined) continue;
        return {
          configurationValue: configuration.configurationValue,
          alternateSetting: alternate.alternateSetting,
          adb: {
            interfaceNumber: usbInterface.interfaceNumber,
            inEndpoint: inEndpoint.endpointNumber,
            outEndpoint: outEndpoint.endpointNumber,
            outPacketSize: outEndpoint.packetSize,
          },
        };
      }
    }
  }
  return undefined;
}

/** The phone picked and claimed, until it is attached to a relay or let go. */
function requestedPhone(
  usb: USB,
  device: USBDevice,
  serialNumber: string,
  adb: AdbInterface,
): RequestedDevice {
  const unpluggedListeners = new Set<() => void>();
  const noticeListeners = new Set<(notice: string | undefined) => void>();
  let notice: string | undefined;
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    usb.removeEventListener("disconnect", onDisconnect);
    setNotice(undefined);
    void device
      .releaseInterface(adb.interfaceNumber)
      .catch(() => undefined)
      .then(() => device.close())
      .catch(() => undefined);
  };
  function onDisconnect(event: USBConnectionEvent): void {
    if (event.device !== device) return;
    release();
    for (const listener of unpluggedListeners) listener();
  }
  usb.addEventListener("disconnect", onDisconnect);
  function setNotice(next: string | undefined): void {
    if (next === notice) return;
    notice = next;
    for (const listener of noticeListeners) listener(next);
  }

  return {
    name: phoneNameOf(device),
    deviceKey: phoneKeyOf(device, serialNumber),
    attach: (sink) =>
      attachedPhone(device, adb, sink, {
        released: () => released,
        release,
        authorisation: (waiting) => setNotice(waiting ? ALLOW_USB_DEBUGGING : undefined),
      }),
    onUnplugged: (listener) => {
      unpluggedListeners.add(listener);
      return () => unpluggedListeners.delete(listener);
    },
    onNotice: (listener) => {
      noticeListeners.add(listener);
      if (notice !== undefined) listener(notice);
      return () => noticeListeners.delete(listener);
    },
    release,
  };
}

function phoneNameOf(device: USBDevice): string {
  const maker = device.manufacturerName?.trim() ?? "";
  const product = device.productName?.trim() ?? "";
  if (product === "") return maker === "" ? ANDROID_PHONE : maker;
  if (maker === "" || product.toLowerCase().startsWith(maker.toLowerCase())) return product;
  return `${maker} ${product}`;
}

/**
 * The phone on a relay: adb's bytes on the live channel are cut into packets and written to the
 * phone one transfer at a time, the phone's packets read and sent into the live channel.
 */
function attachedPhone(
  device: USBDevice,
  adb: AdbInterface,
  sink: DeviceRelaySink,
  phone: {
    readonly released: () => boolean;
    readonly release: () => void;
    readonly authorisation: (waitingForUser: boolean) => void;
  },
): DeviceTransport {
  const authorisation = new AdbAuthorisation();
  let live: { readonly channel: number; readonly reader: AdbPacketReader } | undefined;
  let writing: Promise<unknown> = Promise.resolve();

  const endLive = (channel: number): void => {
    if (live?.channel !== channel) return;
    live = undefined;
    sink.close(channel);
  };
  const write = (channel: number, packet: AdbPacket): void => {
    const transfers: Uint8Array<ArrayBuffer>[] = [packet.headerBytes];
    if (packet.payload.byteLength > 0) transfers.push(packet.payload);
    if (needsZeroLengthTransfer(packet.payload.byteLength, adb.outPacketSize)) {
      transfers.push(new Uint8Array(0));
    }
    writing = writing.then(() => writeTransfers(channel, transfers));
  };
  const writeTransfers = async (
    channel: number,
    transfers: readonly Uint8Array<ArrayBuffer>[],
  ): Promise<void> => {
    for (const bytes of transfers) {
      if (phone.released()) return;
      try {
        await device.transferOut(adb.outEndpoint, bytes);
      } catch {
        // The phone took no more: the connection it was for can't go on.
        endLive(channel);
        return;
      }
    }
  };
  const toldAuthorisation = (): void => phone.authorisation(authorisation.waitingForUser);

  void (async () => {
    while (!phone.released()) {
      // A relay with no room holds the phone's next read until its socket has sent what it holds.
      await sink.writable();
      const packet = await readPacket(device, adb.inEndpoint);
      if (packet === "ended") return;
      if (packet === undefined) continue;
      authorisation.fromPhone(packet.header);
      toldAuthorisation();
      // Read while no connection is live, a packet has no one to go to.
      if (live !== undefined) sink.send(live.channel, packet.bytes);
    }
  })();

  return {
    opened: (channel) => {
      if (live !== undefined) sink.close(live.channel);
      live = { channel, reader: new AdbPacketReader() };
    },
    received: (channel, bytes) => {
      if (live?.channel !== channel) return;
      const { reader } = live;
      for (const packet of reader.push(bytes)) {
        authorisation.fromHost(packet.header);
        write(channel, packet);
      }
      toldAuthorisation();
      // A garbled header: what follows isn't ADB, so none of it goes to the phone.
      if (reader.garbled) endLive(channel);
    },
    closed: (channel) => {
      if (live?.channel === channel) live = undefined;
    },
    end: () => {
      live = undefined;
      phone.release();
    },
  };
}

/**
 * The phone's next packet, its header and payload read as their own transfers: undefined for a
 * transfer that wasn't one (skipped), "ended" once the phone can't be read.
 */
async function readPacket(
  device: USBDevice,
  endpoint: number,
): Promise<
  { readonly header: AdbPacket["header"]; readonly bytes: Uint8Array } | undefined | "ended"
> {
  try {
    const headerBytes = await transferredIn(device, endpoint, ADB_HEADER_LENGTH);
    if (headerBytes === undefined) return undefined;
    const header = adbHeaderOf(headerBytes);
    if (header === undefined) return undefined;
    const bytes = new Uint8Array(ADB_HEADER_LENGTH + header.dataLength);
    bytes.set(headerBytes);
    let at = ADB_HEADER_LENGTH;
    while (at < bytes.byteLength) {
      const payload = await transferredIn(device, endpoint, bytes.byteLength - at);
      if (payload === undefined) return undefined;
      bytes.set(payload, at);
      at += payload.byteLength;
    }
    return { header, bytes };
  } catch {
    return "ended";
  }
}

/** One transfer in; undefined when it brought nothing usable, after clearing a stall. */
async function transferredIn(
  device: USBDevice,
  endpoint: number,
  length: number,
): Promise<Uint8Array | undefined> {
  const result = await device.transferIn(endpoint, length);
  if (result.status === "stall") {
    await device.clearHalt("in", endpoint);
    return undefined;
  }
  if (result.status !== "ok" || result.data === undefined || result.data.byteLength === 0) {
    return undefined;
  }
  const { buffer, byteOffset, byteLength } = result.data;
  return new Uint8Array(buffer, byteOffset, Math.min(byteLength, length));
}

function isNamed(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}
