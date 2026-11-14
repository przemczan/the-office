import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ScryptPasswordHashing } from "./scrypt-password-hashing.js";

const hashing = new ScryptPasswordHashing();
const PASSWORD = "correct horse battery staple";

describe("ScryptPasswordHashing", () => {
  it("keeps the parameters and a random salt with the hash, never the password", async () => {
    const [one, other] = await Promise.all([hashing.hash(PASSWORD), hashing.hash(PASSWORD)]);

    expect(one).toMatch(/^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{86}$/);
    expect(one).not.toBe(other);
    expect(one).not.toContain(PASSWORD);
  });

  it("matches the password alone", async () => {
    const hash = await hashing.hash(PASSWORD);

    expect(await hashing.matches(PASSWORD, hash)).toBe(true);
    expect(await hashing.matches(`${PASSWORD} `, hash)).toBe(false);
  });

  it("matches a hash made with lower parameters, so they can rise later", async () => {
    const salt = Buffer.from("a salt of its own");
    const key = scryptSync(PASSWORD, salt, 64, { N: 1024, r: 8, p: 1 });
    const hash = ["scrypt", 1024, 8, 1, salt.toString("base64url"), key.toString("base64url")];

    expect(await hashing.matches(PASSWORD, hash.join("$"))).toBe(true);
  });

  it.each(["", "bcrypt$x", "scrypt$0$8$1$c2FsdA$a2V5", "scrypt$1024$8$1$c2FsdA$"])(
    "matches nothing against the unreadable hash %j",
    async (hash) => {
      expect(await hashing.matches(PASSWORD, hash)).toBe(false);
    },
  );
});
