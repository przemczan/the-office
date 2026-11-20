import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { CopilotCliToken, NotACopilotCliToken } from "./copilot-cli-token.js";

const TOKEN = "github_pat_11ABCDEFG0_aFineGrained_Token123";

describe("a Copilot CLI token", () => {
  it("takes a fine-grained personal access token, trimmed", () => {
    expect(CopilotCliToken.of(`  ${TOKEN}\n`).reveal()).toBe(TOKEN);
  });

  it("refuses anything else", () => {
    for (const text of [
      "",
      "github_pat_",
      "ghp_aClassicToken",
      "gho_anOAuthToken",
      `${TOKEN} more`,
    ]) {
      expect(() => CopilotCliToken.of(text)).toThrow(NotACopilotCliToken);
    }
  });

  it("reads as redacted wherever it is printed, logged or serialised", () => {
    const token = CopilotCliToken.of(TOKEN);

    for (const printed of [
      String(token),
      `${token}`,
      JSON.stringify({ token }),
      inspect({ token }),
    ]) {
      expect(printed).not.toContain("github_pat");
      expect(printed).toContain("[a token]");
    }
  });
});
