import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { PasswordHashing } from "../../ports/password-hashing.js";

/** The parameters new hashes get; an older hash keeps its own, written into it. */
const DEFAULT_COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCHEME = "scrypt";

/** scrypt needs 128 × N × r bytes; Node's 32 MB default is too little from N = 2^15 at r = 8. */
function memoryFor(cost: number, blockSize: number): number {
  return 2 * 128 * cost * blockSize;
}

function derive(
  password: string,
  salt: Buffer,
  keyBytes: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, keyBytes, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Passwords as Node's scrypt with a random salt (spec §6), written `scrypt$N$r$p$salt$key` (salt
 * and key in base64url) so the parameters can rise later and old hashes still match.
 */
export class ScryptPasswordHashing extends PasswordHashing {
  /** `cost` is scrypt's N, a power of two; only tests lower it, to hash quickly. */
  constructor(private readonly cost: number = DEFAULT_COST) {
    super();
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(password, salt, KEY_BYTES, {
      N: this.cost,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
      maxmem: memoryFor(this.cost, BLOCK_SIZE),
    });
    return [
      SCHEME,
      this.cost,
      BLOCK_SIZE,
      PARALLELIZATION,
      salt.toString("base64url"),
      key.toString("base64url"),
    ].join("$");
  }

  async matches(password: string, hash: string): Promise<boolean> {
    const parsed = parseHash(hash);
    if (parsed === undefined) return false;
    const { cost, blockSize, parallelization, salt, key } = parsed;
    try {
      const derived = await derive(password, salt, key.length, {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: memoryFor(cost, blockSize),
      });
      return timingSafeEqual(derived, key);
    } catch {
      // Parameters scrypt refuses, such as a cost that isn't a power of two.
      return false;
    }
  }
}

interface ParsedHash {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parseHash(hash: string): ParsedHash | undefined {
  const [scheme, cost, blockSize, parallelization, salt, key, ...rest] = hash.split("$");
  if (scheme !== SCHEME || rest.length > 0 || !salt || !key) return undefined;
  const numbers = [cost, blockSize, parallelization].map(Number);
  if (!numbers.every((number) => Number.isSafeInteger(number) && number > 0)) return undefined;
  const [parsedCost = 0, parsedBlockSize = 0, parsedParallelization = 0] = numbers;
  const keyBytes = Buffer.from(key, "base64url");
  if (keyBytes.length === 0) return undefined;
  return {
    cost: parsedCost,
    blockSize: parsedBlockSize,
    parallelization: parsedParallelization,
    salt: Buffer.from(salt, "base64url"),
    key: keyBytes,
  };
}
