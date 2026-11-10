import { describe, expect, it } from "vitest";
import { maskedPublicKey } from "./ssh-key-words.ts";

describe("maskedPublicKey", () => {
  it("hides the key and keeps its type and comment", () => {
    expect(maskedPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIaz the-office@host")).toBe(
      "ssh-ed25519 •••••••• the-office@host",
    );
  });

  it("keeps a comment with spaces whole, and a key with none", () => {
    expect(maskedPublicKey("ssh-ed25519 AAAA office key")).toBe("ssh-ed25519 •••••••• office key");
    expect(maskedPublicKey("ssh-ed25519 AAAA")).toBe("ssh-ed25519 ••••••••");
  });
});
