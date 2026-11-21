import { generateKeyPair } from "node:crypto";
import { promisify } from "node:util";

/**
 * A Project's adb key (spec §2.13, "The adb key"): the one key adb in its Tasks' run environments
 * uses, so a phone allows it once per Project. The private key never leaves the service but into
 * a run environment's `~/.android`.
 */
export interface AdbKey {
  readonly projectId: string;
  /** PKCS #8 PEM, as adb reads `~/.android/adbkey`. */
  readonly privateKey: string;
  /** adb's own format, as `~/.android/adbkey.pub` holds it. */
  readonly publicKey: string;
  readonly createdAt: Date;
}

export const ADB_KEY_BITS = 2048;
const MODULUS_WORDS = ADB_KEY_BITS / 32;
const MODULUS_BYTES = ADB_KEY_BITS / 8;
const PUBLIC_EXPONENT = 65_537;
/** `len, n0inv, n[64], rr[64], e`: adb's `RSAPublicKey`. */
const PUBLIC_KEY_BYTES = 4 + 4 + MODULUS_BYTES + MODULUS_BYTES + 4;
const WORD = 1n << 32n;

/** Makes the Project's key: RSA-2048, its public half in adb's format, named `office@<project>`. */
export async function newAdbKey(projectId: string, createdAt: Date): Promise<AdbKey> {
  // Off the event loop: making an RSA key takes a while.
  const { privateKey, publicKey } = await promisify(generateKeyPair)("rsa", {
    modulusLength: ADB_KEY_BITS,
    publicExponent: PUBLIC_EXPONENT,
  });
  const modulus = publicKey.export({ format: "jwk" }).n;
  if (modulus === undefined) throw new Error("The RSA key has no modulus.");
  return {
    projectId,
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: `${encodeAdbPublicKey(bigIntOf(Buffer.from(modulus, "base64url")))} office@${projectId}`,
    createdAt,
  };
}

/**
 * adb's public key, base64 (`android_pubkey_encode`): the modulus size in words, `-1 / n mod 2^32`,
 * the modulus and `R^2 mod n` (R = 2^2048), each little-endian, then the exponent.
 */
export function encodeAdbPublicKey(modulus: bigint): string {
  const bytes = Buffer.alloc(PUBLIC_KEY_BYTES);
  bytes.writeUInt32LE(MODULUS_WORDS, 0);
  bytes.writeUInt32LE(Number((WORD - inverseModuloWord(modulus % WORD)) % WORD), 4);
  writeLittleEndian(bytes, modulus, 8);
  writeLittleEndian(bytes, (1n << BigInt(2 * ADB_KEY_BITS)) % modulus, 8 + MODULUS_BYTES);
  bytes.writeUInt32LE(PUBLIC_EXPONENT, 8 + 2 * MODULUS_BYTES);
  return bytes.toString("base64");
}

/** The parts of an adb public key, read back from its base64, before the name. */
export function decodeAdbPublicKey(encoded: string): {
  readonly words: number;
  readonly n0inv: number;
  readonly modulus: bigint;
  readonly rr: bigint;
  readonly exponent: number;
} {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== PUBLIC_KEY_BYTES) throw new Error("Not an adb public key.");
  return {
    words: bytes.readUInt32LE(0),
    n0inv: bytes.readUInt32LE(4),
    modulus: readLittleEndian(bytes.subarray(8, 8 + MODULUS_BYTES)),
    rr: readLittleEndian(bytes.subarray(8 + MODULUS_BYTES, 8 + 2 * MODULUS_BYTES)),
    exponent: bytes.readUInt32LE(8 + 2 * MODULUS_BYTES),
  };
}

function inverseModuloWord(value: bigint): bigint {
  // Newton's iteration doubles the correct low bits each step: 5 steps reach 32 from 1.
  let inverse = 1n;
  for (let step = 0; step < 5; step++) inverse = (inverse * (2n - value * inverse)) % WORD;
  return (inverse + WORD) % WORD;
}

function writeLittleEndian(bytes: Buffer, value: bigint, offset: number): void {
  let rest = value;
  for (let index = 0; index < MODULUS_BYTES; index++) {
    bytes[offset + index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
}

function readLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return value;
}

function bigIntOf(bigEndian: Uint8Array): bigint {
  return BigInt(`0x${Buffer.from(bigEndian).toString("hex")}`);
}
