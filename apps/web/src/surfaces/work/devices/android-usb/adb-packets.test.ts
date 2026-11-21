import { describe, expect, it } from "vitest";
import {
  ADB_AUTH_TYPES,
  ADB_COMMANDS,
  AdbAuthorisation,
  adbPacketBytes,
  AdbPacketReader,
  needsZeroLengthTransfer,
  type AdbHeader,
  type AdbPacket,
} from "./adb-packets.ts";

const WRTE = 0x45545257;
const OKAY = 0x59414b4f;

const hello = adbPacketBytes(
  { command: ADB_COMMANDS.connect, arg0: 0x01000001, arg1: 256 * 1024, dataLength: 0 },
  new TextEncoder().encode("host::\0"),
);
const ready = adbPacketBytes({ command: OKAY, arg0: 1, arg1: 2, dataLength: 0 });
const write = adbPacketBytes(
  { command: WRTE, arg0: 1, arg1: 2, dataLength: 0 },
  new Uint8Array(100).fill(7),
);

function joined(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return bytes;
}

function bytesOf(packets: readonly AdbPacket[]): Uint8Array {
  return joined(...packets.flatMap(({ headerBytes, payload }) => [headerBytes, payload]));
}

describe("the ADB packet reader", () => {
  it("reads whole packets, their headers and payloads as they came", () => {
    const packets = new AdbPacketReader().push(hello);

    expect(packets).toHaveLength(1);
    expect(packets[0]?.header).toEqual({
      command: ADB_COMMANDS.connect,
      arg0: 0x01000001,
      arg1: 256 * 1024,
      dataLength: 7,
    });
    expect(bytesOf(packets)).toEqual(hello);
  });

  it("puts together packets split across chunks, even one byte at a time", () => {
    const reader = new AdbPacketReader();
    const stream = joined(hello, write);
    const packets: AdbPacket[] = [];
    for (let at = 0; at < stream.byteLength; at += 1) {
      packets.push(...reader.push(stream.subarray(at, at + 1)));
    }

    expect(packets.map(({ header }) => header.command)).toEqual([ADB_COMMANDS.connect, WRTE]);
    expect(bytesOf(packets)).toEqual(stream);
  });

  it("cuts merged packets apart, keeping the rest of a chunk for the next", () => {
    const reader = new AdbPacketReader();
    const stream = joined(hello, ready, write);

    const first = reader.push(stream.subarray(0, hello.byteLength + ready.byteLength + 30));
    const rest = reader.push(stream.subarray(hello.byteLength + ready.byteLength + 30));

    expect(first.map(({ header }) => header.command)).toEqual([ADB_COMMANDS.connect, OKAY]);
    expect(first[1]?.payload.byteLength).toBe(0);
    expect(rest.map(({ header }) => header.command)).toEqual([WRTE]);
    expect(bytesOf([...first, ...rest])).toEqual(stream);
  });

  it("stops at a garbled header, keeping the packets before it and reading nothing after", () => {
    const reader = new AdbPacketReader();
    const garbled = ready.slice();
    garbled[20] = 0;

    const packets = reader.push(joined(hello, garbled, write));

    expect(packets.map(({ header }) => header.command)).toEqual([ADB_COMMANDS.connect]);
    expect(reader.garbled).toBe(true);
    expect(reader.push(write)).toEqual([]);
  });

  it("takes a header naming more than adbd's largest payload as garbled", () => {
    const reader = new AdbPacketReader();
    const huge = ready.slice();
    new DataView(huge.buffer).setUint32(12, 1024 * 1024 + 1, true);

    expect(reader.push(huge)).toEqual([]);
    expect(reader.garbled).toBe(true);
  });
});

describe("the zero-length transfer", () => {
  it("follows a payload that ends on a whole USB packet", () => {
    expect(needsZeroLengthTransfer(512, 512)).toBe(true);
    expect(needsZeroLengthTransfer(1024, 512)).toBe(true);
    expect(needsZeroLengthTransfer(64, 64)).toBe(true);
  });

  it("doesn't follow a short last packet or no payload", () => {
    expect(needsZeroLengthTransfer(0, 512)).toBe(false);
    expect(needsZeroLengthTransfer(100, 512)).toBe(false);
    expect(needsZeroLengthTransfer(513, 512)).toBe(false);
  });
});

function headerOf(command: number, arg0 = 0): AdbHeader {
  return { command, arg0, arg1: 0, dataLength: 0 };
}

describe("the phone's authorisation", () => {
  it("waits for the user once the phone asked and adb sent its public key", () => {
    const authorisation = new AdbAuthorisation();

    authorisation.fromHost(headerOf(ADB_COMMANDS.connect));
    authorisation.fromPhone(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.token));
    authorisation.fromHost(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.signature));
    expect(authorisation.waitingForUser).toBe(false);

    authorisation.fromPhone(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.token));
    authorisation.fromHost(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.rsaPublicKey));
    expect(authorisation.waitingForUser).toBe(true);
  });

  it("stops waiting once the phone lets adb in", () => {
    const authorisation = new AdbAuthorisation();
    authorisation.fromPhone(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.token));
    authorisation.fromHost(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.rsaPublicKey));

    authorisation.fromPhone(headerOf(ADB_COMMANDS.connect));

    expect(authorisation.waitingForUser).toBe(false);
  });

  it("doesn't wait for a public key the phone didn't ask for, nor for a signature it took", () => {
    const authorisation = new AdbAuthorisation();
    authorisation.fromHost(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.rsaPublicKey));
    expect(authorisation.waitingForUser).toBe(false);

    authorisation.fromPhone(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.token));
    authorisation.fromHost(headerOf(ADB_COMMANDS.auth, ADB_AUTH_TYPES.signature));
    authorisation.fromPhone(headerOf(ADB_COMMANDS.connect));
    expect(authorisation.waitingForUser).toBe(false);
  });
});
