import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { NotAPastedToken, PastedToken } from "./pasted-token.js";

const TOKEN = "sk-ant-oat01-Abc_123-def";

describe("a pasted token", () => {
  it("takes what `claude setup-token` makes, trimmed", () => {
    expect(PastedToken.of(`  ${TOKEN}\n`).reveal()).toBe(TOKEN);
  });

  it("refuses anything else", () => {
    for (const text of ["", "sk-ant-oat01-", "sk-ant-api03-abc", `${TOKEN} more`, "a-code"]) {
      expect(() => PastedToken.of(text)).toThrow(NotAPastedToken);
    }
  });

  it("reads as redacted wherever it is printed, logged or serialised", () => {
    const token = PastedToken.of(TOKEN);

    for (const printed of [
      String(token),
      `${token}`,
      JSON.stringify({ token }),
      inspect({ token }),
    ]) {
      expect(printed).not.toContain("sk-ant");
      expect(printed).toContain("[a pasted token]");
    }
  });
});
