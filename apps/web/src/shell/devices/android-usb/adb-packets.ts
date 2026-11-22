// ADB's packets as they pass between adb in the run environment and the phone (spec 2.13, "The
// relay"). The browser runs no ADB: it re-cuts the TCP byte stream into USB transfers and reads
// only what it needs to tell the user to allow USB debugging.

/** A packet's header: six little-endian 32-bit words. */
export const ADB_HEADER_LENGTH = 24;

/** The largest payload adbd takes (`MAX_PAYLOAD`); a header naming more is garbled. */
export const ADB_MAX_PAYLOAD = 1024 * 1024;

/** The commands the browser reads. */
export const ADB_COMMANDS = {
  /** CNXN: the phone answers it once it lets adb in. */
  connect: 0x4e584e43,
  /** AUTH: the phone asks for a signature, and adb sends one or its public key. */
  auth: 0x48545541,
} as const;

/** AUTH's arg0. */
export const ADB_AUTH_TYPES = { token: 1, signature: 2, rsaPublicKey: 3 } as const;

export interface AdbHeader {
  readonly command: number;
  readonly arg0: number;
  readonly arg1: number;
  readonly dataLength: number;
}

/** A whole packet, its header's bytes and its payload's as they came. */
export interface AdbPacket {
  readonly header: AdbHeader;
  readonly headerBytes: Uint8Array<ArrayBuffer>;
  readonly payload: Uint8Array<ArrayBuffer>;
}

/** Reads a header; undefined when it isn't one (its magic isn't its command's complement). */
export function adbHeaderOf(bytes: Uint8Array): AdbHeader | undefined {
  if (bytes.byteLength !== ADB_HEADER_LENGTH) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const command = view.getUint32(0, true);
  const dataLength = view.getUint32(12, true);
  const magic = view.getUint32(20, true);
  if ((command ^ 0xffffffff) >>> 0 !== magic || dataLength > ADB_MAX_PAYLOAD) return undefined;
  return { command, arg0: view.getUint32(4, true), arg1: view.getUint32(8, true), dataLength };
}

/**
 * Cuts a byte stream into packets, however its chunks split or merge them. Once a header is
 * garbled the stream can't be read on: `garbled` holds and nothing more is read.
 */
export class AdbPacketReader {
  private buffered = new Uint8Array(0);
  private header: { readonly header: AdbHeader; readonly bytes: Uint8Array<ArrayBuffer> } | null =
    null;
  #garbled = false;

  get garbled(): boolean {
    return this.#garbled;
  }

  /** The packets `chunk` completes, in order; those before a garbled header too. */
  push(chunk: Uint8Array): AdbPacket[] {
    if (this.#garbled) return [];
    this.buffered = joined(this.buffered, chunk);
    const packets: AdbPacket[] = [];
    let at = 0;
    for (;;) {
      if (this.header === null) {
        if (this.buffered.byteLength - at < ADB_HEADER_LENGTH) break;
        const bytes = this.buffered.slice(at, at + ADB_HEADER_LENGTH);
        const header = adbHeaderOf(bytes);
        if (header === undefined) {
          this.#garbled = true;
          this.buffered = new Uint8Array(0);
          return packets;
        }
        this.header = { header, bytes };
        at += ADB_HEADER_LENGTH;
      }
      const { header, bytes } = this.header;
      if (this.buffered.byteLength - at < header.dataLength) break;
      packets.push({
        header,
        headerBytes: bytes,
        payload: this.buffered.slice(at, at + header.dataLength),
      });
      at += header.dataLength;
      this.header = null;
    }
    this.buffered = this.buffered.slice(at);
    return packets;
  }
}

/**
 * Whether a payload of `length` bytes needs a zero-length transfer after it: a bulk transfer
 * ending on a whole packet doesn't end until a short one comes.
 */
export function needsZeroLengthTransfer(length: number, packetSize: number): boolean {
  return length > 0 && packetSize > 0 && length % packetSize === 0;
}

/**
 * Whether the phone is waiting for the user to allow USB debugging, read from the packets both
 * ways: the phone asked for a signature (AUTH TOKEN) and adb answered with its public key (AUTH
 * RSAPUBLICKEY), so the phone shows its prompt; its CNXN says it let adb in.
 */
export class AdbAuthorisation {
  private asked = false;
  #waitingForUser = false;

  get waitingForUser(): boolean {
    return this.#waitingForUser;
  }

  /** A packet the phone sent. */
  fromPhone(header: AdbHeader): void {
    if (header.command === ADB_COMMANDS.connect) {
      this.asked = false;
      this.#waitingForUser = false;
    } else if (header.command === ADB_COMMANDS.auth && header.arg0 === ADB_AUTH_TYPES.token) {
      this.asked = true;
    }
  }

  /** A packet adb sent towards the phone. */
  fromHost(header: AdbHeader): void {
    if (
      this.asked &&
      header.command === ADB_COMMANDS.auth &&
      header.arg0 === ADB_AUTH_TYPES.rsaPublicKey
    ) {
      this.#waitingForUser = true;
    }
  }
}

/** A packet's bytes: its header, then its payload. */
export function adbPacketBytes(
  header: AdbHeader,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(ADB_HEADER_LENGTH + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, header.command, true);
  view.setUint32(4, header.arg0, true);
  view.setUint32(8, header.arg1, true);
  view.setUint32(12, payload.byteLength, true);
  view.setUint32(16, checksumOf(payload), true);
  view.setUint32(20, (header.command ^ 0xffffffff) >>> 0, true);
  bytes.set(payload, ADB_HEADER_LENGTH);
  return bytes;
}

// adb's old checksum, the payload's bytes summed; newer adbd ignores it.
function checksumOf(payload: Uint8Array): number {
  let sum = 0;
  for (const byte of payload) sum = (sum + byte) >>> 0;
  return sum;
}

function joined(first: Uint8Array, second: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(first.byteLength + second.byteLength);
  bytes.set(first);
  bytes.set(second, first.byteLength);
  return bytes;
}
