import { createPrivateKey, createPublicKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ADB_KEY_BITS, decodeAdbPublicKey, newAdbKey } from "./adb-key.js";

describe("newAdbKey", () => {
  it("makes an RSA-2048 key whose public half is adb's format, named for the Project", async () => {
    const key = await newAdbKey("shop", new Date("2026-11-21T10:00:00Z"));

    const [encoded, name] = key.publicKey.split(" ");
    expect(name).toBe("office@shop");
    const decoded = decodeAdbPublicKey(encoded ?? "");
    const jwk = createPublicKey(createPrivateKey(key.privateKey)).export({ format: "jwk" });
    const modulus = BigInt(`0x${Buffer.from(jwk.n ?? "", "base64url").toString("hex")}`);
    expect(decoded.words).toBe(ADB_KEY_BITS / 32);
    expect(decoded.exponent).toBe(65_537);
    expect(decoded.modulus).toBe(modulus);
    expect(decoded.rr).toBe((1n << BigInt(2 * ADB_KEY_BITS)) % modulus);
    // n0inv is -1 / n mod 2^32: n0inv * n ≡ -1.
    expect((BigInt(decoded.n0inv) * modulus) % (1n << 32n)).toBe((1n << 32n) - 1n);
    expect(key.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
  });
});
