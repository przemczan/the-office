import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AnthropicApiKey, NotAnAnthropicApiKey } from "./anthropic-api-key.js";

const KEY = "sk-ant-api03-Abc_123-def";

describe("an Anthropic API key", () => {
  it("takes what the Claude Console makes, trimmed", () => {
    expect(AnthropicApiKey.of(`  ${KEY}\n`).reveal()).toBe(KEY);
  });

  it("refuses anything else, a pasted token among them, in plain words", () => {
    for (const text of ["", "sk-ant-api03-", "sk-ant-oat01-abc", "sk-proj-abc", `${KEY} more`]) {
      expect(() => AnthropicApiKey.of(text)).toThrow(new NotAnAnthropicApiKey().message);
    }
    expect(new NotAnAnthropicApiKey().message).toBe(
      "That is no Anthropic API key: one starts with sk-ant-api.",
    );
  });

  it("reads as redacted wherever it is printed, logged or serialised", () => {
    const key = AnthropicApiKey.of(KEY);

    for (const printed of [String(key), `${key}`, JSON.stringify({ key }), inspect({ key })]) {
      expect(printed).not.toContain("sk-ant");
      expect(printed).toContain("[an API key]");
    }
  });
});
