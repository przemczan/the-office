import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { GeminiApiKey, NotAGeminiApiKey } from "./gemini-api-key.js";

const KEY = "AIzaSyA-aGeminiApiKey_from_AI_Studio01";

describe("a Gemini API key", () => {
  it("takes the key, trimmed", () => {
    expect(GeminiApiKey.of(`  ${KEY}\n`).reveal()).toBe(KEY);
  });

  it("refuses an empty one", () => {
    for (const text of ["", "   \n"]) {
      expect(() => GeminiApiKey.of(text)).toThrow(NotAGeminiApiKey);
    }
  });

  it("reads as redacted wherever it is printed, logged or serialised", () => {
    const key = GeminiApiKey.of(KEY);

    for (const printed of [String(key), `${key}`, JSON.stringify({ key }), inspect({ key })]) {
      expect(printed).not.toContain("AIza");
      expect(printed).toContain("[an API key]");
    }
  });
});
